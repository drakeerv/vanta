// API client for Vanta backend

export interface Status {
  initialized: boolean;
  unlocked: boolean;
  authenticated: boolean;
}

export interface ImageEntry {
  id: string;
  original_mime: string;
  original_size: number;
  created_at: number;
  variants: string[];
  tags: string[];
}

export async function fetchStatus(): Promise<Status> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export async function setup(password: string): Promise<void> {
  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function unlock(password: string): Promise<void> {
  const res = await fetch("/api/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

export async function lockVault(): Promise<void> {
  await fetch("/api/lock", { method: "POST" });
}

export async function listImages(query?: string): Promise<ImageEntry[]> {
  const url = query ? `/api/images?q=${encodeURIComponent(query)}` : "/api/images";
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error("Failed to load images");
  return res.json();
}

export async function uploadImage(file: File): Promise<ImageEntry> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteImage(id: string): Promise<void> {
  const res = await fetch(`/api/images/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
}

export async function addTag(id: string, tag: string): Promise<ImageEntry> {
  const res = await fetch(`/api/images/${id}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok) throw new Error("Failed to add tag");
  return res.json();
}

export async function removeTag(id: string, tag: string): Promise<ImageEntry> {
  const res = await fetch(`/api/images/${id}/tags?tag=${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to remove tag");
  return res.json();
}

export async function listTags(): Promise<string[]> {
  const res = await fetch("/api/tags");
  if (!res.ok) throw new Error("Failed to load tags");
  return res.json();
}

export async function renameTag(
  oldTag: string,
  newTag: string,
): Promise<{ renamed: number }> {
  const res = await fetch("/api/tags/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_tag: oldTag, new_tag: newTag }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function thumbnailUrl(id: string): string {
  return `/api/images/${id}/thumbnail`;
}

export function highResUrl(id: string): string {
  return `/api/images/${id}/high`;
}

export function originalUrl(id: string): string {
  return `/api/images/${id}/original`;
}
