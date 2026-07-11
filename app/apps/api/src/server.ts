import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import argon2 from "argon2";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { loginSchema, metaSchema, registerSchema } from "@treinow/contracts";
import { config } from "./config.js";
import { connectInfra, db, queues, redis, s3 } from "./infra.js";
import { assertStudentAccess, createSession, destroySession, publicUser, requireUser, verifyCsrf } from "./security.js";

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie", "body.password", "body.injuries", "body.email"]
  },
  bodyLimit: 256 * 1024
});
await app.register(cookie);
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute", redis });
await app.register(swagger, { openapi: { info: { title: "Treinow API", version: "1.0.0" } } });
await app.register(swaggerUi, { routePrefix: "/docs" });

app.setErrorHandler((error, _request, reply) => {
  const status = (error as any).statusCode && (error as any).statusCode < 500 ? (error as any).statusCode : 500;
  if (status >= 500) app.log.error(error);
  reply.code(status).send({ error: status >= 500 ? "Falha interna" : (error as Error).message });
});
app.addHook("preHandler", async request => {
  if (request.url.startsWith("/v1/") && !request.url.startsWith("/v1/auth/")) verifyCsrf(request);
});

app.get("/health", async () => ({ ok: true }));
app.get("/v1/auth/me", async request => {
  const session = await requireUser(request);
  const user = await db.collection("users").findOne({ _id: new ObjectId(session.id) });
  return { user: user ? publicUser(user) : null };
});
app.post("/v1/auth/register", { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } }, async (request, reply) => {
  const input = registerSchema.parse(request.body);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 3 });
  const session = mongoSession();
  let created: any;
  try {
    await session.withTransaction(async () => {
      const user = { name: input.name, email: input.email, passwordHash, role: input.role, emailVerifiedAt: null, createdAt: new Date() } as any;
      const result = await db.collection("users").insertOne(user, { session });
      user._id = result.insertedId;
      if (input.role === "trainer") {
        const tenant = await db.collection("tenants").insertOne({ name: `Equipe de ${input.name}`, ownerId: result.insertedId, createdAt: new Date() }, { session });
        await db.collection("users").updateOne({ _id: result.insertedId }, { $set: { tenantId: tenant.insertedId } }, { session });
        user.tenantId = tenant.insertedId;
      }
      created = user;
    });
  } catch (error: any) {
    if (error?.code === 11000) throw Object.assign(new Error("E-mail já cadastrado"), { statusCode: 409 });
    throw error;
  } finally { await session.endSession(); }
  const csrf = await createSession(reply, { id: String(created._id), role: created.role, tenantId: created.tenantId ? String(created.tenantId) : undefined });
  reply.code(201).send({ user: publicUser(created), csrf });
});
app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const input = loginSchema.parse(request.body);
  const user: any = await db.collection("users").findOne({ email: input.email });
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) throw Object.assign(new Error("Credenciais inválidas"), { statusCode: 401 });
  const csrf = await createSession(reply, { id: String(user._id), role: user.role, tenantId: user.tenantId ? String(user.tenantId) : undefined });
  return { user: publicUser(user), csrf };
});
app.post("/v1/auth/logout", async (request, reply) => { verifyCsrf(request); await destroySession(request, reply); return { ok: true }; });

app.get("/v1/meta", async request => {
  const user = await requireUser(request);
  if (user.role !== "student") throw Object.assign(new Error("Disponível para alunos"), { statusCode: 403 });
  return { meta: await db.collection("profiles").findOne({ studentId: new ObjectId(user.id) }) };
});
app.put("/v1/meta", async request => {
  const user = await requireUser(request);
  const studentId = user.role === "student" ? user.id : String((request.body as any)?.studentId ?? "");
  await assertStudentAccess(user, studentId);
  const raw = user.role === "student" ? request.body : (request.body as any).meta;
  const input = metaSchema.parse(raw);
  const bmi = Math.round((input.weightKg / ((input.heightCm / 100) ** 2)) * 10) / 10;
  await db.collection("profiles").updateOne({ studentId: new ObjectId(studentId) }, { $set: { ...input, bmi, updatedAt: new Date() } }, { upsert: true });
  const job = await queues.workout.add("generate", { studentId }, jobOptions(`workout:${studentId}:${Date.now()}`));
  return { bmi, jobId: job.id };
});

