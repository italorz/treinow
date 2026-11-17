import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { browserSpeech, parseScript } from "./speech";

const VideoContext = createContext<{ startVideo?: () => Promise<void> } | null>(null);
export function ExerciseMedia({ children }: { children: ReactNode }) {
  const controller = useRef<{ startVideo?: () => Promise<void> }>({});
  return <VideoContext.Provider value={controller.current}>{children}</VideoContext.Provider>;
}
export const useExerciseMedia = () => useContext(VideoContext);

export function NarrationPlayer({ text }: { text: string }) {
  const video = useExerciseMedia();
  const browser = useRef<ReturnType<typeof browserSpeech> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const [showText, setShowText] = useState(true);
  const scriptRef = useRef(text);
  scriptRef.current = text;
  const lines = parseScript(text);
  const startVideo = () => { void video?.startVideo?.().catch(() => {}); };
  useEffect(() => {
    return () => { browser.current?.stop(); browser.current = null; };
  }, [text]);
  function stop() {
    browser.current?.stop(); browser.current = null;
    setActive(-1); setPlaying(false);
  }
  function play() {
    if (browser.current) { browser.current.resume(); setPlaying(true); startVideo(); return; }
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("Não foi possível preparar a voz. Você pode acompanhar a orientação no texto abaixo.");
      return;
    }
    const failed = () => {
      browser.current = null; setPlaying(false); setActive(-1);
      setError("A voz do navegador está indisponível. Acompanhe a orientação no texto abaixo.");
    };
    setError("");
    setPlaying(true);
    try {
      browser.current = browserSpeech(scriptRef.current, setActive, () => {
        browser.current = null; setPlaying(false); setActive(-1);
      }, failed);
      startVideo();
    } catch { failed(); }
  }
  function pause() { browser.current?.pause(); setPlaying(false); }
  return <div className="narration-player">
    <div className="narration-actions">
      <button type="button" onClick={() => playing ? pause() : play()}>{playing ? "Pausar" : "Ouvir orientação do instrutor"}</button>
      <button type="button" onClick={stop}>Parar</button>
      <button type="button" aria-pressed={showText} onClick={() => setShowText(value => !value)}>Mostrar texto</button>
    </div>
    {showText && <div className="narration-script" aria-label="Texto da orientação">{lines.map((line, index) =>
      <p key={index} className={`${line.pause === 800 ? "narration-block " : ""}${active === index ? "narration-active" : ""}`} aria-current={active === index ? "true" : undefined}>{line.text}</p>)}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
