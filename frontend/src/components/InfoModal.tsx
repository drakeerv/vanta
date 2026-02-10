import { Modal } from "./ui/Modal";
import type { ImageEntry } from "../api";
import { formatBytes } from "../lib/utils";

export function InfoModal(props: {
  open: boolean;
  onClose: () => void;
  image: ImageEntry | null;
}) {
  const img = () => props.image;

  return (
    <Modal open={props.open} onClose={props.onClose} title="Image Info">
      {img() && (
        <div class="flex flex-col gap-3">
          <Row label="ID" value={img()!.id} mono />
          <Row label="Format" value={img()!.original_mime} />
          <Row label="Original Size" value={formatBytes(img()!.original_size)} />
          <Row label="Created" value={new Date(img()!.created_at * 1000).toLocaleString()} />
          <Row label="Variants" value={(img()!.variants || []).join(", ") || "None"} />
          <Row label="Tags" value={(img()!.tags || []).join(", ") || "None"} />
        </div>
      )}
    </Modal>
  );
}

function Row(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="flex gap-4 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span class="text-sm font-medium text-gray-500 dark:text-gray-400 min-w-24">{props.label}</span>
      <span class={`text-sm flex-1 ${props.mono ? "font-mono text-xs break-all" : ""}`}>{props.value}</span>
    </div>
  );
}