app.get("/v1/exercises", async request => {
  await requireUser(request);
  const q = request.query as any;
  const filter: any = {};
  if (q.muscle) filter.musclePrimary = q.muscle;
  if (q.equipment) filter.equipment = q.equipment;
  if (q.search) filter.searchTokens = normalize(q.search);
  if (q.cursor && ObjectId.isValid(q.cursor)) filter._id = { $gt: new ObjectId(q.cursor) };
  const limit = Math.min(Math.max(Number.parseInt(q.limit) || 9, 1), 24);
  const items = await db.collection("exercises").find(filter).sort({ _id: 1 }).limit(limit).project({
    slug: 1, name: 1, musclePrimary: 1, equipment: 1, complexity: 1, requiresHighMindMuscleAwareness: 1, video: 1
  }).toArray();
  return { items: items.map(e => ({ ...e, id: String(e._id), _id: undefined })), nextCursor: items.length === limit ? String(items.at(-1)!._id) : null };
});
app.get("/v1/exercises/:id", async request => {
  await requireUser(request);
  const { id } = request.params as any;
  if (!ObjectId.isValid(id)) throw Object.assign(new Error("Exercício inválido"), { statusCode: 400 });
  const exercise: any = await db.collection("exercises").findOne({ _id: new ObjectId(id) }, { projection: {
    slug: 1, name: 1, musclePrimary: 1, secondaryMuscles: 1, equipment: 1, complexity: 1,
    movementPattern: 1, targetKey: 1, isUnilateral: 1, isWarmup: 1, isStretch: 1, joints: 1, requiresHighMindMuscleAwareness: 1
  } });
  if (!exercise) throw Object.assign(new Error("Exercício não encontrado"), { statusCode: 404 });
  const related = (extra: Record<string, unknown>) => db.collection("exercises")
    .find({ musclePrimary: exercise.musclePrimary, _id: { $ne: exercise._id }, needsReview: { $ne: true }, ...extra })
    .project({ name: 1, equipment: 1, targetKey: 1 }).limit(8).toArray();
  const [warmupDocs, stretchDocs] = await Promise.all([related({ isWarmup: true }), related({ isStretch: true })]);
  if (exercise.musclePrimary === "ombro") {
    const cuffFirst = (a: any, b: any) => Number(String(b.targetKey).startsWith("manguito_rotador_")) - Number(String(a.targetKey).startsWith("manguito_rotador_"));
    warmupDocs.sort(cuffFirst);
  }
  const shape = (e: any) => ({ id: String(e._id), name: e.name, equipment: e.equipment });
  return {
    exercise: { ...exercise, id: String(exercise._id), _id: undefined },
    warmups: warmupDocs.slice(0, 3).map(shape),
    stretches: stretchDocs.slice(0, 3).map(shape)
  };
});
app.get("/v1/exercises/:id/video-url", async request => {
  await requireUser(request);
  const { id } = request.params as any;
  if (!ObjectId.isValid(id)) throw Object.assign(new Error("Exercício inválido"), { statusCode: 400 });
  const exercise: any = await db.collection("exercises").findOne({ _id: new ObjectId(id) });
  if (!exercise) throw Object.assign(new Error("Exercício não encontrado"), { statusCode: 404 });
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = mediaSignature(id, expires);
  return { url: `${config.PUBLIC_URL}/v1/media/${id}?expires=${expires}&signature=${signature}` };
});
app.get("/v1/media/:id", async (request, reply) => {
  const { id } = request.params as any;
  const { expires, signature } = request.query as any;
  const expected = mediaSignature(id, Number(expires));
  if (!signature || Number(expires) < Date.now() / 1000 || !safeEqual(signature, expected)) {
    throw Object.assign(new Error("URL de mídia inválida ou expirada"), { statusCode: 403 });
  }
  const exercise: any = ObjectId.isValid(id) ? await db.collection("exercises").findOne({ _id: new ObjectId(id) }) : null;
  if (!exercise) throw Object.assign(new Error("Mídia não encontrada"), { statusCode: 404 });
  const range = request.headers.range;
  const object = await s3.send(new GetObjectCommand({ Bucket: config.MINIO_BUCKET, Key: exercise.video.objectKey, Range: range }));
  reply.header("content-type", object.ContentType ?? "video/mp4");
  reply.header("cache-control", "private, max-age=86400");
  reply.header("accept-ranges", "bytes");
  if (object.ContentLength != null) reply.header("content-length", String(object.ContentLength));
  if (range && object.ContentRange) reply.code(206).header("content-range", object.ContentRange);
  return reply.send(object.Body as any);
});

