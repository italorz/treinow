import { z } from "zod";

export const roleSchema = z.enum(["student", "trainer"]);
export const goalSchema = z.enum([
  "mais_disposto",
  "mais_bonito",
  "mais_forte",
  "mais_leve",
  "mais_saudavel",
  "menos_estressado"
]);
export const levelSchema = z.enum(["iniciante", "intermediario", "avancado"]);
export const equipmentSchema = z.enum(["peso_corporal", "halter", "anilha", "barra", "cabo", "maquina", "smith", "kettlebell", "elastico", "banco", "bola", "outro"]);
export const muscleSchema = z.enum(["core", "peitoral", "costas", "ombro", "biceps", "triceps", "antebraco", "trapezio", "gluteos", "pernas", "panturrilha"]);

export const injurySchema = z.object({
  region: z.enum(["ombro", "cotovelo", "punho", "coluna_cervical", "coluna_lombar", "quadril", "joelho", "tornozelo"]),
  severity: z.enum(["leve", "moderada", "grave"]),
  status: z.enum(["recuperacao", "cronica", "dor_aguda"]),
  medicallyCleared: z.boolean()
});

export const metaSchema = z.object({
  goal: goalSchema,
  level: levelSchema,
  trainingDays: z.array(z.number().int().min(0).max(6)).min(1),
  durationMinutes: z.enum(["30", "45", "60", "75", "90"]).transform(Number),
  location: z.enum(["casa", "academia", "ambos"]),
  equipment: z.array(equipmentSchema).min(1),
  weightKg: z.number().min(30).max(300),
  heightCm: z.number().int().min(120).max(230),
  age: z.number().int().min(14).max(100),
  sex: z.enum(["feminino", "masculino", "nao_informar"]),
  priorityMuscles: z.array(muscleSchema).max(3),
  intensity: z.enum(["leve", "moderada", "intensa"]),
  injuries: z.array(injurySchema).max(8)
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  role: roleSchema
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128)
});

export type MetaInput = z.infer<typeof metaSchema>;
export type Role = z.infer<typeof roleSchema>;
