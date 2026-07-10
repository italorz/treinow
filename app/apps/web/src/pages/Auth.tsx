import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

export function AuthPage({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [role, setRole] = useState<"student" | "trainer">("student");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api<any>(register ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(register ? { ...values, role } : values) });
      navigate(result.user.role === "trainer" ? "/personal" : "/hoje");
    } catch (err) { setError((err as Error).message); }
  }
  return <div className="auth-page">
    <section className="auth-copy"><span className="eyebrow">MOVIMENTO É PROGRESSO</span><h1>Treine com intenção.<br/><em>Evolua de verdade.</em></h1><p>Seu plano inteligente, sua rotina e seu progresso no mesmo lugar.</p></section>
    <form className="auth-card" onSubmit={submit}>
      <div className="brand"><span className="brand-mark">T</span><span>treinow</span></div>
      <h2>{register ? "Crie sua conta" : "Bem-vindo de volta"}</h2>
      {register && <><div className="segmented"><button type="button" className={role === "student" ? "selected" : ""} onClick={() => setRole("student")}>Sou aluno</button><button type="button" className={role === "trainer" ? "selected" : ""} onClick={() => setRole("trainer")}>Sou personal</button></div><label>Nome<input name="name" autoComplete="name" required minLength={2}/></label></>}
      <label>E-mail<input name="email" type="email" autoComplete="email" required/></label>
      <label>Senha<input name="password" type="password" minLength={register ? 12 : 1} autoComplete={register ? "new-password" : "current-password"} required/></label>
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit">{register ? "Criar conta" : "Entrar"}</button>
      <p className="switch">{register ? "Já tem conta?" : "Ainda não tem conta?"} <Link to={register ? "/login" : "/cadastro"}>{register ? "Entrar" : "Cadastre-se"}</Link></p>
    </form>
  </div>;
}