app.get("/v1/workouts/calendar", async request => {
  const user = await requireUser(request);
  const studentId = user.role === "student" ? user.id : String((request.query as any).studentId ?? "");
  await assertStudentAccess(user, studentId);
  return { plan: await db.collection("workoutPlans").findOne({ studentId: new ObjectId(studentId), active: true }, { sort: { version: -1 } }) };
});
app.get("/v1/workouts/today", async request => {
  const user = await requireUser(request);
  const studentId = user.role === "student" ? user.id : String((request.query as any).studentId ?? "");
  await assertStudentAccess(user, studentId);
  const plan: any = await db.collection("workoutPlans").findOne({ studentId: new ObjectId(studentId), active: true });
  const weekday = new Date().getDay();
  const day = plan?.days?.find((d: any) => d.weekday === weekday) ?? null;
  if (!day) return { day: null };
  const rawIds: string[] = day.exercises.flatMap((item: any) => [item.exerciseId, ...(item.reserveExerciseIds ?? [])]).map(String);
  const ids = [...new Set(rawIds)]
    .filter(id => ObjectId.isValid(id))
    .map(id => new ObjectId(id));
  const exercises = await db.collection("exercises").find({ _id: { $in: ids } }).project({ name: 1, equipment: 1, musclePrimary: 1, targetKey: 1 }).toArray();
  const byId = new Map(exercises.map(e => [String(e._id), e]));
  return { day: { ...day, exercises: day.exercises.map((item: any) => ({
    ...item,
    ...byId.get(item.exerciseId),
    id: item.exerciseId,
    warmup: item.phase === "aquecimento" || item.warmup === true,
    reserves: (item.reserveExerciseIds ?? []).map((id: string) => ({ id, ...byId.get(id), _id: undefined })),
    _id: undefined
  })) } };
});
app.post("/v1/workouts/logs", async request => {
  const user = await requireUser(request);
  const body = request.body as any;
  const studentId = user.role === "student" ? user.id : String(body.studentId ?? "");
  await assertStudentAccess(user, studentId);
  const doc = {
    studentId: new ObjectId(studentId), exerciseId: new ObjectId(body.exerciseId),
    sets: Math.min(20, Math.max(1, Number(body.sets))), reps: Math.min(100, Math.max(1, Number(body.reps))),
    loadKg: Math.min(1000, Math.max(0, Number(body.loadKg ?? 0))), completedAt: new Date()
  };
  await db.collection("workoutLogs").insertOne(doc);
  await queues.analytics.add("refresh", { studentId }, jobOptions(`analytics:${studentId}:${Date.now()}`));
  return { ok: true };
});
app.post("/v1/measurements", async request => {
  const user = await requireUser(request);
  if (user.role !== "student") throw Object.assign(new Error("Somente o aluno registra medidas"), { statusCode: 403 });
  const b = request.body as any;
  const height = Number(b.heightCm);
  const weight = Number(b.weightKg);
  await db.collection("measurements").insertOne({
    studentId: new ObjectId(user.id), measuredAt: new Date(), weightKg: weight, heightCm: height,
    bmi: Math.round(weight / ((height / 100) ** 2) * 10) / 10,
    waistCm: b.waistCm == null ? null : Number(b.waistCm)
  });
  await queues.analytics.add("refresh", { studentId: user.id }, jobOptions(`analytics:${user.id}:${Date.now()}`));
  return { ok: true };
});

