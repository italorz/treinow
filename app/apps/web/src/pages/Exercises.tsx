import { useInfiniteQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const spots: Record<string, { muscle: string; label: string; x: number; y: number; w: number; h: number }[]> = {
  front: [
    { muscle: "peitoral", label: "Peitoral", x: 39, y: 19, w: 22, h: 10 }, { muscle: "ombro", label: "Ombros", x: 29, y: 18, w: 11, h: 9 },
    { muscle: "biceps", label: "Bíceps", x: 25, y: 27, w: 10, h: 12 }, { muscle: "core", label: "Core", x: 42, y: 28, w: 17, h: 18 },
    { muscle: "pernas", label: "Pernas", x: 37, y: 49, w: 26, h: 22 }, { muscle: "panturrilha", label: "Panturrilhas", x: 38, y: 72, w: 24, h: 16 }
  ],
  back: [
    { muscle: "trapezio", label: "Trapézio", x: 39, y: 14, w: 22, h: 12 }, { muscle: "costas", label: "Costas", x: 34, y: 23, w: 32, h: 20 },
    { muscle: "triceps", label: "Tríceps", x: 24, y: 28, w: 10, h: 14 }, { muscle: "gluteos", label: "Glúteos", x: 38, y: 45, w: 24, h: 14 },
    { muscle: "pernas", label: "Pernas", x: 37, y: 56, w: 26, h: 18 }, { muscle: "panturrilha", label: "Panturrilhas", x: 38, y: 74, w: 24, h: 14 }
  ]
};
export function ExercisesPage() {
  const [view, setView] = useState<"front" | "back">("front"); const [muscle, setMuscle] = useState(""); const [search, setSearch] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["exercises", muscle, search],
    queryFn: ({ pageParam }) => api<any>(`/exercises?${new URLSearchParams({ ...(muscle ? { muscle } : {}), ...(search ? { search } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`),
    initialPageParam: "", getNextPageParam: last => last.nextCursor ?? undefined
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { const io = new IntersectionObserver(e => e[0]?.isIntersecting && query.hasNextPage && query.fetchNextPage(), { rootMargin: "300px" }); if (sentinel.current) io.observe(sentinel.current); return () => io.disconnect(); }, [query.hasNextPage, query.fetchNextPage]);
  const items = query.data?.pages.flatMap(p => p.items) ?? [];
  return <section className="page">
    <div className="page-title"><div><span className="eyebrow">BIBLIOTECA</span><h1>Exercícios</h1></div></div>
    <div className="anatomy-card">
      <div className="segmented compact"><button className={view === "front" ? "selected" : ""} onClick={() => setView("front")}>Frente</button><button className={view === "back" ? "selected" : ""} onClick={() => setView("back")}>Costas</button></div>
      <div className={`anatomy ${view}`}><img src="/assets/ecorche.png" alt={`Écorché de ${view === "front" ? "frente" : "costas"}`}/>{spots[view].map(s => <button key={`${s.muscle}${s.x}`} aria-label={s.label} className={muscle === s.muscle ? "hotspot active" : "hotspot"} style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%` }} onClick={() => setMuscle(muscle === s.muscle ? "" : s.muscle)}/>)}</div>
      <p>Toque em um grupo muscular para filtrar</p>
    </div>
    <label className="search"><Search size={19}/><input type="search" placeholder="Nome, halter, barra, cabo..." value={search} onChange={e => setSearch(e.target.value)}/></label>
    {(muscle || search) && <div className="filter-note">{muscle || `Resultados para “${search}”`}<button onClick={() => {setMuscle(""); setSearch("");}}>Limpar</button></div>}
    <div className="library-grid">{items.map((e: any) => <ExerciseCard key={e.id} exercise={e}/>)}</div>
    {query.isLoading && <div className="skeleton tall"/>}<div ref={sentinel}/>{!query.hasNextPage && items.length > 0 && <p className="end">Você viu todos os exercícios.</p>}
  </section>;
}
function ExerciseCard({ exercise }: any) {
  const ref = useRef<HTMLVideoElement>(null); const [url, setUrl] = useState("");
  useEffect(() => { const io = new IntersectionObserver(async e => { if (e[0]?.isIntersecting) { if (!url) { const d = await api<any>(`/exercises/${exercise.id}/video-url`); setUrl(d.url); } ref.current?.play().catch(() => {}); } else ref.current?.pause(); }, { rootMargin: "150px" }); if (ref.current) io.observe(ref.current); return () => io.disconnect(); }, [exercise.id, url]);
  return <article className="library-card"><video ref={ref} src={url} muted loop playsInline preload="none"/><div><span className="tag">{exercise.musclePrimary}</span><h3>{exercise.name}</h3><p>{exercise.equipment} · {exercise.complexity}</p></div></article>;
}
