import { z } from "zod";

export const phaseSchema = z.enum(["aquecimento", "principal", "alongamento"]);
export const planItemSchema = z.object({
  exerciseId: z.string(),
  phase: phaseSchema,
  sets: z.number().int().min(1).max(8),
  reps: z.string().min(1).max(20),
  restSeconds: z.number().int().min(15).max(300),
  reserveExerciseIds: z.array(z.string()).max(3)
});
export const planSchema = z.object({
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    title: z.string().min(2).max(80),
    focusMuscles: z.array(z.string()).max(4),
    exercises: z.array(planItemSchema).max(14)
  })).length(7)
});

export type WorkoutPlan = z.infer<typeof planSchema>;
export type CatalogExercise = {
  _id: unknown;
  name: string;
  musclePrimary: string;
  equipment: string;
  targetKey: string;
  isWarmup: boolean;
  isStretch: boolean;
  joints?: string[];
};

const fixedEquipment = new Set(["maquina", "cabo", "smith"]);
const freeEquipment = new Set(["halter", "anilha", "barra", "peso_corporal", "elastico"]);

export function validatePlan(
  plan: WorkoutPlan,
  catalog: CatalogExercise[],
  trainingDays: number[],
  availableEquipment: string[]
) {
  const byId = new Map(catalog.map(exercise => [String(exercise._id), exercise]));
  const activeDays = new Set(trainingDays);
  const allowedMainEquipment = new Set([...availableEquipment, "peso_corporal"]);
  const globallyUsed = new Set<string>();
  const globallyUsedNames = new Set<string>();

  if (new Set(plan.days.map(day => day.weekday)).size !== 7) throw new Error("Plano deve conter os sete dias sem duplicação");

  for (const day of plan.days) {
    if (!activeDays.has(day.weekday)) {
      if (day.exercises.length) throw new Error("Dias de descanso não podem conter treino principal");
      continue;
    }
    const warmups = day.exercises.filter(item => item.phase === "aquecimento");
    const mains = day.exercises.filter(item => item.phase === "principal");
    const stretches = day.exercises.filter(item => item.phase === "alongamento");
    if (!warmups.length || mains.length < 4 || !stretches.length) {
      throw new Error("Cada treino precisa de aquecimento, 4 exercícios principais e alongamento");
    }

    for (const item of day.exercises) {
      const exercise = byId.get(item.exerciseId);
      if (!exercise) throw new Error("Plano contém exercício inexistente");
      if (globallyUsed.has(item.exerciseId)) throw new Error("Exercício repetido durante a semana");
      const exerciseName = normalizedName(exercise.name);
      if (globallyUsedNames.has(exerciseName)) throw new Error("Exercício com nome repetido durante a semana");
      globallyUsed.add(item.exerciseId);
      globallyUsedNames.add(exerciseName);
      if (item.phase === "aquecimento" && !exercise.isWarmup) throw new Error("Item de aquecimento não é adequado para aquecer");
      if (item.phase === "alongamento" && !exercise.isStretch) throw new Error("Item final não é um alongamento");
      if (item.phase !== "principal" && item.reserveExerciseIds.length) throw new Error("Aquecimentos e alongamentos não usam reservas");
      if (item.phase === "principal" && !allowedMainEquipment.has(exercise.equipment)) throw new Error("Exercício principal usa equipamento indisponível");
      if (item.phase === "principal" && !item.reserveExerciseIds.length) throw new Error("Exercício principal sem alternativa reserva");

      const reserves = item.reserveExerciseIds.map(id => {
        const reserve = byId.get(id);
        if (!reserve) throw new Error("Reserva inexistente");
        if (reserve.isWarmup || reserve.isStretch) throw new Error("Aquecimento ou alongamento não pode ser exercício reserva");
        if (reserve.targetKey !== exercise.targetKey) throw new Error(`Reserva sem correlação anatômica exata: ${exercise.targetKey} != ${reserve.targetKey}`);
        if (reserve.equipment === exercise.equipment) throw new Error("Reserva deve oferecer equipamento diferente");
        if (globallyUsed.has(id)) throw new Error("Reserva repetida durante a semana");
        const reserveName = normalizedName(reserve.name);
        if (globallyUsedNames.has(reserveName)) throw new Error("Reserva com nome repetido durante a semana");
        globallyUsed.add(id);
        globallyUsedNames.add(reserveName);
        return reserve;
      });
      if (item.phase === "principal" && fixedEquipment.has(exercise.equipment) && !reserves.some(reserve => freeEquipment.has(reserve.equipment))) {
        throw new Error("Exercício de máquina/cabo sem alternativa com peso livre");
      }
    }

    const shoulderDay = mains.some(item => byId.get(item.exerciseId)?.targetKey.startsWith("ombro_"));
    if (shoulderDay && !warmups.some(item => byId.get(item.exerciseId)?.targetKey.startsWith("manguito_rotador_"))) {
      throw new Error("Treino de ombro sem aquecimento de manguito rotador");
    }
  }
  return plan;
}

function normalizedName(name: string) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}
