import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Queue, Worker } from "bullmq";
import { config } from "./config.js";
import { bullConnection, connectInfra, db, s3 } from "./infra.js";
import { aggregateProgress } from "./analytics.js";
import { generatePlan } from "./workout.js";

await connectInfra();
const connection = bullConnection;

new Worker("catalog", async job => {
  if (job.name !== "import") return;
  const catalog = JSON.parse(await readFile("/app/catalog/exercises.pt-BR.json", "utf8"));
  let imported = 0;
  for (const item of catalog) {
    const localPath = `/app/videos/${item.video.fileName}`;
    if (!existsSync(localPath)) continue;
    try { await s3.send(new HeadObjectCommand({ Bucket: config.MINIO_BUCKET, Key: item.video.objectKey })); }
    catch { await s3.send(new PutObjectCommand({ Bucket: config.MINIO_BUCKET, Key: item.video.objectKey, Body: createReadStream(localPath), ContentType: "video/mp4" })); }
    await db.collection("exercises").updateOne({ slug: item.slug }, { $set: { ...item, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    imported++;
    if (imported % 50 === 0) await job.updateProgress(imported / catalog.length * 100);
  }
  return { imported };
}, { connection, concurrency: 1 });

new Worker("workout", async job => {
  const { studentId } = job.data;
  const generated = await generatePlan(studentId);
  const current = await db.collection("workoutPlans").findOne({ studentId: new ObjectId(studentId), active: true }, { sort: { version: -1 } });
  await db.collection("workoutPlans").updateMany({ studentId: new ObjectId(studentId), active: true }, { $set: { active: false } });
  await db.collection("workoutPlans").insertOne({
    studentId: new ObjectId(studentId), version: (current?.version ?? 0) + 1, active: true,
    source: generated.source, ...generated.plan, createdAt: new Date()
  });
  return {
    version: (current?.version ?? 0) + 1,
    source: generated.source,
    providerFallback: Boolean(generated.providerFailures?.length)
  };
}, { connection, concurrency: 4 });

new Worker("analytics", async job => {
  const studentId = new ObjectId(job.data.studentId);
  const [logs, measurements, profile] = await Promise.all([
    db.collection("workoutLogs").find({ studentId }).project({ _id: 0, exerciseId: 1, completedAt: 1, sets: 1, reps: 1, loadKg: 1 }).toArray(),
    db.collection("measurements").find({ studentId }).project({ _id: 0, measuredAt: 1, weightKg: 1, bmi: 1 }).toArray(),
    db.collection("profiles").findOne({ studentId }, { projection: { trainingDays: 1 } })
  ]);
  const snapshot = aggregateProgress(logs, measurements, Array.isArray(profile?.trainingDays) ? profile.trainingDays.length : 3);
  await db.collection("analyticsSnapshots").updateOne({ studentId }, { $set: { ...snapshot, generatedAt: new Date() } }, { upsert: true });
  return { ok: true };
}, { connection, concurrency: 2 });

new Worker("invitations", async job => {
  // O adaptador SMTP entra aqui; tokens nunca são registrados em log.
  return { queued: true, recipientHash: String(job.data.email).split("@")[1] };
}, { connection, concurrency: 2 });

console.log("Treinow workers ativos");
if (existsSync("/app/catalog/exercises.pt-BR.json")) {
  const catalogQueue = new Queue("catalog", { connection });
  const catalogContent = await readFile("/app/catalog/exercises.pt-BR.json");
  const catalogVersion = createHash("sha256").update(catalogContent).digest("hex").slice(0, 16);
  await catalogQueue.add("import", {}, { jobId: `catalog-${catalogVersion}`, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
}
