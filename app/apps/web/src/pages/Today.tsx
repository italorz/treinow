import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function TodayPage() {
  const query = useQuery({ queryKey: ["today"], queryFn: () => api<any>("/workouts/today") });
  return <section className="page">
    <div className="page-title"><div><span className="eyebrow">SEU PLANO</span><h1>Hoje</h1></div><span className="streak"><Flame size={16}/> Continue firme</span></div>
    {query.isLoading && <CardSkeleton/>}
    {!query.data?.day && !query.isLoading && <div className="empty"><h2>Dia de recuperação</h2><p>Seu corpo evolui quando também descansa. Configure sua meta para gerar um novo plano.</p></div>}
    {query.data?.day && <><div className="workout-hero"><span>Treino de hoje</span><h2>{query.data.day.title}</h2><p>{query.data.day.exercises.length} exercícios · aproximadamente 45 min</p></div>
      <div className="exercise-list">{query.data.day.exercises.map((e: any, i: number) => <TodayExercise key={e.id} exercise={e} index={i}/>)}</div></>}
  </section>;
}
function TodayExercise({ exercise, index }: any) {
  const qc = useQueryClient(); const [done, setDone] = useState(false);
  async function complete() {
    await api("/workouts/logs", { method: "POST", body: JSON.stringify({ exerciseId: exercise.id, sets: exercise.sets, reps: Number.parseInt(exercise.reps) || 10, loadKg: 0 }) });
    setDone(true); qc.invalidateQueries({ queryKey: ["today"] });
  }
  return <article className={`today-card ${done ? "done" : ""}`}>
    <span className="exercise-number">{String(index + 1).padStart(2, "0")}</span>
    <TodayVideo id={exercise.id}/>
    <div className="grow">
      {exercise.phase === "aquecimento" && <span className="tag warm">Aquecimento</span>}
      {exercise.phase === "alongamento" && <span className="tag stretch">Alongamento</span>}
      {exercise.phase === "principal" && <span className="tag main">Treino principal</span>}
      <h3>{exercise.name}</h3><p>{exercise.sets} séries · {exercise.reps} reps · {exercise.restSeconds}s</p>
      {!!exercise.reserves?.length && <details className="reserves"><summary>Alternativas sem depender do aparelho</summary>{exercise.reserves.map((reserve: any) => <div key={reserve.id}><strong>{reserve.name}</strong><span>{reserve.equipment}</span></div>)}</details>}
    </div>
    <button className="check" aria-label="Concluir exercício" onClick={complete}>{done && <Check size={18}/>}</button>
  </article>;
}
function CardSkeleton() { return <div className="skeleton tall"/>; }
function TodayVideo({ id }: { id: string }) {
  const ref = useRef<HTMLVideoElement>(null); const [url, setUrl] = useState("");
  useEffect(() => { api<any>(`/exercises/${id}/video-url`).then(x => setUrl(x.url)); }, [id]);
  return <video ref={ref} className="video-placeholder" src={url} muted loop playsInline autoPlay preload="metadata"/>;
}
