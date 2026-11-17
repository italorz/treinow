import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Dumbbell, Goal, House, Users } from "lucide-react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { api } from "./api";

export function AppShell() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<any>("/auth/me"), retry: false });
  if (me.isError) return <Navigate to="/login" replace />;
  if (me.isLoading) return <div className="splash"><span className="brand-mark">T</span></div>;
  const trainer = me.data?.user?.role === "trainer";
  const links = trainer
    ? [["/personal", Users, "Alunos"], ["/exercicios", Dumbbell, "Exercícios"]]
    : [["/hoje", House, "Hoje"], ["/exercicios", Dumbbell, "Exercícios"], ["/calendario", CalendarDays, "Calendário"], ["/meta", Goal, "Meta"]];
  return <div className={`app-shell ${trainer ? "trainer-shell" : "student-shell"}`}>
    <a className="skip-link" href="#conteudo">Ir para o conteúdo</a>
    <header><div className="brand"><span className="brand-mark">T</span><span>treinow</span></div><div className="account-summary"><span className="account-name">{me.data.user.name}</span><span className="avatar" title={me.data.user.name}>{me.data.user.name?.[0]?.toUpperCase()}</span></div></header>
    <main id="conteudo" tabIndex={-1}><Outlet /></main>
    <nav className="bottom-nav" aria-label="Navegação principal">{links.map(([to, Icon, label]: any) =>
      <NavLink to={to} key={to} className={({ isActive }) => isActive ? "active" : ""}><Icon size={21}/><span>{label}</span></NavLink>
    )}</nav>
  </div>;
}
