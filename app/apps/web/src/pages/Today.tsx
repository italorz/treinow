import { ExerciseMedia } from "../narration";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Play, RotateCw, Square, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Disclosure } from "../disclosure";
import { ExerciseAlternative } from "../exercise-alternative";
import { ExerciseVideo } from "../video";
import { WorkoutPreparation } from "../preparation";
import { ExerciseGuidance } from "../exercise-guidance";

const phaseOrder: Record<string, number> = { aquecimento: 0, alongamento: 1, principal: 2 };

export function TodayPage() {
  const qc = useQueryClient();
  const dayQuery = useQuery({ queryKey: ["today"], queryFn: () => api<any>("/workouts/today") });
  const sessionQuery = useQuery({ queryKey: ["workout-session-today"], queryFn: () => api<any>("/workouts/sessions/today") });
  const [finishStep, setFinishStep] = useState<null | "missing" | "comment">(null);
  const [missingCount, setMissingCount] = useState(0); const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const session = sessionQuery.data?.session;
  const start = useMutation({ mutationFn: () => api<any>("/workouts/sessions/start", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["workout-session-today"] }) });
  async function choose(slotExerciseId: string, selectedExerciseId: string) {
    if (!session || session.status !== "active" || saving) return;
    setActionError(""); setSaving(true);
    try {
      const selected = session.selections?.[slotExerciseId] === selectedExerciseId ? null : selectedExerciseId;
      await api(`/workouts/sessions/${session.id}/selection`, { method: "PATCH", body: JSON.stringify({ slotExerciseId, selectedExerciseId: selected }) });
      await qc.invalidateQueries({ queryKey: ["workout-session-today"] });
    } catch (error) { setActionError((error as Error).message); }
    finally { setSaving(false); }
  }
  async function finish(confirmIncomplete = false, finalComment = "") {
    if (saving) return;
    setActionError(""); setSaving(true);
    try {
      const result = await api<any>(`/workouts/sessions/${session.id}/finish`, { method: "POST", body: JSON.stringify({ confirmIncomplete, comment: finalComment }) });
      if (result.requiresConfirmation) { setMissingCount(result.missingCount); setFinishStep("missing"); return; }
      setFinishStep(null); await qc.invalidateQueries({ queryKey: ["workout-session-today"] });
    } catch (error) { setFinishStep(null); setActionError((error as Error).message); }
    finally { setSaving(false); }
  }
  const day = dayQuery.data?.day; const active = session?.status === "active";
  const completed = day?.exercises.filter((exercise: any) => !!session?.selections?.[exercise.id]).length ?? 0;
  return <section className="page">
    <div className="page-title"><div><span className="eyebrow">SEU PLANO</span><h1>Seu treino de hoje</h1></div><time className="today-date" dateTime={new Date().toLocaleDateString("en-CA")}>{new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}</time></div>
    {dayQuery.isError && <div className="empty" role="alert"><h2>Não foi possível carregar seu treino</h2><button className="primary" onClick={() => void dayQuery.refetch()}><RotateCw size={16}/> Tentar novamente</button></div>}
    {(actionError || start.error || sessionQuery.isError) && <p className="error" role="alert">{actionError || start.error?.message || "Não foi possível carregar o progresso. Atualize antes de iniciar o treino."}</p>}
    {dayQuery.isLoading && <div className="skeleton tall"/>}
    {!day && !dayQuery.isLoading && !dayQuery.isError && <div className="empty"><h2>Dia de recuperação</h2><p>Confira sua programação ou ajuste seu plano.</p><Link className="text-link" to="/calendario">Ver calendário</Link></div>}
    {day && <><div className="workout-hero"><span>{active ? "TREINO EM ANDAMENTO" : session?.status === "finished" ? "TREINO FINALIZADO" : "TREINO DE HOJE"}</span><h2>{day.title}</h2><p>{day.exercises.length} exercícios{day.focusMuscles?.length ? ` · ${day.focusMuscles.join(" · ")}` : ""}</p>
      {session && <div className="workout-progress"><div><span>{completed} de {day.exercises.length} concluídos</span>{session.status === "finished" && <CheckCircle2 size={18}/>}</div><progress aria-label="Progresso do treino" value={completed} max={day.exercises.length || 1}/></div>}
    </div>
      <WorkoutPreparation notes={day.preparationNotes}/>
      {!session && <button className="primary session-action" onClick={() => start.mutate()} disabled={start.isPending || !sessionQuery.isSuccess}><Play size={17} fill="currentColor"/> {start.isPending ? "Preparando treino…" : "Iniciar treino"}</button>}
      <div className="exercise-list">{[...day.exercises].sort((a:any,b:any)=>(phaseOrder[a.phase]??99)-(phaseOrder[b.phase]??99)).map((exercise:any,index:number)=><TodayExercise key={exercise.id} exercise={exercise} index={index} active={active} saving={saving} selectedId={session?.selections?.[exercise.id]} onChoose={choose}/>)}</div>
      {active && <button className="primary session-action finish" disabled={saving} onClick={() => void finish()}><Square size={16} fill="currentColor"/> {saving ? "Salvando…" : "Finalizar treino"}</button>}
    </>}
    {finishStep === "missing" && <ConfirmModal title="Ainda há exercícios pendentes" onClose={() => setFinishStep(null)}><p>{missingCount} {missingCount === 1 ? "exercício ficou desmarcado" : "exercícios ficaram desmarcados"}. Deseja finalizar mesmo assim?</p><div className="modal-actions"><button onClick={() => setFinishStep(null)}>Continuar treino</button><button className="danger-action" onClick={() => setFinishStep("comment")}>Finalizar mesmo assim</button></div></ConfirmModal>}
    {finishStep === "comment" && <ConfirmModal title="Como foi o treino?" onClose={() => setFinishStep(null)}><label className="workout-comment">Comentário opcional<textarea value={comment} onChange={e=>setComment(e.target.value)} maxLength={1000} placeholder="Ex.: aparelho ocupado, senti desconforto..."/></label><button className="primary" onClick={() => finish(true, comment)}>OK, finalizar treino</button></ConfirmModal>}
  </section>;
}

