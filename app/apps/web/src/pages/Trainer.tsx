import { useQuery } from "@tanstack/react-query";
import { Activity, TrendingUp, Users } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
export function TrainerPage() {
  const students = useQuery({ queryKey:["students"],queryFn:()=>api<any>("/trainer/students") }); const [selected,setSelected]=useState("");
  const [inviteEmail,setInviteEmail]=useState(""); const [inviteStatus,setInviteStatus]=useState("");
  const progress=useQuery({queryKey:["progress",selected],queryFn:()=>api<any>(`/trainer/students/${selected}/progress`),enabled:!!selected});
  const chart=progress.data?.snapshot?.weightTrend??[];
  return <section className="page"><div className="page-title"><div><span className="eyebrow">PAINEL DO PERSONAL</span><h1>Seus alunos</h1></div><span className="metric"><Users size={18}/>{students.data?.students?.length??0}</span></div>
    <form className="invite-row" onSubmit={async e=>{e.preventDefault();try{await api("/trainer/invitations",{method:"POST",body:JSON.stringify({email:inviteEmail})});setInviteStatus("Convite enviado");setInviteEmail("");}catch(err){setInviteStatus((err as Error).message)}}}><input type="email" required placeholder="E-mail do novo aluno" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/><button className="primary">Convidar</button></form>{inviteStatus&&<p className="hint">{inviteStatus}</p>}
    <div className="student-strip">{students.data?.students?.map((s:any)=><button className={selected===s.id?"selected":""} onClick={()=>setSelected(s.id)} key={s.id}><span>{s.name[0]}</span><strong>{s.name}</strong></button>)}</div>
    {!selected&&<div className="empty"><Activity size={34}/><h2>Escolha um aluno</h2><p>Veja aderência, volume e evolução corporal.</p></div>}
    {selected&&<><div className="kpis"><article><span>Aderência</span><strong>{progress.data?.snapshot?.adherencePercent??0}%</strong></article><article><span>Volume</span><strong>{progress.data?.snapshot?.totalVolumeKg??0} kg</strong></article><article><span>Recordes</span><strong>{progress.data?.snapshot?.personalRecords??0}</strong></article></div>
      <article className="chart-card"><div><TrendingUp size={19}/><h2>Evolução de peso</h2></div><ResponsiveContainer width="100%" height={240}><AreaChart data={chart}><defs><linearGradient id="weight" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#76e6a2" stopOpacity={.5}/><stop offset="95%" stopColor="#76e6a2" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date"/><YAxis domain={["dataMin - 2","dataMax + 2"]}/><Tooltip/><Area type="monotone" dataKey="weightKg" stroke="#15935a" fill="url(#weight)"/></AreaChart></ResponsiveContainer></article></>}
  </section>;
}
