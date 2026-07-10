const csrf = () => document.cookie.split("; ").find(v => v.startsWith("tw_csrf="))?.split("=")[1]?.split(".")[0] ?? "";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrf(), ...init.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir");
  return data;
}
