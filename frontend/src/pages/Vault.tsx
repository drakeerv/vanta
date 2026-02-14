import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import * as api from "../api";
import { createVaultStore } from "../lib/store";
import { Suggestions } from "../components/ui/Suggestions";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

import { Header } from "../components/Header";
import { Gallery } from "../components/Gallery";
import { Lightbox } from "../components/Lightbox";
import { UploadModal } from "../components/UploadModal";
import { TagModal } from "../components/TagModal";
import { InfoModal } from "../components/InfoModal";
import { RenameTagModal } from "../components/RenameTagModal";
import {
  BulkTagModal,
  BulkBanner,
  isImageBulkSelected,
  applyBulkTags,
} from "../components/BulkTag";
import type { Page } from "../App";

type ModalType = "upload" | "tag" | "info" | "bulkSetup" | "rename" | null;

export default function Vault(props: { onStatusChange: () => void; onNavigate: (page: Page) => void }) {
  const store = createVaultStore(props.onStatusChange);

  // ── UI state ──
  const [modal, setModal] = createSignal<ModalType>(null);
  const [searchInput, setSearchInput] = createSignal("");
  const [searchFocused, setSearchFocused] = createSignal(false);

  // ── Lightbox ──
  const [lightboxId, setLightboxId] = createSignal<string | null>(null);
  const lightboxImage = () => store.images().find((img) => img.id === lightboxId()) ?? null;

  // ── Bulk tag ──
  const [bulkMode, setBulkMode] = createSignal(false);
  const [bulkTags, setBulkTags] = createSignal<string[]>([]);
  const [bulkToggled, setBulkToggled] = createSignal<Set<string>>(new Set());
  const [bulkApplying, setBulkApplying] = createSignal(false);

  // ── Body scroll lock ──
  createEffect(() => {
    document.body.style.overflow = lightboxId() || modal() ? "hidden" : "";
  });
  onCleanup(() => { document.body.style.overflow = ""; });

  // ── Init ──
  onMount(() => store.refresh());

  // ── Search ──
  const doSearch = () => store.loadImages(searchInput().trim() || undefined);

  // ── Lightbox actions ──
  const openLightbox = (id: string) => {
    if (bulkMode()) {
      setBulkToggled((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setLightboxId(id);
  };

  const closeLightbox = () => { setLightboxId(null); setModal(null); };

  const deleteCurrentImage = async () => {
    const id = lightboxId();
    if (!id || !confirm("Delete this image?")) return;
    try { await api.deleteImage(id); closeLightbox(); store.refresh(); }
    catch { alert("Failed to delete image"); }
  };

  // ── Bulk tag flow ──
  const bulkSelectedCount = () =>
    store.images().filter((img) => isImageBulkSelected(img, bulkTags(), bulkToggled())).length;

  const cancelBulk = () => {
    setBulkMode(false);
    setBulkTags([]);
    setBulkToggled(new Set<string>());
    setModal(null);
  };

  const handleApplyBulk = async () => {
    setBulkApplying(true);
    const errors = await applyBulkTags(
      store.images(),
      bulkTags(),
      bulkToggled(),
      store.updateImage,
    );
    setBulkApplying(false);
    if (errors > 0) alert(`${errors} operation(s) failed`);
    cancelBulk();
    store.refresh();
  };

  // ── Keyboard ──
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (bulkMode()) { cancelBulk(); return; }
    if (modal()) { setModal(null); return; }
    if (lightboxId()) { closeLightbox(); return; }
  };
  onMount(() => document.addEventListener("keydown", onKeyDown));
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <div>
      <Header
        onUpload={() => setModal("upload")}
        onBulkTag={() => setModal("bulkSetup")}
        onRenameTag={() => setModal("rename")}
        onStatusChange={props.onStatusChange}
        onNavigate={props.onNavigate}
      />

      <main class="max-w-7xl mx-auto p-4">
        {/* Search bar */}
        <div class="relative flex gap-2 mb-4 bg-white dark:bg-gray-900 rounded-lg p-2 shadow-sm">
          <div class="relative flex-1">
            <Input
              placeholder="Search tags…"
              value={searchInput()}
              onChange={setSearchInput}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); doSearch(); setSearchFocused(false); }
                if (e.key === "Escape") setSearchFocused(false);
              }}
            />
            <Suggestions
              input={searchInput()}
              tags={store.tags()}
              visible={searchFocused()}
              onSelect={setSearchInput}
            />
          </div>
          <Button onClick={doSearch}>Search</Button>
        </div>

        <h3 class="text-lg font-semibold mb-3">
          Images <span class="text-gray-400 dark:text-gray-500 font-normal">({store.images().length})</span>
        </h3>

        <Gallery
          images={store.images()}
          emptyText={searchInput().trim() ? "No images match this search." : "No images yet. Upload some!"}
          bulkMode={bulkMode()}
          isSelected={(img) => isImageBulkSelected(img, bulkTags(), bulkToggled())}
          onImageClick={openLightbox}
        />
      </main>

      {/* ── Lightbox ── */}
      <Lightbox
        image={lightboxImage()}
        onClose={closeLightbox}
        onTag={() => setModal("tag")}
        onInfo={() => setModal("info")}
        onDelete={deleteCurrentImage}
        onImageUpdate={(id, entry) => store.updateImage(id, entry)}
      />

      {/* ── Modals ── */}
      <UploadModal open={modal() === "upload"} onClose={() => setModal(null)} store={store} />
      <TagModal open={modal() === "tag"} onClose={() => setModal(null)} image={lightboxImage()} store={store} />
      <InfoModal open={modal() === "info"} onClose={() => setModal(null)} image={lightboxImage()} />
      <RenameTagModal open={modal() === "rename"} onClose={() => setModal(null)} store={store} />
      <BulkTagModal
        open={modal() === "bulkSetup"}
        onClose={cancelBulk}
        onStart={(tags) => { setBulkTags(tags); setBulkToggled(new Set<string>()); setBulkMode(true); setModal(null); }}
        tags={store.tags()}
      />

      {/* ── Bulk Banner ── */}
      <Show when={bulkMode()}>
        <BulkBanner
          count={bulkSelectedCount()}
          applying={bulkApplying()}
          onApply={handleApplyBulk}
          onCancel={cancelBulk}
        />
      </Show>
    </div>
  );
}
