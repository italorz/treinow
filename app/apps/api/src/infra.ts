import { MongoClient, type Db } from "mongodb";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";

export const mongo = new MongoClient(config.MONGODB_URI);
export let db: Db;
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: config.NODE_ENV === "test" });
const redisUrl = new URL(config.REDIS_URL);
export const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: Number(redisUrl.pathname.slice(1) || 0),
  maxRetriesPerRequest: null
};
export const s3 = new S3Client({
  endpoint: config.MINIO_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: config.MINIO_ACCESS_KEY, secretAccessKey: config.MINIO_SECRET_KEY }
});
export const queues = {
  catalog: new Queue("catalog", { connection: bullConnection }),
  workout: new Queue("workout", { connection: bullConnection }),
  analytics: new Queue("analytics", { connection: bullConnection }),
  invitations: new Queue("invitations", { connection: bullConnection }),
  maintenance: new Queue("maintenance", { connection: bullConnection })
};

export async function connectInfra() {
  await ensureBucket();
  await mongo.connect();
  db = mongo.db();
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("exercises").createIndex({ slug: 1 }, { unique: true }),
    db.collection("exercises").createIndex({ musclePrimary: 1, equipment: 1, slug: 1 }),
    db.collection("exercises").createIndex({ searchTokens: 1, slug: 1 }),
    db.collection("memberships").createIndex({ tenantId: 1, studentId: 1 }, { unique: true }),
    db.collection("consents").createIndex({ membershipId: 1, revokedAt: 1 }),
    db.collection("workoutPlans").createIndex({ studentId: 1, active: 1 }),
    db.collection("workoutLogs").createIndex({ studentId: 1, completedAt: -1 }),
    db.collection("measurements").createIndex({ studentId: 1, measuredAt: -1 }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("invitations").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

async function ensureBucket() {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: config.MINIO_BUCKET }));
  } catch (error: any) {
    const code = error?.name ?? error?.Code;
    if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw error;
  }
}
