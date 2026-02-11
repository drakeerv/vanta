import { Show, For, onMount, onCleanup, createSignal } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import panzoom from "panzoom";
import { 
  Tag, 
  Info, 
  Download, 
  Trash2, 
  X,
  Eye,
  EyeOff
} from "lucide-solid";
import type { ImageEntry } from "../api";
import * as api from "../api";

export function Lightbox(props: {
  image: ImageEntry | null;
  onClose: () => void;
  onTag: () => void;
  onInfo: () => void;
  onDelete: () => void;
}) {
  const [showUI, setShowUI] = createSignal(true);

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

          {/* Persistent Visibility Toggle (Always clickable) */}
          <button 
            onClick={() => setShowUI(!showUI())}
            class="absolute top-4 left-4 z-50 p-2 rounded-full bg-black/20 text-white/70 hover:text-white hover:bg-white/10 transition-all border border-white/10 backdrop-blur-sm cursor-pointer"
            title={showUI() ? "Hide UI" : "Show UI"}
          >
            <Show when={showUI()} fallback={<Eye size={24} />}>
              <EyeOff size={24} />
            </Show>
          </button>

          <Show when={props.image}>
            {(img) => (
              <>
                <ZoomableImage src={api.highResUrl(img().id)} />

                {/* Bottom Toolbar */}
                <div 
                  class={`absolute bottom-0 left-0 right-0 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 z-50 bg-black/60 backdrop-blur-md border-t border-white/10 transition-all duration-300 transform ${
                    showUI() ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Tags Section */}
                  <div class="flex gap-1.5 flex-wrap justify-center sm:justify-start">
                    <For each={img().tags}>
                      {(tag) => (
                        <span class="px-2 py-0.5 bg-white/15 text-white rounded text-[10px] uppercase tracking-wider flex items-center gap-1">
                          <Tag size={10} /> {tag}
                        </span>
                      )}
                    </For>
                  </div>

                  {/* Actions Section */}
                  <div class="flex gap-2">
                    <LbButton onClick={props.onTag} icon={<Tag size={18} />}>Tag</LbButton>
                    <LbButton onClick={props.onInfo} icon={<Info size={18} />}>Info</LbButton>
                    
                    <a
                      href={api.originalUrl(img().id)}
                      download=""
                      class="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 transition-colors no-underline"
                    >
                      <Download size={18} />
                      <span class="hidden sm:inline">Download</span>
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

function LbButton(props: { onClick: () => void; children: any; icon: any }) {
  return (
    <button
      class="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 transition-colors cursor-pointer"
      onClick={props.onClick}
    >
      {props.icon}
      <span class="hidden sm:inline">{props.children}</span>
    </button>
  );
}

function ZoomableImage(props: { src: string }) {
  let ref: HTMLImageElement | undefined;

  onMount(() => {
    if (!ref) return;
    const pz = panzoom(ref, {
      maxZoom: 5,
      minZoom: 0.5,
      bounds: true,
      boundsPadding: 0.1,
    });
    
    ref.style.touchAction = "none";
    onCleanup(() => pz.dispose());
  });

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