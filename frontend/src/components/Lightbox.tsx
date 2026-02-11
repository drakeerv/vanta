import { Show, For, onMount, onCleanup } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import panzoom from "panzoom";
import type { ImageEntry } from "../api";
import * as api from "../api";

export function Lightbox(props: {
  image: ImageEntry | null;
  onClose: () => void;
  onTag: () => void;
  onInfo: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={!!props.image} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/95" />
        <Dialog.Content
          class="fixed inset-0 z-40 flex flex-col items-center justify-center outline-none text-white"
          onClick={(e: MouseEvent) => { if (e.target === e.currentTarget) props.onClose(); }}
        >
          <Dialog.Title class="sr-only">Image viewer</Dialog.Title>

          <Dialog.CloseButton class="absolute top-4 right-4 text-white/70 hover:text-white text-3xl leading-none z-50 cursor-pointer">
            ×
          </Dialog.CloseButton>

          <Show when={props.image}>
            {(img) => (
              <>
                <ZoomableImage src={api.highResUrl(img().id)} />

                <div class="fixed bottom-0 left-0 right-0 flex flex-wrap items-center justify-center gap-2 p-4">
                  <div class="flex gap-1.5 flex-wrap mr-auto">
                    <For each={img().tags}>
                      {(tag) => (
                        <span class="px-2 py-1 bg-white/15 text-white rounded text-xs">{tag}</span>
                      )}
                    </For>
                  </div>
                  <div class="flex gap-2">
                    <LbButton onClick={props.onTag}>Tag</LbButton>
                    <LbButton onClick={props.onInfo}>Info</LbButton>
                    <a
                      href={api.originalUrl(img().id)}
                      download=""
                      class="px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 no-underline"
                    >
                      Download
                    </a>
                    <button
                      class="px-4 py-2 bg-white/15 text-red-400 rounded-lg text-sm hover:bg-red-500/20 cursor-pointer"
                      onClick={props.onDelete}
                    >
                      Delete
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

function LbButton(props: { onClick: () => void; children: any }) {
  return (
    <button
      class="px-4 py-2 bg-white/15 text-white rounded-lg text-sm hover:bg-white/25 cursor-pointer"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function ZoomableImage(props: { src: string }) {
  let ref: HTMLImageElement | undefined;

  onMount(() => {
    if (!ref) return;
    // We need to wait for the image to load to know its dimensions for bounds?
    // panzoom handles it usually.
    const pz = panzoom(ref, {
      maxZoom: 5,
      minZoom: 0.5,
      bounds: true,
      boundsPadding: 0.1,
    });
    
    // Enable touch action for the element specifically for panzoom
    ref.style.touchAction = "none";

    onCleanup(() => pz.dispose());
  });

  return (
    <img
      ref={ref}
      src={props.src}
      alt=""
      class="w-full h-full object-contain"
    />
  );
}
