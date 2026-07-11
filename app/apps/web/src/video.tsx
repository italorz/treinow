import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";

// Reproduz o vídeo do exercício sob demanda. Por padrão mostra apenas um botão
// de play (nenhum tráfego); com `eager` carrega assim que monta. Assim a
// paginação não dispara dezenas de downloads de vídeo simultâneos na VPS.
export function ExerciseVideo({ id, eager = false, controls = false, className = "" }: {
  id: string; eager?: boolean; controls?: boolean; className?: string;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    if (url || loading) return;
    setLoading(true);
    try { const d = await api<{ url: string }>(`/exercises/${id}/video-url`); setUrl(d.url); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (eager) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, eager]);
  if (url) return <video className={`ex-video ${className}`} src={url} muted loop playsInline autoPlay controls={controls} preload="auto"/>;
  return <button type="button" className={`video-poster ${className}`} onClick={load} aria-label="Reproduzir vídeo" disabled={loading}>
    <span className={loading ? "spinner" : "play-badge"}>{!loading && <Play size={18} fill="currentColor"/>}</span>
  </button>;
}
