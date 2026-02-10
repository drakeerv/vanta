import { createSignal, Show } from "solid-js";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { TagInput } from "./ui/Suggestions";
import * as api from "../api";
import type { VaultStore } from "../lib/store";

export function RenameTagModal(props: {
  open: boolean;
  onClose: () => void;
  store: VaultStore;
}) {
  const [oldTag, setOldTag] = createSignal("");
  const [newTag, setNewTag] = createSignal("");
  const [msg, setMsg] = createSignal("");
  const [msgType, setMsgType] = createSignal<"" | "error" | "success">("");
  const [loading, setLoading] = createSignal(false);

  const close = () => {
    setOldTag("");
    setNewTag("");
    setMsg("");
    setMsgType("");
    props.onClose();
  };

  const execute = async () => {
    const o = oldTag().trim();
    const n = newTag().trim();
    if (!o || !n) {
      setMsg("Both fields are required");
      setMsgType("error");
      return;
    }
    setLoading(true);
    try {
      const data = await api.renameTag(o, n);
      setMsg(`Renamed across ${data.renamed} image(s)`);
      setMsgType("success");
      props.store.refresh();
      setTimeout(close, 1200);
    } catch (e: any) {
      setMsg(e.message || "Failed to rename tag");
      setMsgType("error");
    }
    setLoading(false);
  };

  return (
    <Modal open={props.open} onClose={close} title="Rename Tag">
      <div class="flex flex-col gap-4">
        <div>
          <label class="text-xs text-gray-500 dark:text-gray-400 block mb-1">Current tag</label>
          <TagInput
            value={oldTag()}
            onInput={setOldTag}
            tags={props.store.tags()}
            placeholder="Select tag to rename"
          />
        </div>
        <Input
          label="New name"
          placeholder="New tag name"
          value={newTag()}
          onChange={setNewTag}
        />
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button disabled={loading()} onClick={execute}>
            {loading() ? "Renaming…" : "Rename"}
          </Button>
        </div>
        <Show when={msg()}>
          <p class={`text-sm font-medium ${msgType() === "error" ? "text-red-500" : "text-green-500"}`}>
            {msg()}
          </p>
        </Show>
      </div>
    </Modal>
  );
}