app.post("/v1/trainer/invitations", async request => {
  const user = await requireUser(request);
  if (user.role !== "trainer" || !user.tenantId) throw Object.assign(new Error("Somente personal"), { statusCode: 403 });
  const email = String((request.body as any).email ?? "").trim().toLowerCase();
  if (!email.includes("@")) throw Object.assign(new Error("E-mail inválido"), { statusCode: 400 });
  const token = randomBytes(32).toString("base64url");
  await db.collection("invitations").insertOne({
    tenantId: new ObjectId(user.tenantId), email, tokenHash: hash(token), status: "pending",
    expiresAt: new Date(Date.now() + 7 * 86400000), createdBy: new ObjectId(user.id), createdAt: new Date()
  });
  await queues.invitations.add("send", { email, token }, jobOptions(`invite:${hash(token)}`));
  return { ok: true, ...(config.NODE_ENV === "development" ? { inviteUrl: `${config.PUBLIC_URL}/convite/${token}` } : {}) };
});
app.post("/v1/invitations/:token/accept", async request => {
  const user = await requireUser(request);
  if (user.role !== "student") throw Object.assign(new Error("Convite destinado a aluno"), { statusCode: 403 });
  const tokenHash = hash((request.params as any).token);
  const invitation: any = await db.collection("invitations").findOne({ tokenHash, status: "pending", expiresAt: { $gt: new Date() } });
  if (!invitation) throw Object.assign(new Error("Convite inválido ou expirado"), { statusCode: 404 });
  const session = mongoSession();
  await session.withTransaction(async () => {
    const membership = await db.collection("memberships").findOneAndUpdate(
      { tenantId: invitation.tenantId, studentId: new ObjectId(user.id) },
      { $set: { status: "active", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: "after", session }
    );
    await db.collection("consents").insertOne({
      membershipId: membership!._id, version: "1.0", scopes: ["progress", "meta", "workouts"],
      acceptedAt: new Date(), revokedAt: null, documentHash: hash("consent-v1-full-access")
    }, { session });
    await db.collection("invitations").updateOne({ _id: invitation._id }, { $set: { status: "accepted", acceptedAt: new Date() } }, { session });
  });
  await session.endSession();
  return { ok: true };
});
app.post("/v1/memberships/:id/revoke", async request => {
  const user = await requireUser(request);
  if (user.role !== "student") throw Object.assign(new Error("Somente o aluno revoga"), { statusCode: 403 });
  const id = new ObjectId((request.params as any).id);
  const membership = await db.collection("memberships").findOne({ _id: id, studentId: new ObjectId(user.id) });
  if (!membership) throw Object.assign(new Error("Vínculo não encontrado"), { statusCode: 404 });
  await db.collection("consents").updateMany({ membershipId: id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await db.collection("memberships").updateOne({ _id: id }, { $set: { status: "revoked" } });
  return { ok: true };
});
app.get("/v1/memberships", async request => {
  const user = await requireUser(request);
  if (user.role !== "student") throw Object.assign(new Error("Somente o aluno"), { statusCode: 403 });
  const memberships = await db.collection("memberships").find({ studentId: new ObjectId(user.id), status: "active" }).toArray();
  const tenants = await db.collection("tenants").find({ _id: { $in: memberships.map(m => m.tenantId) } }).project({ name: 1 }).toArray();
  const names = new Map(tenants.map(t => [String(t._id), t.name]));
  return { memberships: memberships.map(m => ({ id: String(m._id), tenantName: names.get(String(m.tenantId)) ?? "Personal" })) };
});
app.get("/v1/trainer/students", async request => {
  const user = await requireUser(request);
  if (user.role !== "trainer" || !user.tenantId) throw Object.assign(new Error("Somente personal"), { statusCode: 403 });
  const memberships = await db.collection("memberships").find({ tenantId: new ObjectId(user.tenantId), status: "active" }).toArray();
  const students = await db.collection("users").find({ _id: { $in: memberships.map(m => m.studentId) } }).project({ name: 1, email: 1 }).toArray();
  return { students: students.map(s => ({ id: String(s._id), name: s.name, email: s.email })) };
});
app.get("/v1/trainer/students/:id/progress", async request => {
  const user = await requireUser(request);
  const studentId = (request.params as any).id;
  await assertStudentAccess(user, studentId);
  return { snapshot: await db.collection("analyticsSnapshots").findOne({ studentId: new ObjectId(studentId) }, { sort: { generatedAt: -1 } }) };
});
app.get("/v1/jobs/:queue/:id", async request => {
  await requireUser(request);
  const { queue, id } = request.params as any;
  const q = (queues as any)[queue];
  if (!q) throw Object.assign(new Error("Fila inválida"), { statusCode: 404 });
  const job = await q.getJob(id);
  return job ? { id, state: await job.getState(), result: job.returnvalue, failedReason: job.failedReason } : { id, state: "not_found" };
});

function normalize(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function mediaSignature(id: string, expires: number) { return createHmac("sha256", config.SESSION_SECRET).update(`${id}:${expires}`).digest("base64url"); }
function safeEqual(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function jobOptions(jobId: string) { return { jobId, attempts: 3, backoff: { type: "exponential" as const, delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 }; }
function mongoSession() { return (db.client as any).startSession(); }

await connectInfra();
await app.listen({ port: config.PORT, host: "0.0.0.0" });