function TodayExercise({ exercise, index, active, saving, selectedId, onChoose }: any) {
  const selected = selectedId === exercise.id;
  return <ExerciseMedia><article className={`today-card ${selectedId ? "is-complete" : ""}`}>
    <div className="exercise-heading">
      <ExerciseVideo id={exercise.id} eager className="video-placeholder"/>
      <div className="exercise-heading-copy">
        <span className={`tag ${exercise.phase === "aquecimento" ? "warm" : exercise.phase === "alongamento" ? "stretch" : "main"}`}>{exercise.phase === "principal" ? "Treino principal" : exercise.phase}</span>
        <h3>{String(index + 1).padStart(2, "0")} · {exercise.name}</h3>
      </div>
      {active && <button type="button" disabled={saving} className={`check ${selected ? "selected" : ""}`} aria-pressed={selected} aria-label={`Concluir ${exercise.name}`} onClick={()=>onChoose(exercise.id,exercise.id)}>{selected && <Check size={18}/>}</button>}
    </div>
    <p className="exercise-prescription"><span>{exercise.sets} séries</span><span>{exercise.reps} reps</span><span>{exercise.restSeconds}s descanso</span></p>
    <ExerciseGuidance id={exercise.id} guidance={exercise.guidance} executionGuide={exercise.executionGuide}/>
    {!!exercise.reserves?.length && <Disclosure title="Alternativas" count={exercise.reserves.length}>
      {exercise.reserves.map((reserve:any)=><ExerciseAlternative key={reserve.id} exercise={reserve} active={active} selected={selectedId === reserve.id} disabled={saving} onChoose={()=>onChoose(exercise.id,reserve.id)}/>)}
    </Disclosure>}
  </article></ExerciseMedia>;
}
function ConfirmModal({ title, onClose, children }: any) { return <div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button><div className="modal-body"><h2>{title}</h2>{children}</div></div></div>; }
