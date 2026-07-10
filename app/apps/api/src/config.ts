import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  MONGODB_URI: z.string().default("mongodb://localhost:27017/treinow"),
  REDIS_URL: z.string().default("redis://:change-me@localhost:6379"),
  SESSION_SECRET: z.string().min(32).default("development-only-session-secret-change"),
  CSRF_SECRET: z.string().min(32).default("development-only-csrf-secret-change-now"),
  MINIO_ENDPOINT: z.string().url().default("http://localhost:9000"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin-change"),
  MINIO_BUCKET: z.string().default("treinow-videos"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_PLAN_MODEL: z.string().default("gemini-3.1-pro-preview"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash")
});

export const config = schema.parse(process.env);
