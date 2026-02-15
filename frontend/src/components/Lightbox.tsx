import { Show, For, onMount, onCleanup, createSignal, createEffect } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import panzoom from "panzoom";
import { 
  Tag, 
  Info, 
  Download, 
  Trash2, 
  X,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
} from "lucide-solid";
import type { ImageEntry } from "../api";
import * as api from "../api";

export function Lightbox(props: {
  image: ImageEntry | null;
  onClose: () => void;
  onTag: () => void;
  onInfo: () => void;
  onDelete: () => void;
  onImageUpdate: (id: string, entry: ImageEntry) => void;
}) {
  const [showUI, setShowUI] = createSignal(true);
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [uploading, setUploading] = createSignal(false);
  let addFileRef: HTMLInputElement | undefined;

  // ── Reset Logic ──
  // We only want to reset the index to 0 if the actual Image ID changes.
  // This prevents resetting when adding tags or adding images to the set.
  let lastId: string | null = null;
  createEffect(() => {
    const currentId = props.image?.id ?? null;
    if (currentId !== lastId) {
      setCurrentIndex(0);
      lastId = currentId;
    }
  });

  // ── Data Helpers ──
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

  const isLinkedSet = () => (props.image?.linked_images?.length ?? 0) > 0;
  const totalImages = () => slides().length;

  const goNext = () => setCurrentIndex((i) => Math.min(totalImages() - 1, i + 1));
  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));

  // ── Set Management ──
  const handleAddToSet = async (file: File) => {
    const img = props.image;
    if (!img) return;
    setUploading(true);
    try {
      const entry = await api.uploadToLinkedSet(img.id, file);
      props.onImageUpdate(img.id, entry);
      // Automatically jump to the newly added image at the end
      setCurrentIndex(entry.linked_images.length);
    } catch {
      alert("Failed to add image to set");
    }
    setUploading(false);
  };

  const handleRemoveFromSet = async () => {
    const img = props.image;
    const idx = currentIndex();
    if (!img || idx === 0) return; // Can't remove the cover image this way
    const linked = img.linked_images?.[idx - 1];
    if (!linked || !confirm("Remove this image from the set?")) return;
    try {
      const entry = await api.removeFromLinkedSet(img.id, linked.id);
      props.onImageUpdate(img.id, entry);
      // Adjust index if we were on the last image
      const newTotal = 1 + entry.linked_images.length;
      if (idx >= newTotal) {
        setCurrentIndex(newTotal - 1);
      }
    } catch {
      alert("Failed to remove image");
    }
  };

  // ── Keyboard ──
  const onKeyDown = (e: KeyboardEvent) => {
    if (!props.image) return;
    if (e.key === "ArrowLeft") { goPrev(); e.preventDefault(); }
    if (e.key === "ArrowRight") { goNext(); e.preventDefault(); }
  };
  onMount(() => document.addEventListener("keydown", onKeyDown));
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <Dialog open={!!props.image} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/95" />
        <Dialog.Content
          class="fixed inset-0 z-40 flex flex-col items-center justify-center outline-none text-white overflow-hidden"
          onClick={(e: MouseEvent) => { if (e.target === e.currentTarget) props.onClose(); }}
        >
          <Dialog.Title class="sr-only">Image viewer</Dialog.Title>

          {/* Top Controls */}
          <div class={`absolute top-4 right-4 z-50 flex gap-2 transition-opacity duration-300 ${showUI() ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
             <Dialog.CloseButton class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer">
              <X size={24} />
            </Dialog.CloseButton>
          </div>

          <button 
            onClick={() => setShowUI(!showUI())}
            class="absolute top-4 left-4 z-50 p-2 rounded-full bg-black/20 text-white/70 hover:text-white border border-white/10 backdrop-blur-sm cursor-pointer"
          >
            {showUI() ? <EyeOff size={24} /> : <Eye size={24} />}
          </button>

          {/* Counter */}
          <Show when={isLinkedSet() && showUI()}>
            <div class="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-black/40 backdrop-blur-sm text-white/80 text-sm px-3 py-1 rounded-full border border-white/10">
              {currentIndex() + 1} / {totalImages()}
            </div>
          </Show>

          {/* Nav Arrows */}
          <Show when={isLinkedSet() && showUI()}>
            <button
              class={`absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-black/40 text-white/70 hover:text-white transition-all cursor-pointer ${currentIndex() === 0 ? 'opacity-0 pointer-events-none' : ''}`}
              onClick={goPrev}
            >
              <ChevronLeft size={28} />
            </button>
            <button
              class={`absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-black/40 text-white/70 hover:text-white transition-all cursor-pointer ${currentIndex() >= totalImages() - 1 ? 'opacity-0 pointer-events-none' : ''}`}
              onClick={goNext}
            >
              <ChevronRight size={28} />
            </button>
          </Show>

          {/* Image Display Window (Current + Neighbors) */}
          <div class="absolute inset-0 z-40">
            <For each={slides()}>
              {(slide, i) => {
                const distance = () => Math.abs(currentIndex() - i());
                const isVisible = () => distance() === 0;
                // Only render the current image and its immediate neighbors
                const shouldRender = () => distance() <= 1;

                return (
                  <Show when={shouldRender()}>
                    <div 
                      class="absolute inset-0 transition-opacity duration-300 ease-in-out"
                      style={{ 
                        opacity: isVisible() ? 1 : 0, 
                        "pointer-events": isVisible() ? "auto" : "none",
                        "z-index": isVisible() ? 10 : 0
                      }}
                    >
                      <ZoomableImage 
                        src={slide.src} 
                        active={isVisible()} 
                      />
                    </div>
                  </Show>
                );
              }}
            </For>
          </div>

          <Show when={props.image}>
            {(img) => (
              <>
                {/* Filmstrip */}
                <Show when={isLinkedSet() && showUI()}>
                  <div class="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 flex gap-1.5 bg-black/50 backdrop-blur-md p-1.5 rounded-lg border border-white/10 max-w-[80vw] overflow-x-auto scrollbar-hide">
                    <For each={slides()}>
                      {(slide, i) => (
                        <FilmstripThumb
                          src={slide.thumb}
                          active={currentIndex() === i()}
                          onClick={() => setCurrentIndex(i())}
                        />
                      )}
                    </For>
                  </div>
                </Show>

                {/* Bottom Toolbar */}
                <div class={`absolute bottom-0 left-0 right-0 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 z-50 bg-black/60 backdrop-blur-md border-t border-white/10 transition-all duration-300 ${showUI() ? 'translate-y-0' : 'translate-y-full'}`}>
                  {/* Tags */}
                  <div class="flex gap-1.5 flex-wrap justify-center sm:justify-start">
                    <For each={img().tags.slice(0, 3)}>
                      {(tag) => (
                        <span class="px-2 py-0.5 bg-white/15 text-white rounded text-[10px] uppercase tracking-wider flex items-center gap-1">
                          <Tag size={10} /> {tag}
                        </span>
                      )}
                    </For>
                    <Show when={img().tags.length > 3}>
                      <button onClick={props.onTag} class="px-2 py-0.5 bg-white/10 text-white/70 rounded text-[10px] hover:bg-white/20 cursor-pointer">
                        +{img().tags.length - 3}
                      </button>
                    </Show>
                  </div>

                  {/* Actions */}
                  <div class="flex gap-2">
                    <LbButton onClick={props.onTag} icon={<Tag size={18} />}>Tag</LbButton>
                    <LbButton onClick={props.onInfo} icon={<Info size={18} />}>Info</LbButton>

                    <input 
                      ref={addFileRef} 
                      type="file" 
                      class="hidden" 
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) handleAddToSet(file);
                        e.currentTarget.value = "";
                      }} 
                    />
                    
                    <LbButton onClick={() => addFileRef?.click()} icon={<Plus size={18} />} disabled={uploading()}>
                      {uploading() ? "…" : "Add"}
                    </LbButton>

                    <Show when={currentIndex() > 0}>
                      <button class="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-orange-400 rounded-lg text-sm hover:bg-orange-500 hover:text-white cursor-pointer" onClick={handleRemoveFromSet}>
                        <Minus size={18} /><span class="hidden sm:inline">Remove</span>
                      </button>
                    </Show>
                    
                    <a href={isLinkedSet() ? api.downloadUrl(img().id) : api.originalUrl(img().id)} download="" class="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 transition-colors no-underline">
                      <Download size={18} /><span class="hidden sm:inline">{isLinkedSet() ? "ZIP" : "Download"}</span>
                    </a>

                    <button class="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-red-400 rounded-lg text-sm hover:bg-red-500 hover:text-white cursor-pointer" onClick={props.onDelete}>
                      <Trash2 size={18} /><span class="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

// ── Components ──

function ZoomableImage(props: { src: string; active: boolean }) {
  let ref: HTMLImageElement | undefined;
  let pzInstance: ReturnType<typeof panzoom> | undefined;

  createEffect(() => {
    // Only init panzoom for the visible slide
    if (!props.active) {
      if (pzInstance) { pzInstance.dispose(); pzInstance = undefined; }
      return;
    }

    if (ref && !pzInstance) {
      pzInstance = panzoom(ref, {
        maxZoom: 5,
        minZoom: 0.5,
        bounds: true,
        boundsPadding: 0.1,
      });
      ref.style.touchAction = "none";
    }
  });

  onCleanup(() => pzInstance?.dispose());

  return (
    <div class="w-full h-full flex items-center justify-center overflow-hidden">
      <img
        ref={ref}
        src={props.src}
        alt=""
        class="max-w-full max-h-full object-contain"
        // Active image downloads immediately, neighbors download in background
        loading={props.active ? "eager" : "lazy"}
        decoding={props.active ? "sync" : "async"}
      />
    </div>
  );
}

function LbButton(props: { onClick: () => void; children: any; icon: any; disabled?: boolean }) {
  return (
    <button
      class={`inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 transition-colors cursor-pointer ${props.disabled ? 'opacity-50 pointer-events-none' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.icon}
      <span class="hidden sm:inline">{props.children}</span>
    </button>
  );
}

function FilmstripThumb(props: { src: string; active: boolean; onClick: () => void }) {
  return (
    <button
      class={`w-12 h-12 rounded overflow-hidden flex-shrink-0 border-2 transition-all cursor-pointer ${
        props.active ? 'border-white opacity-100 scale-110 shadow-lg' : 'border-transparent opacity-50 hover:opacity-80'
      }`}
      onClick={props.onClick}
    >
      <img src={props.src} alt="" class="w-full h-full object-cover" />
    </button>
  );
}