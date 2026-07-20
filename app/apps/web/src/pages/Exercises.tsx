import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ExerciseVideo } from "../video";
import { domainLabel } from "../i18n";

// Coordenadas em % de cada metade quadrada (887x887) do sprite ecorche.png,
// medidas pixel a pixel. O contêiner .anatomy tem aspect-ratio 1/1 igual ao da
// metade, então estes percentuais mapeiam 1:1 em qualquer resolução.
const spots: Record<string, { muscle: string; label: string; x: number; y: number; w: number; h: number }[]> = {
  front: [
    { muscle: "peitoral", label: "Peitoral", x: 48.5, y: 18.5, w: 21, h: 10 },
    { muscle: "ombro", label: "Ombros", x: 45, y: 16.5, w: 7.5, h: 8.5 }, { muscle: "ombro", label: "Ombros", x: 65.5, y: 16.5, w: 7.5, h: 8.5 },
    { muscle: "biceps", label: "Bíceps", x: 43.5, y: 24.5, w: 7, h: 12 }, { muscle: "biceps", label: "Bíceps", x: 67, y: 24.5, w: 7, h: 12 },
    { muscle: "core", label: "Core", x: 51.5, y: 29, w: 15, h: 19 },
    { muscle: "pernas", label: "Pernas", x: 48.5, y: 49, w: 20.5, h: 19 },
    { muscle: "panturrilha", label: "Panturrilhas", x: 48.5, y: 69, w: 20, h: 19 }
  ],
  back: [
    { muscle: "trapezio", label: "Trapézio", x: 33, y: 15.5, w: 14, h: 9 },
    { muscle: "costas", label: "Costas", x: 31.5, y: 24, w: 17.5, h: 19 },
    { muscle: "triceps", label: "Tríceps", x: 25, y: 24, w: 6.5, h: 12 }, { muscle: "triceps", label: "Tríceps", x: 48.5, y: 24, w: 6.5, h: 12 },
    { muscle: "gluteos", label: "Glúteos", x: 31, y: 42.5, w: 18, h: 11 },
    { muscle: "pernas", label: "Pernas", x: 30.5, y: 54, w: 19, h: 14 },
    { muscle: "panturrilha", label: "Panturrilhas", x: 31, y: 69, w: 18.5, h: 19 }
  ]
};
function uniqueMuscles(view: "front" | "back") {
  const seen = new Set<string>();
  return spots[view].filter(s => (seen.has(s.muscle) ? false : (seen.add(s.muscle), true)));
}

