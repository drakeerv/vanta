import { Show, For, createSignal, createEffect } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import { 
  Tag, Info, Download, Trash2, X, Eye, EyeOff, 
  ChevronLeft, ChevronRight, Plus, Minus, LayoutGrid 
} from "lucide-solid";
import type { ImageEntry } from "../api";
import * as api from "../api";
import { HammerZoom } from "./HammerZoom";

export function Lightbox(props: {
  image: ImageEntry | null;
  onClose: () => void;
  onTag: () => void;
  onInfo: () => void;
  onDelete: () => void;
  onImageUpdate: (id: string, entry: ImageEntry) => void;
}) {
  const [showUI, setShowUI] = createSignal(true);
  
  // Default gallery to true on large screens, false on mobile
  const [showGallery, setShowGallery] = createSignal(window.innerWidth > 1024);
  
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isZoomed, setIsZoomed] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  let addFileRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.image?.id) setCurrentIndex(0);
  });

  const slides = () => {
    const img = props.image;
    if (!img) return [];
    return [
      { id: "cover", src: api.highResUrl(img.id), thumb: api.thumbnailUrl(img.id) },
      ...(img.linked_images ?? []).map((l) => ({
        id: l.id,
        src: api.linkedHighResUrl(img.id, l.id),
        thumb: api.linkedThumbnailUrl(img.id, l.id),
      })),
    ];
  };

  const goNext = () => !isZoomed() && setCurrentIndex((i) => Math.min(slides().length - 1, i + 1));
  const goPrev = () => !isZoomed() && setCurrentIndex((i) => Math.max(0, i - 1));

  // --- Unified Theme Styles ---
  const btnBase = "flex items-center justify-center h-10 transition-all border outline-none cursor-pointer shrink-0";
  const btnIcon = "w-10 rounded-xl";
  const inactiveStyles = "bg-gray-950/40 border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white";
  const activeStyles = "bg-accent-500 border-accent-500 text-white shadow-[0_0_15px_rgba(255,85,85,0.2)]";

  return (
    <Dialog open={!!props.image} onOpenChange={(open) => !open && props.onClose()}>
      {/* Utility style for hiding scrollbars while keeping functionality, plus new mini-scrollbar */}
      <style>
        {`
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

          /* Desktop Gallery Scrollbar */
          .mini-scrollbar::-webkit-scrollbar { height: 6px; }
          .mini-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .mini-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
          .mini-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
        `}
      </style>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-gray-950/98 backdrop-blur-sm" />
        <Dialog.Content class="fixed inset-0 z-50 flex flex-col outline-none text-gray-100 overflow-hidden font-sans">
          
          {/* Top Header */}
          <div class={`absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-[60] transition-all duration-300 ${showUI() ? 'translate-y-0' : '-translate-y-2'}`}>
            <div class="flex gap-2">
              <button onClick={() => setShowUI(!showUI())} class={`${btnBase} ${btnIcon} ${showUI() ? inactiveStyles : activeStyles}`}>
                {showUI() ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            
            <div class={`px-4 py-1.5 rounded-full bg-gray-900/50 border border-gray-800 backdrop-blur-md transition-opacity ${showUI() ? 'opacity-100' : 'opacity-0'}`}>
              <span class="text-[10px] font-mono font-bold tracking-widest text-gray-400">
                {String(currentIndex() + 1).padStart(2, '0')} / {String(slides().length).padStart(2, '0')}
              </span>
            </div>

            <div class="flex gap-2">
              <button onClick={props.onInfo} class={`${btnBase} ${btnIcon} ${inactiveStyles} ${!showUI() ? 'opacity-0' : ''}`}>
                <Info size={18} />
              </button>
              <Dialog.CloseButton class={`${btnBase} ${btnIcon} bg-gray-900 border-gray-800 hover:border-accent-500 hover:text-accent-500`}>
                <X size={20} />
              </Dialog.CloseButton>
            </div>
          </div>

          {/* Viewport */}
          <div class="flex-1 flex transition-transform duration-500 cubic-bezier(0.2, 0, 0, 1)" style={{ transform: `translateX(-${currentIndex() * 100}%)` }}>
            <For each={slides()}>
              {(slide, i) => (
                <div class="w-full h-full flex-shrink-0">
                  <HammerZoom 
                    src={slide.src} 
                    active={currentIndex() === i()} 
                    onZoomChange={setIsZoomed}
                    onSwipeNext={goNext}
                    onSwipePrev={goPrev}
                  />
                </div>
              )}
            </For>
          </div>

          {/* Nav Arrows (Desktop) */}
          <Show when={showUI() && !isZoomed() && slides().length > 1}>
            <button class="hidden lg:flex absolute left-8 top-1/2 -translate-y-1/2 z-50 p-4 text-gray-500 hover:text-white transition-colors" onClick={goPrev} style={{ opacity: currentIndex() === 0 ? 0.1 : 1 }}>
              <ChevronLeft size={48} stroke-width={1} />
            </button>
            <button class="hidden lg:flex absolute right-8 top-1/2 -translate-y-1/2 z-50 p-4 text-gray-500 hover:text-white transition-colors" onClick={goNext} style={{ opacity: currentIndex() === slides().length - 1 ? 0.1 : 1 }}>
              <ChevronRight size={48} stroke-width={1} />
            </button>
          </Show>

          {/* Desktop/Mobile Bottom UI Container */}
          <div class={`absolute bottom-0 left-0 right-0 z-50 p-4 sm:p-6 transition-all duration-300 ${showUI() ? 'translate-y-0' : 'translate-y-full'}`}>
            <div class="w-full flex flex-col gap-4">
              
              {/* MOBILE ONLY: Gallery Filmstrip (Sits above buttons) */}
              <Show when={showGallery() && !window.matchMedia("(min-width: 1024px)").matches}>
                <div class="lg:hidden flex gap-2 bg-gray-950/80 backdrop-blur-xl p-2 rounded-2xl border border-gray-800 overflow-x-auto no-scrollbar w-full animate-in slide-in-from-bottom-2 fade-in duration-200">
                  <For each={slides()}>
                    {(slide, i) => (
                      <button onClick={() => setCurrentIndex(i())} class={`relative flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${currentIndex() === i() ? 'border-accent-500 scale-105 shadow-lg' : 'border-transparent opacity-50'}`}>
                        <img src={slide.thumb} class="w-full h-full object-cover" />
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              {/* Toolbar Row */}
              <div class="flex items-end lg:items-center justify-between gap-4">
                
                {/* LEFT: Gallery Toggle + Desktop Gallery */}
                <div class="flex items-center">
                   {/* Toggle Button (Visible on both Mobile & Desktop if >1 slide) */}
                   <Show when={slides().length > 1}>
                    <button onClick={() => setShowGallery(!showGallery())} class={`${btnBase} ${btnIcon} mr-3 ${showGallery() ? activeStyles : inactiveStyles}`}>
                      <LayoutGrid size={18} />
                    </button>
                   </Show>

                  {/* DESKTOP ONLY: Expanding Gallery */}
                  <div 
                    class={`hidden lg:flex items-center gap-2 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${showGallery() ? 'max-w-[800px] opacity-100' : 'max-w-0 opacity-0'}`}
                  >
                    <div 
                      // Enable horizontal scrolling with mouse wheel
                      onWheel={(e) => {
                        if (e.deltaY === 0) return;
                        e.preventDefault();
                        e.currentTarget.scrollLeft += e.deltaY;
                      }}
                      // Increased height to h-14 to accommodate scrollbar, switched to mini-scrollbar class
                      class="h-14 flex items-center bg-gray-950/60 backdrop-blur-xl px-1.5 rounded-xl border border-gray-800 overflow-x-auto mini-scrollbar"
                    >
                      <div class="flex gap-1.5">
                        <For each={slides()}>
                          {(slide, i) => (
                            <button 
                              onClick={() => setCurrentIndex(i())}
                              // Thumbnails are h-8 (32px)
                              class={`relative flex-shrink-0 w-8 h-8 rounded-md overflow-hidden border-2 transition-all cursor-pointer ${currentIndex() === i() ? 'border-accent-500 scale-105 shadow-lg' : 'border-transparent opacity-40 hover:opacity-100'}`}
                            >
                              <img src={slide.thumb} class="w-full h-full object-cover" />
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT: Actions Cluster */}
                <div class="flex items-center justify-end gap-2 w-auto">
                  
                  {/* Tag Button */}
                  <button onClick={props.onTag} class={`${btnBase} ${btnIcon} ${inactiveStyles}`}>
                    <Tag size={18} />
                  </button>

                  {/* Set Management Group */}
                  <div class="flex items-center h-10 bg-gray-950/40 rounded-xl border border-gray-800 overflow-hidden shrink-0">
                    <input ref={addFileRef} type="file" class="hidden" onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      if (file && props.image) {
                        setUploading(true);
                        api.uploadToLinkedSet(props.image.id, file).then(entry => {
                          props.onImageUpdate(props.image!.id, entry);
                          setCurrentIndex(entry.linked_images.length);
                        }).finally(() => setUploading(false));
                      }
                    }} />
                    
                    <button onClick={() => addFileRef?.click()} class="flex items-center justify-center h-full px-3 text-gray-400 hover:text-accent-500 hover:bg-gray-800 transition-colors border-r border-gray-800 outline-none" disabled={uploading()}>
                      <Plus size={18} />
                    </button>
                    
                    <button 
                      class="flex items-center justify-center h-full px-3 text-gray-500 hover:text-accent-600 hover:bg-gray-800 transition-colors outline-none disabled:opacity-30" 
                      disabled={currentIndex() === 0}
                      onClick={() => {
                        const linkedId = props.image?.linked_images[currentIndex()-1].id;
                        if(linkedId && confirm("Remove from set?")) api.removeFromLinkedSet(props.image!.id, linkedId).then(e => props.onImageUpdate(props.image!.id, e));
                      }}
                    >
                      <Minus size={18} />
                    </button>
                  </div>

                  {/* System Actions */}
                  <a href={api.highResUrl(slides()[currentIndex()]?.id || props.image?.id || '')} download={`${props.image?.id || 'image'}.jpg`} class={`${btnBase} ${btnIcon} ${inactiveStyles}`}>
                    <Download size={18} />
                  </a>
                  
                  <button onClick={props.onDelete} class={`${btnBase} ${btnIcon} border-gray-800 bg-red-500/10 text-accent-500 hover:bg-accent-500 hover:text-white`}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}