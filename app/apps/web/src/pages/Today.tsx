import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { ExerciseVideo } from "../video";
import { EquipmentIcon } from "../equipment";

const phaseOrder: Record<string, number> = { alongamento: 0, aquecimento: 1, principal: 2 };

export function TodayPage() {
  const query = useQuery({ queryKey: ["today"], queryFn: () => api<any>("/workouts/today") });
  return <section className="page">
    <div className="page-title"><div><span className="eyebrow">SEU PLANO</span><h1>Hoje</h1></div><span className="streak"><Flame size={16}/> Continue firme</span></div>
    {query.isLoading && <CardSkeleton/>}
    {!query.data?.day && !query.isLoading && <div className="empty"><h2>Dia de recuperação</h2><p>Seu corpo evolui quando também descansa. Configure sua meta para gerar um novo plano.</p></div>}
    {query.data?.day && <><div className="workout-hero"><span>Treino de hoje</span><h2>{query.data.day.title}</h2><p>{query.data.day.exercises.length} exercícios · aproximadamente 45 min</p></div>
      <div className="exercise-list">{[...query.data.day.exercises].sort((a: any,b: any) => (phaseOrder[a.phase] ?? 99)-(phaseOrder[b.phase] ?? 99)).map((e: any, i: number) => <TodayExercise key={e.id} exercise={e} index={i}/>)}</div></>}
  </section>;
}
function TodayExercise({ exercise, index }: any) {
  const qc = useQueryClient(); const [done, setDone] = useState(false);
  async function complete() {
    await api("/workouts/logs", { method: "POST", body: JSON.stringify({ exerciseId: exercise.id, sets: exercise.sets, reps: Number.parseInt(exercise.reps) || 10, loadKg: 0 }) });
    setDone(true); qc.invalidateQueries({ queryKey: ["today"] });
  }
  const [showReserves, setShowReserves] = useState(false);
  return <article className={`today-card ${done ? "done" : ""}`}>
    <span className="exercise-number">{String(index + 1).padStart(2, "0")}</span>
    <ExerciseVideo id={exercise.id} eager className="video-placeholder"/>
    <div className="grow">
      {exercise.phase === "aquecimento" && <span className="tag warm">Aquecimento</span>}
      {exercise.phase === "alongamento" && <span className="tag stretch">Alongamento</span>}
      {exercise.phase === "principal" && <span className="tag main">Treino principal</span>}
      <h3>{exercise.name}</h3><p>{exercise.sets} séries · {exercise.reps} reps · {exercise.restSeconds}s</p>
      {!!exercise.reserves?.length && <details className="reserves" onToggle={e => setShowReserves((e.target as HTMLDetailsElement).open)}>
        <summary>Alternativas sem depender do aparelho</summary>
        {showReserves && exercise.reserves.map((reserve: any) => <div key={reserve.id} className="reserve-row">
          <ExerciseVideo id={reserve.id} eager={false} className="reserve-video"/>
          <div><strong>{reserve.name}</strong><EquipmentIcon equipment={reserve.equipment} name={reserve.name}/></div>
        </div>)}
      </details>}
    </div>
    <button className="check" aria-label="Concluir exercício" onClick={complete}>{done && <Check size={18}/>}</button>
  </article>;
}
function CardSkeleton() { return <div className="skeleton tall"/>; }