export function ExercisesPage() {
  const [view, setView] = useState<"front" | "back">("front"); const [muscle, setMuscle] = useState(""); const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const counts = useQuery({ queryKey: ["muscle-summary"], queryFn: () => api<any>("/exercises/muscle-summary"), staleTime: 5 * 60_000 });
  const query = useInfiniteQuery({
    queryKey: ["exercises", muscle, search],
    queryFn: ({ pageParam }) => api<any>(`/exercises?${new URLSearchParams({ ...(muscle ? { muscle } : {}), ...(search ? { search } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`),
    initialPageParam: "", getNextPageParam: last => last.nextCursor ?? undefined
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { const io = new IntersectionObserver(e => e[0]?.isIntersecting && query.hasNextPage && query.fetchNextPage(), { rootMargin: "300px" }); if (sentinel.current) io.observe(sentinel.current); return () => io.disconnect(); }, [query.hasNextPage, query.fetchNextPage]);
  const items = query.data?.pages.flatMap(p => p.items) ?? [];
  const toggleMuscle = (m: string) => setMuscle(muscle === m ? "" : m);
  return <section className="page">
    <div className="page-title"><div><span className="eyebrow">BIBLIOTECA</span><h1>Exercícios</h1></div></div>
    <div className="anatomy-card">
      <div className="segmented compact"><button className={view === "front" ? "selected" : ""} onClick={() => setView("front")}>Frente</button><button className={view === "back" ? "selected" : ""} onClick={() => setView("back")}>Costas</button></div>
      <div className="anatomy">
        <div className={`anatomy-layer front ${view === "front" ? "visible" : ""}`}><img src="/assets/ecorche.png" alt="Écorché de frente" loading="eager"/></div>
        <div className={`anatomy-layer back ${view === "back" ? "visible" : ""}`}><img src="/assets/ecorche.png" alt="Écorché de costas" loading="eager"/></div>
        <div className="anatomy-hotspots">
          {spots[view].map(s => <button key={`${s.muscle}${s.x}`} type="button" aria-label={`${s.label}${counts.data?.counts?.[s.muscle] ? ` · ${counts.data.counts[s.muscle]} exercícios` : ""}`}
            className={muscle === s.muscle ? "hotspot active" : "hotspot"} style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%` }} onClick={() => toggleMuscle(s.muscle)}>
            <span className="hotspot-label">{s.label}{counts.data?.counts?.[s.muscle] != null && <em> · {counts.data.counts[s.muscle]}</em>}</span>
          </button>)}
        </div>
      </div>
      <div className="muscle-chips">{uniqueMuscles(view).map(s => <button key={s.muscle} type="button" className={muscle === s.muscle ? "selected" : ""} onClick={() => toggleMuscle(s.muscle)}>
        {s.label}{counts.data?.counts?.[s.muscle] != null && <span className="chip-count">{counts.data.counts[s.muscle]}</span>}
      </button>)}</div>
      <p>Toque em um grupo muscular para filtrar</p>
    </div>
    <label className="search"><Search size={19}/><input type="search" placeholder="Nome, halter, barra, cabo..." value={search} onChange={e => setSearch(e.target.value)}/></label>
    {(muscle || search) && <div className="filter-note">{muscle || `Resultados para “${search}”`}<button onClick={() => {setMuscle(""); setSearch("");}}>Limpar</button></div>}
    <div className="library-grid">{items.map((e: any) => <ExerciseCard key={e.id} exercise={e} onOpen={() => setSelected(e)}/>)}</div>
    {query.isLoading && <div className="skeleton tall"/>}<div ref={sentinel}/>{!query.hasNextPage && items.length > 0 && <p className="end">Você viu todos os exercícios.</p>}
    {selected && <ExerciseModal exercise={selected} onClose={() => setSelected(null)}/>}
  </section>;
}
function ExerciseCard({ exercise, onOpen }: any) {
  return <button type="button" className="library-card" onClick={onOpen}>
    <ExerciseVideo id={exercise.id} className="card-poster" zoomable={false}/>
    <div><span className="tag">{domainLabel(exercise.musclePrimary)}</span><h3>{exercise.name}</h3><p>{domainLabel(exercise.equipment)} · {domainLabel(exercise.complexity)}</p></div>
  </button>;
}
function ExerciseModal({ exercise, onClose }: any) {
  const detail = useQuery({ queryKey: ["exercise", exercise.id], queryFn: () => api<any>(`/exercises/${exercise.id}`) });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const d = detail.data; const ex = d?.exercise;
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button>
      <ExerciseVideo id={exercise.id} eager controls className="modal-video"/>
      <div className="modal-body">
        <span className="tag">{domainLabel(exercise.musclePrimary)}</span>
        <h2>{exercise.name}</h2>
        <p className="muted cap">{domainLabel(exercise.equipment)} · {domainLabel(exercise.complexity)}</p>
        {detail.isLoading && <div className="skeleton" style={{ height: 80 }}/>}
        {ex && <dl className="meta-grid">
          {ex.movementPattern && <div><dt>Padrão de movimento</dt><dd>{domainLabel(ex.movementPattern)}</dd></div>}
          {ex.secondaryMuscles?.length > 0 && <div><dt>Músculos auxiliares</dt><dd>{ex.secondaryMuscles.map(domainLabel).join(", ")}</dd></div>}
          {ex.joints?.length > 0 && <div><dt>Articulações</dt><dd>{ex.joints.map(domainLabel).join(", ")}</dd></div>}
          <div><dt>Execução</dt><dd>{ex.isUnilateral ? "Unilateral — um lado por vez" : "Bilateral"}{ex.requiresHighMindMuscleAwareness ? " · foco na conexão mente-músculo" : ""}</dd></div>
        </dl>}
        {d?.warmups?.length > 0 && <RecoSection title="Aquecimento recomendado" items={d.warmups}/>}
        {d?.stretches?.length > 0 && <RecoSection title="Alongamentos recomendados" items={d.stretches}/>}
      </div>
    </div>
  </div>;
}
function RecoSection({ title, items }: { title: string; items: any[] }) {
  return <section className="reco">
    <h4>{title}</h4>
    {items.map(item => <div key={item.id} className="reco-row">
      <ExerciseVideo id={item.id} className="reco-video"/>
      <div><strong>{item.name}</strong><span className="cap">{domainLabel(item.equipment)}</span></div>
    </div>)}
  </section>;
}
