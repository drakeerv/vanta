import { createSignal } from "solid-js";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { TagList } from "./ui/TagChip";
import { TagInput } from "./ui/Suggestions";
import * as api from "../api";
import type { ImageEntry } from "../api";

export function BulkTagModal(props: {
  open: boolean;
  onClose: () => void;
  onStart: (tags: string[]) => void;
  tags: string[];
}) {
  const [bulkTags, setBulkTags] = createSignal<string[]>([]);
  const [input, setInput] = createSignal("");

  const add = (name: string) => {
    const t = name.trim().toLowerCase();
    if (t && !bulkTags().includes(t)) setBulkTags((p) => [...p, t]);
  };

  const remove = (name: string) => {
    setBulkTags((p) => p.filter((t) => t !== name));
  };

  const start = () => {
    if (bulkTags().length === 0) {
      alert("Add at least one tag first");
      return;
    }
    const tags = [...bulkTags()];
    setBulkTags([]);
    setInput("");
    props.onStart(tags);
  };

  const close = () => {
    setBulkTags([]);
    setInput("");
    props.onClose();
  };

  return (
    <Modal open={props.open} onClose={close} title="Bulk Tag">
      <p class="text-sm text-gray-400 mb-3">
        Add tags then select which images should have them.
      </p>

      <TagList
        tags={bulkTags()}
        onRemove={remove}
        emptyText="No tags added yet"
        class="mb-3"
      />

      <TagInput
        value={input()}
        onInput={setInput}
        tags={props.tags}
        placeholder="Type tag and press Enter…"
        onEnter={() => {
          input().split(/\s+/).filter((t) => t.length > 0).forEach(add);
          setInput("");
        }}
        onBackspace={() => {
          const t = bulkTags();
          if (t.length > 0) remove(t[t.length - 1]);
        }}
      />

      <div class="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button disabled={bulkTags().length === 0} onClick={start}>
          Select Images
        </Button>
      </div>
    </Modal>
  );
}

/** Bottom banner shown during bulk selection mode */
export function BulkBanner(props: {
  count: number;
  applying: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-t border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-3 shadow-lg">
      <span class="font-semibold whitespace-nowrap">{props.count} selected</span>
      <span class="text-sm text-gray-500 dark:text-gray-400 mr-auto hidden sm:inline">
        Click images to toggle selection
      </span>
      <Button
        disabled={props.applying}
        onClick={props.onApply}
      >
        {props.applying ? "Applying…" : "Apply"}
      </Button>
      <Button variant="secondary" onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** Helper: is an image "selected" for bulk tagging? */
export function imageHasAllBulkTags(img: ImageEntry, bulkTags: string[]): boolean {
  const imgTags = (img.tags || []).map((t) => t.toLowerCase());
  return bulkTags.every((t) => imgTags.includes(t));
}

export function isImageBulkSelected(
  img: ImageEntry,
  bulkTags: string[],
  toggled: Set<string>,
): boolean {
  const wasOriginal = bulkTags.length > 0 && imageHasAllBulkTags(img, bulkTags);
  return wasOriginal !== toggled.has(img.id);
}

export async function applyBulkTags(
  images: ImageEntry[],
  bulkTags: string[],
  toggled: Set<string>,
  updateImage: (id: string, entry: ImageEntry) => void,
): Promise<number> {
  let errors = 0;

  for (const img of images) {
    const wasOriginal = imageHasAllBulkTags(img, bulkTags);
    const shouldHave = wasOriginal !== toggled.has(img.id);

    if (shouldHave && !wasOriginal) {
      for (const tag of bulkTags) {
        if ((img.tags || []).map((t) => t.toLowerCase()).includes(tag)) continue;
        try {
          const entry = await api.addTag(img.id, tag);
          updateImage(img.id, entry);
        } catch { errors++; }
      }
    } else if (!shouldHave && wasOriginal) {
      for (const tag of bulkTags) {
        try {
          const entry = await api.removeTag(img.id, tag);
          updateImage(img.id, entry);
        } catch { errors++; }
      }
    }
  }

  return errors;
}
