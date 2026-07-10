import { describe, expect, it } from "vitest";
import { validatePlan, type CatalogExercise, type WorkoutPlan } from "./plan.js";

const ex = (id: string, targetKey: string, equipment: string, extra = {}): CatalogExercise => ({
  _id: id, name: id, musclePrimary: "ombro", targetKey, equipment, isWarmup: false, isStretch: false, ...extra
});

describe("validatePlan", () => {
  it("rejeita elevação frontal como reserva de elevação lateral", () => {
    const catalog = [
      ex("warm", "manguito_rotador_externo", "elastico", { isWarmup: true }),
      ex("lateral", "ombro_cabeca_lateral", "maquina"),
      ex("frontal", "ombro_cabeca_anterior", "halter"),
      ex("m2", "ombro_desenvolvimento", "halter"), ex("r2", "ombro_desenvolvimento", "barra"),
      ex("m3", "ombro_geral", "halter"), ex("r3", "ombro_geral", "elastico"),
      ex("m4", "manguito_rotador_interno", "cabo"), ex("r4", "manguito_rotador_interno", "halter"),
      ex("stretch", "ombro_geral", "peso_corporal", { isStretch: true, isWarmup: true })
    ];
    const pairs: Array<[string, string]> = [["m2","r2"],["m3","r3"],["m4","r4"]];
    const exercises = [
      { exerciseId: "warm", phase: "aquecimento" as const, sets: 2, reps: "15", restSeconds: 20, reserveExerciseIds: [] },
      { exerciseId: "lateral", phase: "principal" as const, sets: 3, reps: "12", restSeconds: 60, reserveExerciseIds: ["frontal"] },
      ...pairs.map(([exerciseId, reserve]) => ({ exerciseId, phase: "principal" as const, sets: 3, reps: "12", restSeconds: 60, reserveExerciseIds: [reserve] })),
      { exerciseId: "stretch", phase: "alongamento" as const, sets: 2, reps: "30s", restSeconds: 20, reserveExerciseIds: [] }
    ];
    const plan: WorkoutPlan = { days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, title: weekday === 1 ? "Ombros" : "Descanso", focusMuscles: weekday === 1 ? ["ombro"] : [], exercises: weekday === 1 ? exercises : [] })) };
    expect(() => validatePlan(plan, catalog, [1], ["maquina", "cabo", "halter"])).toThrow(/correlação anatômica/);
  });
});
