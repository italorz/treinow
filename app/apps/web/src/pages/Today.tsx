import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Play, Square, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { EquipmentIcon } from "../equipment";
import { ExerciseVideo } from "../video";

const phaseOrder: Record<string, number> = { alongamento: 0, aquecimento: 1, principal: 2 };

export function TodayPage() {
  const qc = useQueryClient();
  const dayQuery = useQuery({ queryKey: ["today"], queryFn: () => api<any>("/workouts/today") });
  const sessionQuery = useQuery({ queryKey: ["workout-session-today"], queryFn: () => api<any>("/workouts/sessions/today") });
  const [finishStep, setFinishStep] = useState<null | "missing" | "comment">(null);
  const [missingCount, setMissingCount] = useState(0); const [comment, setComment] = useState("");
  const session = sessionQuery.data?.session;
  const start = useMutation({ mutationFn: () => api<any>("/workouts/sessions/start", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["workout-session-today"] }) });
  async function choose(slotExerciseId: string, selectedExerciseId: string) {
    if (!session || session.status !== "active") return;
    const selected = session.selections?.[slotExerciseId] === selectedExerciseId ? null : selectedExerciseId;
    await api(`/workouts/sessions/${session.id}/selection`, { method: "PATCH", body: JSON.stringify({ slotExerciseId, selectedExerciseId: selected }) });
    await qc.invalidateQueries({ queryKey: ["workout-session-today"] });
  }
  async function finish(confirmIncomplete = false, finalComment = "") {
    const result = await api<any>(`/workouts/sessions/${session.id}/finish`, { method: "POST", body: JSON.stringify({ confirmIncomplete, comment: finalComment }) });
    if (result.requiresConfirmation) { setMissingCount(result.missingCount); setFinishStep("missing"); return; }
    setFinishStep(null); await qc.invalidateQueries({ queryKey: ["workout-session-today"] });
  }
  const day = dayQuery.data?.day; const active = session?.status === "active";
  return <section className="page">
    <div className="page-title"><div><span className="eyebrow">SEU PLANO</span><h1>Hoje</h1></div><span className="streak"><Flame size={16}/> Continue firme</span></div>
    {dayQuery.isLoading && <div className="skeleton tall"/>}
    {!day && !dayQuery.isLoading && <div className="empty"><h2>Dia de recuperação</h2><p>Seu corpo evolui quando também descansa.</p></div>}
    {day && <><div className="workout-hero"><span>{active ? "TREINO EM ANDAMENTO" : session?.status === "finished" ? "TREINO FINALIZADO" : "TREINO DE HOJE"}</span><h2>{day.title}</h2><p>{day.exercises.length} exercícios · aproximadamente 45 min</p></div>
      {!session && <button className="primary session-action" onClick={() => start.mutate()} disabled={start.isPending}><Play size={17} fill="currentColor"/> Iniciar treino</button>}
      <div className="exercise-list">{[...day.exercises].sort((a:any,b:any)=>(phaseOrder[a.phase]??99)-(phaseOrder[b.phase]??99)).map((exercise:any,index:number)=><TodayExercise key={exercise.id} exercise={exercise} index={index} active={active} selectedId={session?.selections?.[exercise.id]} onChoose={choose}/>)}</div>
      {active && <button className="primary session-action finish" onClick={() => finish()}><Square size={16} fill="currentColor"/> Finalizar treino</button>}
    </>}
    {finishStep === "missing" && <ConfirmModal title="Ainda há exercícios pendentes" onClose={() => setFinishStep(null)}><p>{missingCount} {missingCount === 1 ? "exercício ficou desmarcado" : "exercícios ficaram desmarcados"}. Deseja finalizar mesmo assim?</p><div className="modal-actions"><button onClick={() => setFinishStep(null)}>Continuar treino</button><button className="danger-action" onClick={() => setFinishStep("comment")}>Finalizar mesmo assim</button></div></ConfirmModal>}
    {finishStep === "comment" && <ConfirmModal title="Como foi o treino?" onClose={() => setFinishStep(null)}><label className="workout-comment">Comentário opcional<textarea value={comment} onChange={e=>setComment(e.target.value)} maxLength={1000} placeholder="Ex.: aparelho ocupado, senti desconforto..."/></label><button className="primary" onClick={() => finish(true, comment)}>OK, finalizar treino</button></ConfirmModal>}
  </section>;
}

function TodayExercise({ exercise, index, active, selectedId, onChoose }: any) {
  const [showReserves, setShowReserves] = useState(false); const selected = selectedId === exercise.id;
  return <article className="today-card"><span className="exercise-number">{String(index+1).padStart(2,"0")}</span><ExerciseVideo id={exercise.id} eager className="video-placeholder"/><div className="grow">
    <span className={`tag ${exercise.phase === "aquecimento" ? "warm" : exercise.phase === "alongamento" ? "stretch" : "main"}`}>{exercise.phase === "principal" ? "Treino principal" : exercise.phase}</span>
    <h3>{exercise.name}</h3><p>{exercise.sets} séries · {exercise.reps} reps · {exercise.restSeconds}s</p>
    {!!exercise.reserves?.length && <details className="reserves" onToggle={e=>setShowReserves((e.target as HTMLDetailsElement).open)}><summary>Alternativas sem depender do aparelho</summary>{showReserves && exercise.reserves.map((reserve:any)=><div key={reserve.id} className={`reserve-row ${reserve.familiar ? "familiar" : ""}`}><ExerciseVideo id={reserve.id} eager={false} className="reserve-video"/><div><strong>{reserve.name}</strong>{reserve.familiar && <span className="familiar-note">Você já sabe fazer este</span>}<EquipmentIcon equipment={reserve.equipment} name={reserve.name}/></div>{active && <button className={`check ${selectedId === reserve.id ? "selected" : ""}`} aria-label={`Concluir ${reserve.name}`} onClick={()=>onChoose(exercise.id,reserve.id)}>{selectedId === reserve.id && <Check size={16}/>}</button>}</div>)}</details>}
  </div>{active && <button className={`check ${selected ? "selected" : ""}`} aria-label="Concluir exercício" onClick={()=>onChoose(exercise.id,exercise.id)}>{selected && <Check size={18}/>}</button>}</article>;
}
function ConfirmModal({ title, onClose, children }: any) { return <div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button><div className="modal-body"><h2>{title}</h2>{children}</div></div></div>; }
