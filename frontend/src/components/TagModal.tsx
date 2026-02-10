import { createSignal } from "solid-js";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { TagList } from "./ui/TagChip";
import { TagInput } from "./ui/Suggestions";
import * as api from "../api";
import type { ImageEntry } from "../api";
import type { VaultStore } from "../lib/store";

export function TagModal(props: {
  open: boolean;
  onClose: () => void;
  image: ImageEntry | null;
  store: VaultStore;
}) {
  const [input, setInput] = createSignal("");

  const addTags = async () => {
    const id = props.image?.id;
    const raw = input().trim();
    if (!id || !raw) return;
    const tagsList = raw.split(/\s+/).filter((t) => t.length > 0);
    let ok = 0;

    for (const tag of tagsList) {
      try {
        const entry = await api.addTag(id, tag);
        props.store.updateImage(id, entry);
        ok++;
      } catch {}
    }
    if (ok > 0) {
      setInput("");
      props.store.loadTags();
    }
  };

  const removeTag = async (tag: string) => {
    const id = props.image?.id;
    if (!id) return;
    try {
      const entry = await api.removeTag(id, tag);
      props.store.updateImage(id, entry);
      props.store.loadTags();
    } catch {
      alert("Error removing tag");
    }
  };

  return (
    <Modal open={props.open} onClose={props.onClose} title="Manage Tags" size="sm">
      <TagList
        tags={props.image?.tags ?? []}
        onRemove={removeTag}
        emptyText="No tags yet"
        class="mb-4"
      />

      <div class="flex gap-2">
        <TagInput
          value={input()}
          onInput={setInput}
          tags={props.store.tags()}
          placeholder="Add tags…"
          onEnter={addTags}
        />
        <Button onClick={addTags}>Add</Button>
      </div>
      <p class="text-xs text-gray-400 mt-2">
        Space-separated. Letters, numbers, hyphens, underscores.
      </p>
    </Modal>
  );
}
