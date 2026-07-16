import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ExerciseVideo } from "../video";
import { EquipmentIcon } from "../equipment";

const phaseOrder: Record<string, number> = { alongamento: 0, aquecimento: 1, principal: 2 };

const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function CalendarPage() {
  const { data } = useQuery({ queryKey: ["calendar"], queryFn: () => api<any>("/workouts/calendar") });
  const [selected, setSelected] = useState<{ weekday: number; title: string } | null>(null);
  const today = new Date().getDay();
  const dateOf = (weekday: number) => { const d = new Date(); d.setDate(d.getDate() - today + weekday); return d.getDate(); };
  return <section className="page"><div className="page-title"><div><span className="eyebrow">SUA SEMANA</span><h1>Calendário</h1></div></div>
    <div className="week-strip">{labels.map((l, i) => <div className={i === today ? "day active" : "day"} key={l}><span>{l}</span><strong>{dateOf(i)}</strong><i/></div>)}</div>
    <div className="schedule">{(data?.plan?.days ?? []).map((d: any) => {
      const hasWorkout = d.exercises.length > 0;
      return <article key={d.weekday} className={hasWorkout ? "clickable" : ""} role={hasWorkout ? "button" : undefined} tabIndex={hasWorkout ? 0 : undefined}
        onClick={hasWorkout ? () => setSelected({ weekday: d.weekday, title: d.title }) : undefined}
        onKeyDown={hasWorkout ? e => (e.key === "Enter" || e.key === " ") && setSelected({ weekday: d.weekday, title: d.title }) : undefined}>
        <div className="day-index">{labels[d.weekday]}</div>
        <div><span>{hasWorkout ? "TREINO" : "RECUPERAÇÃO"}</span><h3>{d.title}</h3><p>{d.focusMuscles?.join(" · ") || "Descanso programado"}</p></div>
        <strong>{hasWorkout ? `${d.exercises.length} ex.` : "—"}</strong>
      </article>;
    })}</div>
    {!data?.plan && <div className="empty"><h2>Nenhum plano ativo</h2><p>Preencha sua meta para montar a semana.</p></div>}
    {selected && <DayModal weekday={selected.weekday} onClose={() => setSelected(null)}/>}
  </section>;
}

function DayModal({ weekday, onClose }: { weekday: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["calendar-day", weekday], queryFn: () => api<any>(`/workouts/day/${weekday}`) });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const day = query.data?.day;
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button>
      <div className="modal-body">
        <span className="eyebrow">{labels[weekday]?.toUpperCase()}</span>
        <h2>{day?.title ?? "Treino"}</h2>
        {day?.focusMuscles?.length > 0 && <p className="muted cap">{day.focusMuscles.join(" · ")}</p>}
        {query.isLoading && <div className="skeleton" style={{ height: 120 }}/>}
        {day?.exercises && [...day.exercises].sort((a: any,b: any) => (phaseOrder[a.phase] ?? 99)-(phaseOrder[b.phase] ?? 99)).map((e: any, i: number) => <div key={e.id} className="cal-row">
          <span className="exercise-number">{String(i + 1).padStart(2, "0")}</span>
          <ExerciseVideo id={e.id} className="reco-video"/>
          <div className="grow">
            {e.phase === "aquecimento" && <span className="tag warm">Aquecimento</span>}
            {e.phase === "alongamento" && <span className="tag stretch">Alongamento</span>}
            {e.phase === "principal" && <span className="tag main">Principal</span>}
            <strong className="cal-name">{e.name}</strong>
            <span className="cal-meta">{e.sets} séries · {e.reps} reps · {e.restSeconds}s descanso</span>
            {!!e.reserves?.length && <details className="reserves">
              <summary>Alternativas sem depender do aparelho</summary>
              {e.reserves.map((r: any) => <div key={r.id} className="reserve-row">
                <ExerciseVideo id={r.id} eager={false} className="reserve-video"/>
                <div><strong>{r.name}</strong><EquipmentIcon equipment={r.equipment} name={r.name}/></div>
              </div>)}
            </details>}
          </div>
        </div>)}
        {day && !day.exercises?.length && <p className="muted">Dia de recuperação.</p>}
      </div>
    </div>
  </div>;
}
