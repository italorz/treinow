import { X, ZoomIn } from "lucide-react";
import { useEffect, useState, type SyntheticEvent } from "react";
import { api } from "./api";

const blockContextMenu = (e: SyntheticEvent) => e.preventDefault();

// Reproduz o vídeo do exercício automaticamente, em loop, como uma miniatura
// animada. A lupa abre o mesmo modal limitado usado na biblioteca. Download
// desabilitado em todos os players: sem botão
// de download, sem menu de contexto e sem picture-in-picture.
export function ExerciseVideo({ id, eager = true, controls = false, className = "", zoomable = true }: {
  id: string; eager?: boolean; controls?: boolean; className?: string; zoomable?: boolean;
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
      {zoomable && <button type="button" className="zoom-badge" onClick={() => setZoom(true)} aria-label="Ampliar vídeo"><ZoomIn size={14}/></button>}
    </span>
    {zoom && <VideoLightbox id={id} onClose={() => setZoom(false)}/>}
  </>;
  return <span className={`video-poster ${className}`} aria-label="Carregando vídeo"><span className="spinner"/></span>;
}

// Modal ampliado limitado ao tamanho do modal da biblioteca; toque fora ou Esc fecha.
// Busca uma URL assinada nova ao abrir, pois a anterior pode ter expirado.
function VideoLightbox({ id, onClose }: { id: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { api<{ url: string }>(`/exercises/${id}/video-url`).then(d => setUrl(d.url)); }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal video-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button>
      {url ? <video className="modal-video" src={url} muted loop playsInline autoPlay preload="auto" controls
        controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={blockContextMenu}/>
        : <span className="spinner"/>}
    </div>
  </div>;
}
