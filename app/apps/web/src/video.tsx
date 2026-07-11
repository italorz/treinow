import { Play, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Reproduz o vídeo do exercício sob demanda. Por padrão mostra apenas um botão
// de play (nenhum tráfego); com `eager` carrega assim que monta. Assim a
// paginação não dispara dezenas de downloads de vídeo simultâneos na VPS.
// Depois de carregado, a lupa abre o vídeo em tela cheia.
export function ExerciseVideo({ id, eager = false, controls = false, className = "" }: {
  id: string; eager?: boolean; controls?: boolean; className?: string;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  async function load() {
    if (url || loading) return;
    setLoading(true);
    try { const d = await api<{ url: string }>(`/exercises/${id}/video-url`); setUrl(d.url); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (eager) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, eager]);

  function fullscreen() {
    const video = videoRef.current as any;
    if (!video) return;
    // Em tela cheia os controles nativos ficam disponíveis; ao sair, voltam ao estado da prop.
    video.controls = true;
    const restore = () => { if (!document.fullscreenElement) { video.controls = controls; document.removeEventListener("fullscreenchange", restore); } };
    if (video.requestFullscreen) {
      document.addEventListener("fullscreenchange", restore);
      video.requestFullscreen().catch(() => { video.controls = controls; document.removeEventListener("fullscreenchange", restore); });
    } else if (video.webkitEnterFullscreen) { // iOS Safari
      video.addEventListener("webkitendfullscreen", () => { video.controls = controls; }, { once: true });
      video.webkitEnterFullscreen();
    } else {
      video.controls = controls;
    }
  }

  if (url) return <span className={`ex-video-wrap ${className}`}>
    <video ref={videoRef} className="ex-video" src={url} muted loop playsInline autoPlay controls={controls} preload="auto"/>
    <button type="button" className="zoom-badge" onClick={fullscreen} aria-label="Assistir em tela cheia"><ZoomIn size={14}/></button>
  </span>;
  return <button type="button" className={`video-poster ${className}`} onClick={load} aria-label="Reproduzir vídeo" disabled={loading}>
    <span className={loading ? "spinner" : "play-badge"}>{!loading && <Play size={18} fill="currentColor"/>}</span>
  </button>;
}
