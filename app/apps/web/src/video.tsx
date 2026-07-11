import { Play, X, ZoomIn } from "lucide-react";
import { useEffect, useState, type MouseEvent, type SyntheticEvent } from "react";
import { api } from "./api";

const blockContextMenu = (e: SyntheticEvent) => e.preventDefault();

// Reproduz o vídeo do exercício sob demanda. Por padrão mostra apenas um botão
// de play (nenhum tráfego); com `eager` carrega assim que monta. A lupa abre
// um modal em tela cheia. Download desabilitado em todos os players: sem botão
// de download, sem menu de contexto e sem picture-in-picture.
export function ExerciseVideo({ id, eager = false, controls = false, className = "" }: {
  id: string; eager?: boolean; controls?: boolean; className?: string;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(false);
  async function load() {
    if (url || loading) return;
    setLoading(true);
    try { const d = await api<{ url: string }>(`/exercises/${id}/video-url`); setUrl(d.url); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (eager) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, eager]);

  if (url) return <>
    <span className={`ex-video-wrap ${className}`}>
      <video className="ex-video" src={url} muted loop playsInline autoPlay preload="auto"
        controls={controls} controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={blockContextMenu}/>
      <button type="button" className="zoom-badge" onClick={() => setZoom(true)} aria-label="Assistir em tela cheia"><ZoomIn size={14}/></button>
    </span>
    {zoom && <VideoLightbox id={id} onClose={() => setZoom(false)}/>}
  </>;
  return <button type="button" className={`video-poster ${className}`} onClick={load} aria-label="Reproduzir vídeo" disabled={loading}>
    <span className={loading ? "spinner" : "play-badge"}>{!loading && <Play size={18} fill="currentColor"/>}</span>
  </button>;
}

// Modal em tela cheia: toque no vídeo pausa/continua, toque fora ou Esc fecha.
// Busca uma URL assinada nova ao abrir, pois a anterior pode ter expirado.
function VideoLightbox({ id, onClose }: { id: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { api<{ url: string }>(`/exercises/${id}/video-url`).then(d => setUrl(d.url)); }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  function togglePlay(e: MouseEvent<HTMLVideoElement>) {
    e.stopPropagation();
    const video = e.currentTarget;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }
  return <div className="video-lightbox" onClick={onClose}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button>
    {url
      ? <video src={url} muted loop playsInline autoPlay preload="auto"
          controlsList="nodownload noremoteplayback" disablePictureInPicture
          onContextMenu={blockContextMenu} onClick={togglePlay}/>
      : <span className="spinner"/>}
  </div>;
}
