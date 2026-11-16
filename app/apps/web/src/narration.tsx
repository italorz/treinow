import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";

const VideoContext = createContext<{ startVideo?: () => Promise<void> } | null>(null);
export function ExerciseMedia({ children }: { children: ReactNode }) {
  const controller = useRef<{ startVideo?: () => Promise<void> }>({});
  return <VideoContext.Provider value={controller.current}>{children}</VideoContext.Provider>;
}
export const useExerciseMedia = () => useContext(VideoContext);

export type Cue = { start: number; end: number; text: string };
export function parseVtt(text: string): Cue[] {
  const seconds = (stamp: string) => stamp.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return text.replace(/\r/g, "").split(/\n\s*\n/).flatMap(block => {
    const lines = block.trim().split("\n");
    const index = lines.findIndex(line => line.includes(" --> "));
    if (index < 0) return [];
    const [start, end] = lines[index].split(" --> ").map(value => seconds(value.trim().split(/\s+/)[0]));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ start, end, text: lines.slice(index + 1).join("\n").replace(/<[^>]*>/g, "") }];
  });
}

export function NarrationPlayer({ id }: { id: string }) {
  const video = useExerciseMedia();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cues, setCues] = useState<Cue[]>([]);
  const [time, setTime] = useState(0);
  const [captions, setCaptions] = useState(true);
  const generation = useRef(0);
  const sourceExpires = useRef(0);
  const resumeAt = useRef(0);
  useEffect(() => {
    const player = audio.current;
    return () => { generation.current++; player?.pause(); };
  }, [id]);

  async function play() {
    if (!audio.current || loading) return;
    const current = generation.current;
    setLoading(true); setError("");
    try {
      if (!audio.current.src || sourceExpires.current <= Date.now()) {
        const urls = await api<{ audioUrl: string; subtitlesUrl: string }>(`/exercises/${id}/narration-url`);
        const response = await fetch(urls.subtitlesUrl, { credentials: "include" });
        if (!response.ok) throw new Error("Não foi possível carregar as legendas.");
        const parsed = parseVtt(await response.text());
        if (current !== generation.current || !audio.current) return;
        setCues(parsed);
        resumeAt.current = audio.current.currentTime;
        audio.current.src = urls.audioUrl;
        sourceExpires.current = Date.now() + 4 * 60_000;
      }
      if (current !== generation.current) return;
      await audio.current.play();
    } catch {
      if (current === generation.current) setError("Não foi possível tocar a explicação. Tente novamente.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  function stop() {
    generation.current++;
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    resumeAt.current = 0;
    setTime(0); setLoading(false); setPlaying(false);
  }
  const caption = cues.filter(cue => time >= cue.start && time < cue.end).map(cue => cue.text).join("\n");
  return <div className="narration-player">
    <audio ref={audio} preload="none" aria-label="Explicação do exercício" onLoadedMetadata={e => { e.currentTarget.currentTime = resumeAt.current; }}
      onPlay={() => { setPlaying(true); void video?.startVideo?.().catch(() => {}); }} onPause={() => setPlaying(false)}
      onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onEnded={stop}
      onError={() => { sourceExpires.current = 0; setPlaying(false); setError("Áudio indisponível. Tente novamente."); }}/>
    <div className="narration-actions">
      <button type="button" disabled={loading} onClick={() => playing ? audio.current?.pause() : void play()} aria-label={playing ? "Pausar explicação" : "Ouvir explicação"}>{loading ? "Carregando…" : playing ? "Pausar explicação" : "Ouvir explicação"}</button>
      {(playing || time > 0 || loading) && <button type="button" onClick={stop} aria-label="Parar explicação">Parar</button>}
      <button type="button" aria-label="Legendas" aria-pressed={captions} onClick={() => setCaptions(value => !value)}>Legendas</button>
    </div>
    {captions && caption && <p className="narration-caption" aria-label="Legenda da explicação">{caption}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
