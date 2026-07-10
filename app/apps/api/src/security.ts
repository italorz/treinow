import { createHmac, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { db, redis } from "./infra.js";

export type SessionUser = { id: string; role: "student" | "trainer"; tenantId?: string };
const sessionTtl = 60 * 60 * 24 * 14;
const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

export async function createSession(reply: FastifyReply, user: SessionUser) {
  const id = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  await redis.set(`session:${id}`, JSON.stringify(user), "EX", sessionTtl);
  const secure = config.NODE_ENV === "production";
  reply.setCookie("tw_session", `${id}.${sign(id, config.SESSION_SECRET)}`, {
    httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: sessionTtl
  });
  reply.setCookie("tw_csrf", `${csrf}.${sign(csrf, config.CSRF_SECRET)}`, {
    httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: sessionTtl
  });
  return csrf;
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.cookies.tw_session;
  if (raw) await redis.del(`session:${raw.split(".")[0]}`);
  reply.clearCookie("tw_session", { path: "/" }).clearCookie("tw_csrf", { path: "/" });
}

export async function requireUser(request: FastifyRequest): Promise<SessionUser> {
  const raw = request.cookies.tw_session;
  if (!raw) throw Object.assign(new Error("Não autenticado"), { statusCode: 401 });
  const [id, signature] = raw.split(".");
  if (!id || !signature || sign(id, config.SESSION_SECRET) !== signature) throw Object.assign(new Error("Sessão inválida"), { statusCode: 401 });
  const stored = await redis.get(`session:${id}`);
  if (!stored) throw Object.assign(new Error("Sessão expirada"), { statusCode: 401 });
  return JSON.parse(stored);
}

export function verifyCsrf(request: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const raw = request.cookies.tw_csrf;
  const header = request.headers["x-csrf-token"];
  const [token, signature] = raw?.split(".") ?? [];
  if (!token || !signature || header !== token || sign(token, config.CSRF_SECRET) !== signature) {
    throw Object.assign(new Error("Token CSRF inválido"), { statusCode: 403 });
  }
}

export async function assertStudentAccess(user: SessionUser, studentId: string) {
  if (user.role === "student") {
    if (user.id !== studentId) throw Object.assign(new Error("Acesso negado"), { statusCode: 403 });
    return;
  }
  const membership = await db.collection("memberships").findOne({
    tenantId: new ObjectId(user.tenantId), studentId: new ObjectId(studentId), status: "active"
  });
  if (!membership) throw Object.assign(new Error("Vínculo inexistente"), { statusCode: 403 });
  const consent = await db.collection("consents").findOne({ membershipId: membership._id, revokedAt: null });
  if (!consent) throw Object.assign(new Error("Consentimento revogado"), { statusCode: 403 });
}

export const publicUser = (user: Record<string, unknown>) => ({
  id: String(user._id), name: user.name, email: user.email, role: user.role, tenantId: user.tenantId ? String(user.tenantId) : undefined
});
