import { For, Show } from "solid-js";

export function TagChip(props: {
  tag: string;
  onRemove?: () => void;
  small?: boolean;
  class?: string;
}) {
  return (
    <span class={`inline-flex items-center gap-1 rounded text-sm ${
      props.small ? "px-2 py-0.5 text-xs" : "px-2.5 py-1"
    } bg-gray-100 dark:bg-gray-800 ${props.class ?? ""}`}>
      {props.tag}
      <Show when={props.onRemove}>
        <button
          class="text-gray-400 hover:text-red-500 leading-none ml-0.5"
          onClick={props.onRemove}
        >
          ×
        </button>
      </Show>
    </span>
  );
}

export function TagList(props: {
  tags: string[];
  onRemove?: (tag: string) => void;
  small?: boolean;
  emptyText?: string;
  class?: string;
}) {
  return (
    <div class={`flex flex-wrap gap-2 min-h-8 ${props.class ?? ""}`}>
      <Show
        when={props.tags.length > 0}
        fallback={<p class="text-sm text-gray-400">{props.emptyText ?? "No tags"}</p>}
      >
        <For each={props.tags}>
          {(tag) => (
            <TagChip
              tag={tag}
              small={props.small}
              onRemove={props.onRemove ? () => props.onRemove!(tag) : undefined}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
