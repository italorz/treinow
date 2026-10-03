import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { clearVideoCache } from "../video";
const days = ["D", "S", "T", "Q", "Q", "S", "S"];
const equipment = [["peso_corporal","Peso corporal"],["halter","Halteres"],["anilha","Anilhas"],["barra","Barra"],["cabo","Cabo"],["maquina","Máquinas"],["elastico","Elástico"]];
const muscles = [["peitoral","Peitoral"],["costas","Costas"],["ombro","Ombros"],["biceps","Bíceps"],["triceps","Tríceps"],["core","Core"],["gluteos","Glúteos"],["pernas","Pernas"]];
const injuryRegions = [["ombro", "Ombro"], ["cotovelo", "Cotovelo"], ["punho", "Punho"], ["coluna_cervical", "Coluna cervical"], ["coluna_lombar", "Coluna lombar"], ["quadril", "Quadril"], ["joelho", "Joelho"], ["tornozelo", "Tornozelo"]];
export function MetaPage() {
  const existing = useQuery({ queryKey: ["meta"], queryFn: () => api<any>("/meta") });
  const memberships = useQuery({ queryKey: ["memberships"], queryFn: () => api<any>("/memberships") });
  const [form, setForm] = useState<any>({ goal:"mais_disposto", level:"iniciante", trainingDays:[1,3,5], durationMinutes:"45", location:"academia", equipment:["peso_corporal","halter"], weightKg:70, heightCm:170, age:30, sex:"nao_informar", priorityMuscles:[], intensity:"moderada", injuries:[] });
  useEffect(() => {
    const meta = existing.data?.meta;
    if (meta) setForm((f: any) => ({ ...f, ...Object.fromEntries(Object.entries(meta).filter(([k]) => k in f)), durationMinutes: String(meta.durationMinutes ?? f.durationMinutes) }));
  }, [existing.data]);
  const bmi = useMemo(() => (form.weightKg / ((form.heightCm/100) ** 2)).toFixed(1), [form.weightKg, form.heightCm]);
  const qc = useQueryClient(); const navigate = useNavigate();
  const [genError, setGenError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      setGenError("");
      const { jobId, generationBlocked } = await api<any>("/meta", { method:"PUT", body:JSON.stringify(form) });
      clearVideoCache();
      await Promise.all(["meta", "today", "calendar", "calendar-day", "exercises", "exercise", "muscle-summary"].map(key => qc.invalidateQueries({ queryKey: [key] })));
      if (generationBlocked) { setGenError(`Meta salva. ${generationBlocked}`); return; }
      // Acompanha o job de geração: só libera o botão com plano pronto ou erro claro.
      for (let i = 0; i < 40; i++) {
        const job = await api<any>(`/jobs/workout/${jobId}`);
        if (job.state === "completed") {
          await Promise.all(["today", "calendar", "calendar-day"].map(key => qc.invalidateQueries({ queryKey: [key] })));
          navigate("/hoje");
          return;
        }
        if (job.state === "failed") { setGenError(job.failedReason || "Não foi possível gerar o treino. Revise sua meta."); return; }
        await new Promise(r => setTimeout(r, 1500));
      }
      setGenError("A geração está demorando mais que o normal. Confira o calendário em instantes.");
    }
  });
  const toggle = (key:string, value:any, max=99) => setForm((f:any) => ({...f,[key]:f[key].includes(value)?f[key].filter((v:any)=>v!==value):f[key].length<max?[...f[key],value]:f[key]}));
  const updateInjury = (region: string, changes: Record<string, unknown>) => setForm((f: any) => ({ ...f, injuries: f.injuries.map((injury: any) => injury.region === region ? { ...injury, ...changes } : injury) }));
  return <section className="page meta-page"><div className="page-title"><div><span className="eyebrow">PERSONALIZAÇÃO</span><h1>Sua meta</h1></div><div className="bmi"><span>IMC</span><strong>{bmi}</strong></div></div>
    <div className="form-section"><h2>Como você quer se sentir amanhã?</h2><select value={form.goal} onChange={e=>setForm({...form,goal:e.target.value})}><option value="mais_disposto">Mais disposto</option><option value="mais_bonito">Mais bonito</option><option value="mais_forte">Mais forte</option><option value="mais_leve">Mais leve</option><option value="mais_saudavel">Mais saudável</option><option value="menos_estressado">Menos estressado</option></select></div>
    <div className="form-grid"><label>Nível<select value={form.level} onChange={e=>setForm({...form,level:e.target.value})}><option value="iniciante">Iniciante</option><option value="intermediario">Intermediário</option><option value="avancado">Avançado</option></select></label><label>Duração<select value={form.durationMinutes} onChange={e=>setForm({...form,durationMinutes:e.target.value})}>{["30","45","60","75","90"].map(v=><option key={v} value={v}>{v} min</option>)}</select></label></div>
    <div className="form-section"><h2>Dias de treino</h2><div className="day-picker">{days.map((d,i)=><button key={i} className={form.trainingDays.includes(i)?"selected":""} onClick={()=>toggle("trainingDays",i)}>{d}</button>)}</div></div>
    <div className="form-grid three"><label>Peso<select value={form.weightKg} onChange={e=>setForm({...form,weightKg:Number(e.target.value)})}>{Array.from({length:221},(_,i)=>i+30).map(v=><option key={v}>{v}</option>)}</select></label><label>Altura<select value={form.heightCm} onChange={e=>setForm({...form,heightCm:Number(e.target.value)})}>{Array.from({length:111},(_,i)=>i+120).map(v=><option key={v}>{v}</option>)}</select></label><label>Idade<select value={form.age} onChange={e=>setForm({...form,age:Number(e.target.value)})}>{Array.from({length:87},(_,i)=>i+14).map(v=><option key={v}>{v}</option>)}</select></label></div>
    <div className="form-section"><label htmlFor="profile-sex">Sexo<select id="profile-sex" value={form.sex} onChange={e => setForm({ ...form, sex: e.target.value })}><option value="nao_informar">Prefiro não informar</option><option value="masculino">Homem</option><option value="feminino">Mulher</option></select></label></div>
    <div className="form-section"><h2>Equipamentos disponíveis</h2><div className="choice-grid">{equipment.map(([v,l])=><button key={v} className={form.equipment.includes(v)?"selected":""} onClick={()=>toggle("equipment",v)}>{l}</button>)}</div></div>
    <div className="form-section"><h2>Músculos prioritários <small>até 3</small></h2><div className="choice-grid">{muscles.map(([v,l])=><button key={v} className={form.priorityMuscles.includes(v)?"selected":""} onClick={()=>toggle("priorityMuscles",v,3)}>{l}</button>)}</div></div>
    <div className="form-grid"><label>Local<select value={form.location} onChange={e=>setForm({...form,location:e.target.value})}><option value="academia">Academia</option><option value="casa">Casa</option><option value="ambos">Ambos</option></select></label><label>Intensidade<select value={form.intensity} onChange={e=>setForm({...form,intensity:e.target.value})}><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="intensa">Intensa</option></select></label></div>
    <div className="form-section"><h2>Lesões ou limitações?</h2><div className="choice-grid">{injuryRegions.map(([region, label])=><button type="button" key={region} aria-pressed={form.injuries.some((x:any)=>x.region===region)} className={form.injuries.some((x:any)=>x.region===region)?"selected danger":""} onClick={()=>setForm((f:any)=>({...f,injuries:f.injuries.some((x:any)=>x.region===region)?f.injuries.filter((x:any)=>x.region!==region):[...f.injuries,{region,severity:"leve",status:"recuperacao",medicallyCleared:false}]}))}>{label}</button>)}</div>
      {form.injuries.map((injury: any) => <fieldset className="injury-details" key={injury.region}><legend>{injuryRegions.find(([region]) => region === injury.region)?.[1]}</legend><div className="injury-fields">
        <label>Gravidade<select value={injury.severity} onChange={e => updateInjury(injury.region, { severity: e.target.value })}><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="grave">Grave</option></select></label>
        <label>Estado<select value={injury.status} onChange={e => updateInjury(injury.region, { status: e.target.value })}><option value="recuperacao">Em recuperação</option><option value="cronica">Crônica</option><option value="dor_aguda">Dor aguda</option></select></label>
      </div><label className="injury-clearance"><input type="checkbox" checked={injury.medicallyCleared} onChange={e => updateInjury(injury.region, { medicallyCleared: e.target.checked })}/>Tenho liberação profissional para treinar e realizar mobilidade nesta região</label></fieldset>)}
      {!!form.injuries.length && <p className="hint">Dor aguda e ausência de liberação suspendem a geração do treino. A meta pode ser salva.</p>}
    </div>
    {!!memberships.data?.memberships?.length&&<div className="form-section"><h2>Personais com acesso completo</h2>{memberships.data.memberships.map((m:any)=><div className="consent-row" key={m.id}><span>{m.tenantName}</span><button onClick={async()=>{await api(`/memberships/${m.id}/revoke`,{method:"POST"});memberships.refetch()}}>Revogar acesso</button></div>)}</div>}
    {(save.error||genError)&&<p className="error">{genError||save.error?.message}</p>}<button className="primary sticky-action" disabled={save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Montando seu plano...":"Salvar e gerar meu treino"}</button>
  </section>;
}
