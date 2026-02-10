import { For, Show, createMemo, createSignal } from "solid-js";
import { Input } from "./Input";

export function Suggestions(props: {
  input: string;
  tags: string[];
  visible: boolean;
  onSelect: (fullValue: string) => void;
}) {
  const items = createMemo(() => {
    if (!props.visible || !props.input) return [] as string[];
    const words = props.input.split(/\s+/);
    const current = words[words.length - 1] || "";
    const isExcl = current.startsWith("-");
    const term = isExcl ? current.slice(1) : current;
    if (!term) return [] as string[];
    return props.tags
      .filter((t) => t.toLowerCase().includes(term.toLowerCase()))
      .slice(0, 8)
      .map((t) => (isExcl ? "-" : "") + t);
  });

  return (
    <Show when={items().length > 0}>
      <div class="absolute top-full left-0 right-0 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto mt-1">
        <For each={items()}>
          {(item) => (
            <div
              class="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              onMouseDown={(e) => {
                e.preventDefault();
                const words = props.input.split(/\s+/);
                words[words.length - 1] = item;
                props.onSelect(words.join(" ") + " ");
              }}
            >
              {item}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Input with tag suggestions attached */
export function TagInput(props: {
  value: string;
  onInput: (v: string) => void;
  tags: string[];
  placeholder?: string;
  onEnter?: () => void;
  onBackspace?: () => void;
}) {
  const [vis, setVis] = createSignal(false);

  return (
    <div class="relative flex-1">
      <Input
        value={props.value}
        onChange={props.onInput}
        placeholder={props.placeholder ?? ""}
        onFocus={() => setVis(true)}
        onBlur={() => setTimeout(() => setVis(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); props.onEnter?.(); }
          if (e.key === "Escape") setVis(false);
          if (e.key === "Backspace" && !props.value) props.onBackspace?.();
        }}
      />
      <Suggestions
        input={props.value}
        tags={props.tags}
        visible={vis()}
        onSelect={props.onInput}
      />
    </div>
  );
}
