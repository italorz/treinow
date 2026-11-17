import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { browserSpeech, parseScript } from "./speech";

const VideoContext = createContext<{ startVideo?: () => Promise<void> } | null>(null);
export function ExerciseMedia({ children }: { children: ReactNode }) {
  const controller = useRef<{ startVideo?: () => Promise<void> }>({});
  return <VideoContext.Provider value={controller.current}>{children}</VideoContext.Provider>;
}
export const useExerciseMedia = () => useContext(VideoContext);
export type Cue = { start: number; end: number; text: string };
type SpeechResponse = { status: "preparing"; text: string; lines: { text: string; pause: number }[] } | { status: "ready"; audioUrl: string; cues: Cue[]; durationSeconds: number; text: string };

export function NarrationPlayer({ id, text }: { id: string; text: string }) {
  const video = useExerciseMedia();
  const audio = useRef<HTMLAudioElement>(null);
  const browser = useRef<ReturnType<typeof browserSpeech> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usingBrowser, setUsingBrowser] = useState(false);
  const [cues, setCues] = useState<Cue[]>([]);
  const [script, setScript] = useState(text);
  const [active, setActive] = useState(-1);
  const [showText, setShowText] = useState(true);
  const generation = useRef(0);
  const sourceExpires = useRef(0);
  const requested = useRef(false);
  const scriptRef = useRef(text);
  const resumeAt = useRef(0);
  const lines = parseScript(script);
  const startVideo = () => { void video?.startVideo?.().catch(() => {}); };
  useEffect(() => {
    const player = audio.current;
    return () => { requested.current = false; generation.current++; player?.pause(); browser.current?.stop(); browser.current = null; };
  }, [id, text]);
  function stop() {
    generation.current++;
    requested.current = false;
    resumeAt.current = 0;
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    browser.current?.stop(); browser.current = null;
    setActive(-1); setLoading(false); setPlaying(false);
  }
  function fallback() {
    if (!requested.current || browser.current) return;
    sourceExpires.current = 0;
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("Não foi possível preparar a voz. Você pode acompanhar a orientação no texto abaixo.");
      setPlaying(false); return;
    }
    audio.current?.pause();
    setError("");
    const failed = () => {
      requested.current = false; browser.current = null; setPlaying(false); setActive(-1);
      setError("A voz do navegador está indisponível. Acompanhe a orientação no texto abaixo.");
    };
    setUsingBrowser(true);
    setPlaying(true);
    try {
      browser.current = browserSpeech(scriptRef.current, setActive, () => {
        requested.current = false; browser.current = null; setPlaying(false); setActive(-1);
      }, failed);
      startVideo();
    } catch { failed(); }
  }
  async function play() {
    if (!audio.current || loading) return;
    if (browser.current) { browser.current.resume(); setPlaying(true); startVideo(); return; }
    requested.current = true;
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      if (!audio.current.src || sourceExpires.current <= Date.now()) {
        const data = await api<SpeechResponse>(`/exercises/${id}/speech`);
        if (current !== generation.current || !audio.current) return;
        setScript(data.text); scriptRef.current = data.text;
        if (data.status === "preparing") { fallback(); return; }
        setCues(data.cues); setUsingBrowser(false);
        resumeAt.current = audio.current.currentTime;
        audio.current.src = data.audioUrl;
        sourceExpires.current = Date.now() + 14 * 60_000;
      }
      if (current === generation.current) await audio.current.play();
    } catch {
      if (current === generation.current) fallback();
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  function pause() { audio.current?.pause(); browser.current?.pause(); setPlaying(false); }
  return <div className="narration-player">
    <audio ref={audio} preload="none" aria-label="Orientação do instrutor"
      onLoadedMetadata={e => { e.currentTarget.currentTime = resumeAt.current; }}
      onPlay={() => { setPlaying(true); startVideo(); }} onPause={() => { if (!browser.current) setPlaying(false); }}
      onTimeUpdate={e => { if (!browser.current) setActive(cues.findIndex(cue => e.currentTarget.currentTime >= cue.start && e.currentTarget.currentTime < cue.end)); }}
      onEnded={stop} onError={() => { sourceExpires.current = 0; if (!browser.current) fallback(); }}/>
    <div className="narration-actions">
      <button type="button" disabled={loading} onClick={() => playing ? pause() : void play()}>{loading ? "Preparando a voz do instrutor…" : playing ? "Pausar" : "Ouvir orientação do instrutor"}</button>
      <button type="button" onClick={stop}>Parar</button>
      <button type="button" aria-pressed={showText} onClick={() => setShowText(value => !value)}>Mostrar texto</button>
    </div>
    {showText && <div className="narration-script" aria-label="Texto da orientação">{lines.map((line, index) =>
      <p key={index} className={`${line.pause === 800 ? "narration-block " : ""}${active === index ? "narration-active" : ""}`} aria-current={active === index ? "true" : undefined}>{line.text}</p>)}</div>}
    {usingBrowser && <p className="muted" role="status">Usando a voz do navegador enquanto a voz do instrutor é preparada.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
