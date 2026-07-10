import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), ".env");
if (existsSync(path)) {
  console.log(".env já existe; nenhuma alteração feita.");
  process.exit(0);
}
const secret = () => randomBytes(32).toString("base64url");
const redisPassword = secret();
const values = {
  NODE_ENV: "development",
  PUBLIC_URL: "http://localhost:8080",
  MONGODB_URI: "mongodb://mongo:27017/treinow?replicaSet=rs0",
  REDIS_PASSWORD: redisPassword,
  REDIS_URL: `redis://:${redisPassword}@redis:6379`,
  SESSION_SECRET: secret(),
  CSRF_SECRET: secret(),
  MINIO_ENDPOINT: "http://minio:9000",
  MINIO_ACCESS_KEY: `treinow_${randomBytes(8).toString("hex")}`,
  MINIO_SECRET_KEY: secret(),
  MINIO_BUCKET: "treinow-videos",
  GEMINI_API_KEY: "",
  GEMINI_PLAN_MODEL: "gemini-3.1-pro-preview",
  GEMINI_FALLBACK_MODEL: "gemini-3.5-flash",
  SMTP_URL: ""
};
writeFileSync(path, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
console.log(".env local criado com segredos aleatórios.");
