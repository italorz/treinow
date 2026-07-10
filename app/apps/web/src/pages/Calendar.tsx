import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function CalendarPage() {
  const { data } = useQuery({ queryKey: ["calendar"], queryFn: () => api<any>("/workouts/calendar") });
  const today = new Date().getDay();
  return <section className="page"><div className="page-title"><div><span className="eyebrow">SUA SEMANA</span><h1>Calendário</h1></div></div>
    <div className="week-strip">{labels.map((l, i) => <div className={i === today ? "day active" : "day"} key={l}><span>{l}</span><strong>{i + 7}</strong><i/></div>)}</div>
    <div className="schedule">{(data?.plan?.days ?? []).map((d: any) => <article key={d.weekday}><div className="day-index">{labels[d.weekday]}</div><div><span>{d.exercises.length ? "TREINO" : "RECUPERAÇÃO"}</span><h3>{d.title}</h3><p>{d.focusMuscles?.join(" · ") || "Descanso programado"}</p></div><strong>{d.exercises.length ? `${d.exercises.length} ex.` : "—"}</strong></article>)}</div>
    {!data?.plan && <div className="empty"><h2>Nenhum plano ativo</h2><p>Preencha sua meta para montar a semana.</p></div>}
  </section>;
}
