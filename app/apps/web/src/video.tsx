import { X, ZoomIn } from "lucide-react";
import { useEffect, useState, type SyntheticEvent } from "react";
import { api } from "./api";

const blockContextMenu = (e: SyntheticEvent) => e.preventDefault();
const videoUrls = new Map<string, { url: string; expiresAt: number }>();

export function clearVideoCache() {
  videoUrls.clear();
}

async function getVideoUrl(id: string, variant = "") {
  const key = `${id}:${variant}`;
  const cached = videoUrls.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const data = await api<{ url: string }>(`/exercises/${id}/video-url${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`);
  videoUrls.set(key, { url: data.url, expiresAt: Date.now() + 4 * 60_000 });
  return data.url;
}

// Reproduz o vídeo do exercício automaticamente, em loop, como uma miniatura
// animada. A lupa abre o mesmo modal limitado usado na biblioteca. Download
// desabilitado em todos os players: sem botão
// de download, sem menu de contexto e sem picture-in-picture.
export function ExerciseVideo({ id, variant = "", eager = true, controls = false, className = "", zoomable = true }: {
  id: string; variant?: string; eager?: boolean; controls?: boolean; className?: string; zoomable?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    if (url || loading) return;
    setLoading(true);
    setError(false);
    try { setUrl(await getVideoUrl(id, variant)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    setUrl("");
    setError(false);
    if (eager) getVideoUrl(id, variant).then(value => { if (!cancelled) setUrl(value); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, variant, eager]);

  if (url) return <>
    <span className={`ex-video-wrap ${className}`}>
      <video className="ex-video" src={url} muted loop playsInline autoPlay preload="auto"
        controls={controls} controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={blockContextMenu}/>
      {zoomable && <button type="button" className="zoom-badge" onClick={() => setZoom(true)} aria-label="Ampliar vídeo"><ZoomIn size={14}/></button>}
    </span>
    {zoom && <VideoLightbox id={id} variant={variant} onClose={() => setZoom(false)}/>}
  </>;
  if (error) return <button type="button" className={`video-poster ${className}`} onClick={load}>Vídeo indisponível. Tentar novamente</button>;
  if (!eager) return <button type="button" className={`video-poster alternative-poster ${className}`} onClick={load} aria-label="Carregar vídeo do exercício">
    <img src="/assets/ecorche.png" alt="" aria-hidden="true"/><span className="alternative-play">▶</span>
  </button>;
  return <span className={`video-poster ${className}`} aria-label="Carregando vídeo"><span className="spinner"/></span>;
}

// Modal ampliado limitado ao tamanho do modal da biblioteca; toque fora ou Esc fecha.
// Busca uma URL assinada nova ao abrir, pois a anterior pode ter expirado.
function VideoLightbox({ id, variant = "", onClose }: { id: string; variant?: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { getVideoUrl(id, variant).then(setUrl); }, [id, variant]);
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
