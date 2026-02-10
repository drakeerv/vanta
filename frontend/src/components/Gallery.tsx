import { For, Show } from "solid-js";
import type { ImageEntry } from "../api";
import * as api from "../api";

export function Gallery(props: {
  images: ImageEntry[];
  emptyText: string;
  bulkMode: boolean;
  isSelected?: (img: ImageEntry) => boolean;
  onImageClick: (id: string) => void;
}) {
  const cardClass = (img: ImageEntry) => {
    if (!props.bulkMode) return "";
    if (props.isSelected?.(img)) return "ring-3 ring-accent-500 opacity-100";
    return "opacity-40 hover:opacity-80";
  };

  return (
    <Show
      when={props.images.length > 0}
      fallback={<p class="text-gray-400 dark:text-gray-500">{props.emptyText}</p>}
    >
      <div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <For each={props.images}>
          {(img) => (
            <div
              class={`bg-white dark:bg-gray-900 rounded-lg shadow aspect-square flex items-center justify-center p-1 cursor-pointer hover:shadow-lg transition-all ${cardClass(img)}`}
              onClick={() => props.onImageClick(img.id)}
            >
              <img
                src={api.thumbnailUrl(img.id)}
                loading="lazy"
                alt=""
                class="max-w-full max-h-full object-contain rounded"
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
