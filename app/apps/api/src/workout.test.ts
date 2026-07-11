import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safePromptProfile } from "./privacy.js";
import { allowedByInjury, rulesPlan } from "./workout.js";
import type { CatalogExercise } from "./plan.js";

const ex = (id: string, name: string, muscle: string, equipment: string, targetKey: string, extra: Partial<CatalogExercise> & { complexity?: string } = {}): CatalogExercise => ({
  _id: id, name, musclePrimary: muscle, equipment, targetKey, isWarmup: false, isStretch: false, complexity: "iniciante", ...extra
} as CatalogExercise);

const catalog: CatalogExercise[] = [
  ex("p1", "Supino na máquina", "peitoral", "maquina", "peitoral_horizontal"),
  ex("p2", "Crucifixo com halteres", "peitoral", "halter", "peitoral_horizontal"),
  ex("c1", "Remada na máquina", "costas", "maquina", "costas_remada_horizontal"),
  ex("c2", "Remada unilateral com halter", "costas", "halter", "costas_remada_horizontal"),
  ex("l1", "Leg press", "pernas", "maquina", "quadriceps_agachamento"),
  ex("l2", "Agachamento taça", "pernas", "halter", "quadriceps_agachamento"),
  ex("l3", "Extensão de quadril com elástico", "pernas", "elastico", "pernas_unilateral"),
  ex("l4", "Extensão de quadril no cabo", "pernas", "cabo", "pernas_unilateral"),
  ex("o1", "Elevação lateral na máquina", "ombro", "maquina", "ombro_cabeca_lateral"),
  ex("o2", "Elevação lateral com halteres", "ombro", "halter", "ombro_cabeca_lateral"),
  ex("k1", "Prancha abdominal", "core", "peso_corporal", "core_estabilidade"),
  ex("k2", "Prancha com apoio no elástico", "core", "elastico", "core_estabilidade"),
  ex("w1", "Rotação externa com elástico", "ombro", "elastico", "manguito_rotador_externo", { isWarmup: true }),
  ex("w2", "Mobilidade torácica", "core", "peso_corporal", "core_flexao", { isWarmup: true }),
  ex("w3", "Elevação de calcanhares leve", "panturrilha", "peso_corporal", "panturrilha_raise", { isWarmup: true }),
  ex("s1", "Alongamento de peitoral", "peitoral", "peso_corporal", "peitoral_horizontal", { isStretch: true }),
  ex("s2", "Alongamento de ombros", "ombro", "peso_corporal", "ombro_geral", { isStretch: true })
];

const baseProfile = {
  goal: "mais_forte", level: "iniciante", intensity: "moderada", durationMinutes: 45,
  trainingDays: [1], equipment: ["maquina", "halter", "cabo", "elastico"],
  priorityMuscles: ["ombro"], injuries: [] as any[]
};

describe("rulesPlan", () => {
  it("com lesão de joelho evita leg press/agachamento e mantém plano válido", () => {
    const plan = rulesPlan({ ...baseProfile, injuries: [{ region: "joelho", severity: "leve", status: "recuperacao", medicallyCleared: true }] }, catalog);
    const day = plan.days[1]!;
    const names = day.exercises.flatMap(item => [item.exerciseId, ...item.reserveExerciseIds])
      .map(id => catalog.find(e => String(e._id) === id)!.name);
    expect(names.join(" ")).not.toMatch(/leg ?press|agachamento/i);
    expect(day.exercises.filter(i => i.phase === "principal").length).toBeGreaterThanOrEqual(4);
  });
  it("dia com ombro inclui aquecimento de manguito e prioriza músculo prioritário", () => {
    const plan = rulesPlan(baseProfile, catalog);
    const day = plan.days[1]!;
    const warmupIds = day.exercises.filter(i => i.phase === "aquecimento").map(i => i.exerciseId);
    expect(warmupIds).toContain("w1");
    expect(day.exercises.find(i => i.phase === "principal")!.exerciseId).toBe("o1");
  });
  it("iniciante limita séries a 3 mesmo com objetivo de força", () => {
    const plan = rulesPlan(baseProfile, catalog);
    const mains = plan.days[1]!.exercises.filter(i => i.phase === "principal");
    expect(mains.every(i => i.sets <= 3)).toBe(true);
  });
  it("sem lesão o leg press volta a ser elegível", () => {
    const plan = rulesPlan(baseProfile, catalog);
    const ids = plan.days[1]!.exercises.flatMap(i => [i.exerciseId, ...i.reserveExerciseIds]);
    expect(ids).toContain("l1");
  });
});

describe("rulesPlan com o catálogo real", () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, "../../../catalog/exercises.pt-BR.json"), "utf8"));
  const real: CatalogExercise[] = raw
    .filter((e: any) => !e.needsReview && e.targetKey)
    .map((e: any, i: number) => ({ ...e, _id: `id${i}` }));
  const buckets = new Map<string, CatalogExercise[]>();
  for (const e of real) {
    const k = `${e.targetKey}:${e.equipment}:${e.isWarmup}:${e.isStretch}`;
    const b = buckets.get(k) ?? [];
    if (b.length < 2) b.push(e);
    buckets.set(k, b);
  }
  const balanced = [...buckets.values()].flat().slice(0, 360);
  it("gera semana completa treinando todos os dias só com peso corporal e halteres", () => {
    // Regressão: perfil padrão da tela de Meta com 7 dias falhava por esgotar
    // os aquecimentos (a maioria dos alongamentos também é aquecimento).
    const plan = rulesPlan({ ...baseProfile, trainingDays: [0, 1, 2, 3, 4, 5, 6], equipment: ["peso_corporal", "halter"], priorityMuscles: [] }, balanced);
    for (const day of plan.days) {
      expect(day.exercises.filter(i => i.phase === "aquecimento").length).toBeGreaterThanOrEqual(1);
      expect(day.exercises.filter(i => i.phase === "principal").length).toBeGreaterThanOrEqual(4);
      expect(day.exercises.filter(i => i.phase === "alongamento").length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("allowedByInjury", () => {
  it("bloqueia máquina pesada de pernas com joelho sensível, mas libera panturrilha", () => {
    expect(allowedByInjury(ex("x", "Cadeira extensora", "pernas", "maquina", "quadriceps_extensao"), new Set(["joelho"]))).toBe(false);
    expect(allowedByInjury(ex("y", "Panturrilha em pé", "panturrilha", "maquina", "panturrilha_raise"), new Set(["joelho"]))).toBe(true);
    expect(allowedByInjury(ex("z", "Desenvolvimento militar", "ombro", "barra", "ombro_desenvolvimento"), new Set(["ombro"]))).toBe(false);
  });
});

describe("safePromptProfile", () => {
  it("remove identificadores, foto e vídeo do prompt", () => {
    const result = safePromptProfile({
      name: "Pessoa", email: "secret@example.com", tenantId: "tenant", photo: "bytes", video: "bytes",
      goal: "ganhar_massa", weightKg: 80, injuries: [{ region: "joelho" }]
    });
    expect(result).toEqual({ goal: "ganhar_massa", weightKg: 80, injuries: [{ region: "joelho" }], progressSummary: {} });
    expect(JSON.stringify(result)).not.toMatch(/secret|tenant|photo|video|Pessoa/);
  });
});
