import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Dumbbell, Goal, House, Users } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "./api";

export function AppShell() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<any>("/auth/me"), retry: false });
  if (me.isError) { navigate("/login"); return null; }
  if (me.isLoading) return <div className="splash"><span className="brand-mark">T</span></div>;
  const trainer = me.data?.user?.role === "trainer";
  const links = trainer
    ? [["/personal", Users, "Alunos"], ["/exercicios", Dumbbell, "Exercícios"]]
    : [["/hoje", House, "Hoje"], ["/exercicios", Dumbbell, "Exercícios"], ["/calendario", CalendarDays, "Calendário"], ["/meta", Goal, "Meta"]];
  return <div className={`app-shell ${trainer ? "trainer-shell" : "student-shell"}`}>
    <header><div className="brand"><span className="brand-mark">T</span><span>treinow</span></div><span className="avatar">{me.data.user.name?.[0]}</span></header>
    <main><Outlet /></main>
    <nav className="bottom-nav">{links.map(([to, Icon, label]: any) =>
      <NavLink to={to} key={to} className={({ isActive }) => isActive ? "active" : ""}><Icon size={21}/><span>{label}</span></NavLink>
    )}</nav>
  </div>;
}
