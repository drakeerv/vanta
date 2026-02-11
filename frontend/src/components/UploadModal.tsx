import { createSignal, Show } from "solid-js";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import * as api from "../api";
import { MAX_FILE_SIZE } from "../lib/utils";
import type { VaultStore } from "../lib/store";

export function UploadModal(props: {
  open: boolean;
  onClose: () => void;
  store: VaultStore;
}) {
  const [files, setFiles] = createSignal<FileList | null>(null);
  const [msg, setMsg] = createSignal("");
  const [msgType, setMsgType] = createSignal<"" | "error" | "success">("");
  const [uploading, setUploading] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;

  const reset = () => {
    setFiles(null);
    setMsg("");
    setMsgType("");
    if (fileInputRef) fileInputRef.value = "";
  };

  const close = () => {
    reset();
    props.onClose();
  };

  const upload = async () => {
    const f = files();
    if (!f || f.length === 0) return;
    setUploading(true);
    setMsg("");
    setMsgType("");
    let success = 0, errors = 0;

    for (let i = 0; i < f.length; i++) {
      if (f[i].size > MAX_FILE_SIZE) { errors++; continue; }
      setMsg(`Uploading ${i + 1} of ${f.length}…`);
      try { await api.uploadImage(f[i]); success++; }
      catch { errors++; }
    }

    setUploading(false);
    if (errors === 0) {
      setMsg(`${success} image${success > 1 ? "s" : ""} uploaded`);
      setMsgType("success");
      setTimeout(close, 1000);
      props.store.refresh();
    } else if (success > 0) {
      setMsg(`${success} uploaded, ${errors} failed`);
      setMsgType("error");
      props.store.refresh();
    } else {
      setMsg("Upload failed");
      setMsgType("error");
    }
  };

  const fileInfo = () => {
    const f = files();
    if (!f || f.length === 0) return "";
    return f.length === 1 ? f[0].name : `${f.length} files selected`;
  };

  return (
    <Modal open={props.open} onClose={close} title="Upload Images">
      <div
        class={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragging() ? "border-gray-500 bg-gray-50 dark:bg-gray-800/50" : "border-gray-300 dark:border-gray-600"
        }`}
        onClick={() => fileInputRef?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files.length) setFiles(e.dataTransfer.files); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/avif,image/webp,image/gif,image/jxl"
          multiple
          class="hidden"
          onChange={(e) => { if (e.currentTarget.files?.length) setFiles(e.currentTarget.files); }}
        />
        <p class="text-gray-500 dark:text-gray-400">Drag & drop images here or click to browse</p>
        <p class="text-xs text-gray-400 mt-1">Supports JPEG, PNG, AVIF, WebP, GIF, JXL (max 50 MB each)</p>
      </div>

      <Show when={files()}>
        <div class="flex items-center gap-2 mt-4">
          <span class="text-sm text-gray-500 dark:text-gray-400 flex-1 truncate">{fileInfo()}</span>
          <Button disabled={uploading()} onClick={upload}>Upload</Button>
          <Button variant="secondary" onClick={reset}>Cancel</Button>
        </div>
      </Show>

      <Show when={msg()}>
        <p class={`mt-3 text-sm font-medium ${
          msgType() === "error" ? "text-red-500" : msgType() === "success" ? "text-green-500" : "text-gray-500"
        }`}>
          {msg()}
        </p>
      </Show>
    </Modal>
  );
}
