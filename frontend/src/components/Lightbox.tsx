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

  // Reset index when a different image opens
  createEffect(() => {
    if (props.image) setCurrentIndex(0);
  });

  const isLinkedSet = () => (props.image?.linked_images?.length ?? 0) > 0;
  const totalImages = () => 1 + (props.image?.linked_images?.length ?? 0);

  const currentSrc = () => {
    const img = props.image;
    if (!img) return "";
    const idx = currentIndex();
    if (idx === 0) return api.highResUrl(img.id);
    const linked = img.linked_images?.[idx - 1];
    return linked ? api.linkedHighResUrl(img.id, linked.id) : api.highResUrl(img.id);
  };

  const goNext = () => setCurrentIndex((i) => Math.min(totalImages() - 1, i + 1));
  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));

  // Upload a new image into this linked set
  const handleAddToSet = async (file: File) => {
    const img = props.image;
    if (!img) return;
    setUploading(true);
    try {
      const entry = await api.uploadToLinkedSet(img.id, file);
      props.onImageUpdate(img.id, entry);
    } catch {
      alert("Failed to add image to set");
    }
    setUploading(false);
  };

  // Remove the currently-viewed sub-image from the set
  const handleRemoveFromSet = async () => {
    const img = props.image;
    const idx = currentIndex();
    if (!img || idx === 0) return;
    const linked = img.linked_images?.[idx - 1];
    if (!linked || !confirm("Remove this image from the set?")) return;
    try {
      const entry = await api.removeFromLinkedSet(img.id, linked.id);
      props.onImageUpdate(img.id, entry);
      if (idx >= entry.linked_images.length + 1) {
        setCurrentIndex(Math.max(0, entry.linked_images.length));
      }
    } catch {
      alert("Failed to remove image");
    }
  };

  // Keyboard: arrows navigate linked set
  const onKeyDown = (e: KeyboardEvent) => {
    if (!props.image) return;
    if (isLinkedSet()) {
      if (e.key === "ArrowLeft") { goPrev(); e.preventDefault(); }
      if (e.key === "ArrowRight") { goNext(); e.preventDefault(); }
    }
  };

  createEffect(() => {
    if (props.image) {
      document.addEventListener("keydown", onKeyDown);
    } else {
      document.removeEventListener("keydown", onKeyDown);
    }
  });
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <Dialog open={!!props.image} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/95" />
        <Dialog.Content
          class="fixed inset-0 z-40 flex flex-col items-center justify-center outline-none text-white"
          onClick={(e: MouseEvent) => { if (e.target === e.currentTarget) props.onClose(); }}
        >
          <Dialog.Title class="sr-only">Image viewer</Dialog.Title>

          {/* Top Controls */}
          <div class={`absolute top-4 right-4 z-50 flex gap-2 transition-opacity duration-300 ${showUI() ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
             <Dialog.CloseButton class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer">
              <X size={24} />
            </Dialog.CloseButton>
          </div>

          {/* Persistent Visibility Toggle */}
          <button 
            onClick={() => setShowUI(!showUI())}
            class="absolute top-4 left-4 z-50 p-2 rounded-full bg-black/20 text-white/70 hover:text-white hover:bg-white/10 transition-all border border-white/10 backdrop-blur-sm cursor-pointer"
            title={showUI() ? "Hide UI" : "Show UI"}
          >
            <Show when={showUI()} fallback={<Eye size={24} />}>
              <EyeOff size={24} />
            </Show>
          </button>

          {/* Image counter for linked sets */}
          <Show when={isLinkedSet() && showUI()}>
            <div class="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-black/40 backdrop-blur-sm text-white/80 text-sm px-3 py-1 rounded-full border border-white/10">
              {currentIndex() + 1} / {totalImages()}
            </div>
          </Show>

          {/* Left/Right arrows for linked sets */}
          <Show when={isLinkedSet() && showUI()}>
            <button
              class={`absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer ${currentIndex() === 0 ? 'opacity-30 pointer-events-none' : ''}`}
              onClick={goPrev}
            >
              <ChevronLeft size={28} />
            </button>
            <button
              class={`absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer ${currentIndex() >= totalImages() - 1 ? 'opacity-30 pointer-events-none' : ''}`}
              onClick={goNext}
            >
              <ChevronRight size={28} />
            </button>
          </Show>

          <Show when={props.image}>
            {(img) => (
              <>
                <ZoomableImage src={currentSrc()} />

                {/* Filmstrip for linked sets */}
                <Show when={isLinkedSet() && showUI()}>
                  <div class="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 flex gap-1.5 bg-black/50 backdrop-blur-md p-1.5 rounded-lg border border-white/10 max-w-[80vw] overflow-x-auto">
                    <FilmstripThumb
                      src={api.thumbnailUrl(img().id)}
                      active={currentIndex() === 0}
                      onClick={() => setCurrentIndex(0)}
                    />
                    <For each={img().linked_images}>
                      {(linked, i) => (
                        <FilmstripThumb
                          src={api.linkedThumbnailUrl(img().id, linked.id)}
                          active={currentIndex() === i() + 1}
                          onClick={() => setCurrentIndex(i() + 1)}
                        />
                      )}
                    </For>
                  </div>
                </Show>

                {/* Bottom Toolbar */}
                <div 
                  class={`absolute bottom-0 left-0 right-0 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 z-50 bg-black/60 backdrop-blur-md border-t border-white/10 transition-all duration-300 transform ${
                    showUI() ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Tags Section */}
                  <div class="flex gap-1.5 flex-wrap justify-center sm:justify-start">
                    <For each={img().tags.slice(0, 3)}>
                      {(tag) => (
                        <span class="px-2 py-0.5 bg-white/15 text-white rounded text-[10px] uppercase tracking-wider flex items-center gap-1">
                          <Tag size={10} /> {tag}
                        </span>
                      )}
                    </For>
                    <Show when={img().tags.length > 3}>
                      <button 
                        onClick={props.onTag}
                        class="px-2 py-0.5 bg-white/10 text-white/70 rounded text-[10px] uppercase tracking-wider hover:bg-white/20 cursor-pointer"
                      >
                        +{img().tags.length - 3}
                      </button>
                    </Show>
                  </div>

                  {/* Actions Section */}
                  <div class="flex gap-2">
                    <LbButton onClick={props.onTag} icon={<Tag size={18} />}>Tag</LbButton>
                    <LbButton onClick={props.onInfo} icon={<Info size={18} />}>Info</LbButton>

                    {/* Hidden file input for adding to set */}
                    <input
                      ref={addFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/avif,image/webp,image/gif,image/jxl"
                      class="hidden"
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) handleAddToSet(file);
                        e.currentTarget.value = "";
                      }}
                    />
                    <LbButton
                      onClick={() => addFileRef?.click()}
                      icon={<Plus size={18} />}
                      disabled={uploading()}
                    >
                      {uploading() ? "…" : "Add"}
                    </LbButton>

                    {/* Remove sub-image from set (only when viewing a sub-image) */}
                    <Show when={isLinkedSet() && currentIndex() > 0}>
                      <button
                        class="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-orange-400 rounded-lg text-sm hover:bg-orange-500 hover:text-white transition-colors cursor-pointer"
                        onClick={handleRemoveFromSet}
                      >
                        <Minus size={18} />
                        <span class="hidden sm:inline">Remove</span>
                      </button>
                    </Show>
                    
                    <a
                      href={isLinkedSet() ? api.downloadUrl(img().id) : api.originalUrl(img().id)}
                      download=""
                      class="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 transition-colors no-underline"
                    >
                      <Download size={18} />
                      <span class="hidden sm:inline">{isLinkedSet() ? "ZIP" : "Download"}</span>
                    </a>

                    <button
                      class="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-red-400 rounded-lg text-sm hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
                      onClick={props.onDelete}
                    >
                      <Trash2 size={18} />
                      <span class="hidden sm:inline">Delete</span>
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
        props.active ? 'border-white opacity-100' : 'border-transparent opacity-60 hover:opacity-90'
      }`}
      onClick={props.onClick}
    >
      <img src={props.src} alt="" class="w-full h-full object-cover" />
    </button>
  );
}

function ZoomableImage(props: { src: string }) {
  let ref: HTMLImageElement | undefined;
  let pzInstance: ReturnType<typeof panzoom> | undefined;

  createEffect(() => {
    props.src; // track dependency
    if (pzInstance) pzInstance.dispose();
    if (!ref) return;
    pzInstance = panzoom(ref, {
      maxZoom: 5,
      minZoom: 0.5,
      bounds: true,
      boundsPadding: 0.1,
    });
    ref.style.touchAction = "none";
  });

  onCleanup(() => pzInstance?.dispose());

  return (
    <div class="w-full h-full overflow-hidden absolute inset-0">
      <img
        ref={ref}
        src={props.src}
        alt=""
        class="w-full h-full object-contain"
      />
    </div>
  );
}