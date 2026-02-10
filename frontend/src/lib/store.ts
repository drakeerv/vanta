import { createSignal } from "solid-js";
import * as api from "../api";
import type { ImageEntry } from "../api";

/**
 * Shared vault data store. Single source of truth for images & tags,
 * consumed by all feature components.
 */
export function createVaultStore(onUnauthorized: () => void) {
  const [images, setImages] = createSignal<ImageEntry[]>([]);
  const [tags, setTags] = createSignal<string[]>([]);

  const loadImages = async (query?: string) => {
    try {
      setImages(await api.listImages(query || undefined));
    } catch (e: any) {
      if (e.message === "unauthorized") onUnauthorized();
    }
  };

  const loadTags = async () => {
    try {
      setTags(await api.listTags());
    } catch {}
  };

  const refresh = (query?: string) => {
    loadImages(query);
    loadTags();
  };

  const updateImage = (id: string, entry: ImageEntry) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, tags: entry.tags } : img)));
  };

  return { images, setImages, tags, loadImages, loadTags, refresh, updateImage };
}

export type VaultStore = ReturnType<typeof createVaultStore>;
