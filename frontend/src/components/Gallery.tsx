import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import type { ImageEntry } from "../api";
import * as api from "../api";

function GalleryItem(props: {
  img: ImageEntry;
  priority: boolean;
  bulkMode: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const [visible, setVisible] = createSignal(props.priority);
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    if (visible()) return;

    const observer = new IntersectionObserver(([entry]) => {
      // Load when within 200px of viewport
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });

    if (ref) observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  const containerClass = () => {
    const base = "bg-white dark:bg-gray-900 rounded-lg shadow aspect-square flex items-center justify-center p-1 cursor-pointer hover:shadow-lg transition-all";
    if (!props.bulkMode) return base;
    if (props.selected) return `${base} ring-3 ring-accent-500 opacity-100`;
    return `${base} opacity-40 hover:opacity-80`;
  };

  return (
    <div
      ref={ref}
      class={containerClass()}
      onClick={props.onClick}
    >
      <Show 
        when={visible()} 
        fallback={<div class="w-full h-full bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />}
      >
        <img
          src={api.thumbnailUrl(props.img.id)}
          loading={props.priority ? "eager" : "lazy"}
          alt=""
          class="max-w-full max-h-full object-contain rounded"
        />
      </Show>
    </div>
  );
}

export function Gallery(props: {
  images: ImageEntry[];
  emptyText: string;
  bulkMode: boolean;
  isSelected?: (img: ImageEntry) => boolean;
  onImageClick: (id: string) => void;
}) {
  return (
    <Show
      when={props.images.length > 0}
      fallback={<p class="text-gray-400 dark:text-gray-500">{props.emptyText}</p>}
    >
      <div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <For each={props.images}>
          {(img, i) => (
            <GalleryItem
              img={img}
              priority={i() < 25}
              bulkMode={props.bulkMode}
              selected={props.isSelected?.(img) ?? false}
              onClick={() => props.onImageClick(img.id)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
