import { api } from "./api";

const urls = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();
let generation = 0;

export function clearVideoCache() {
  generation++;
  urls.clear();
  pending.clear();
}

export function getVideoUrl(id: string, variant = ""): Promise<string> {
  const key = `${id}:${variant}`;
  const cached = urls.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);
  const current = pending.get(key);
  if (current) return current;
  const startedIn = generation;
  const request = api<{ url: string }>(`/exercises/${id}/video-url${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`)
    .then(data => {
      if (!data.url) throw new Error("URL do vídeo indisponível");
      if (startedIn === generation) urls.set(key, { url: data.url, expiresAt: Date.now() + 4 * 60_000 });
      return data.url;
    })
    .finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}
