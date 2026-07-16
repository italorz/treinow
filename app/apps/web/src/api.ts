const csrf = () => document.cookie.split("; ").find(v => v.startsWith("tw_csrf="))?.split("=")[1]?.split(".")[0] ?? "";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", csrf());
  if (init.body != null && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/v1${path}`, {
    ...init,
    credentials: "include",
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir");
  return data;
}
