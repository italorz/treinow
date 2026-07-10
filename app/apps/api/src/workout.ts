import { GoogleGenAI } from "@google/genai";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { db } from "./infra.js";
import { planSchema, validatePlan, type CatalogExercise, type WorkoutPlan } from "./plan.js";
import { safePromptProfile } from "./privacy.js";

const freeEquipment = new Set(["halter", "anilha", "barra", "peso_corporal", "elastico"]);
const fixedEquipment = new Set(["maquina", "cabo", "smith"]);
const geminiPlanSchema = {
  type: "object",
  required: ["days"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        required: ["weekday", "title", "focusMuscles", "exercises"],
        properties: {
          weekday: { type: "integer" },
          title: { type: "string" },
          focusMuscles: { type: "array", items: { type: "string" } },
          exercises: {
            type: "array",
            items: {
              type: "object",
              required: ["exerciseId", "phase", "sets", "reps", "restSeconds", "reserveExerciseIds"],
              properties: {
                exerciseId: { type: "string" },
                phase: { type: "string", enum: ["aquecimento", "principal", "alongamento"] },
                sets: { type: "integer" },
                reps: { type: "string" },
                restSeconds: { type: "integer" },
                reserveExerciseIds: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      }
    }
  }
} as const;

export type GeneratedPlan = {
  plan: WorkoutPlan;
  source: "deterministic-fallback" | `gemini:${string}`;
  providerFailures?: string[];
};

export async function generatePlan(studentId: string): Promise<GeneratedPlan> {
  const profile = await db.collection("profiles").findOne({ studentId: new ObjectId(studentId) });
  if (!profile) throw new Error("Meta não configurada");
  const injuries = Array.isArray(profile.injuries) ? profile.injuries : [];
  if (injuries.some((injury: any) => injury.status === "dor_aguda" || (injury.severity === "grave" && !injury.medicallyCleared))) {
    throw new Error("Geração bloqueada: lesão aguda ou grave sem liberação");
  }

  const allExercises = await db.collection("exercises").find({
    contraindications: { $nin: injuries.map((injury: any) => injury.region) },
    needsReview: { $ne: true },
    targetKey: { $exists: true }
  }).project({
    _id: 1, name: 1, musclePrimary: 1, secondaryMuscles: 1, equipment: 1, complexity: 1,
    movementPattern: 1, targetKey: 1, isWarmup: 1, isStretch: 1, joints: 1
  }).toArray() as unknown as CatalogExercise[];
  const catalog = balancedCatalog(allExercises);
  if (!catalog.length) throw new Error("Catálogo compatível vazio");

  const available = Array.isArray(profile.equipment) ? profile.equipment : ["peso_corporal"];
  const payload = safePromptProfile(profile);
  const compactCatalog = catalog.map((exercise: any) => ({
    id: String(exercise._id),
    nome: exercise.name,
    musculo: exercise.musclePrimary,
    alvo_exato: exercise.targetKey,
    equipamento: exercise.equipment,
    disponivel: available.includes(exercise.equipment) || exercise.equipment === "peso_corporal",
    aquecimento: exercise.isWarmup,
    alongamento: exercise.isStretch,
    articulacoes: exercise.joints
  }));
  const prompt = `Você é um treinador especialista em biomecânica. Gere uma semana completa usando SOMENTE os IDs fornecidos.

REGRAS OBRIGATÓRIAS:
1. Retorne exatamente os 7 weekdays (0=domingo a 6=sábado). Somente os dias ${JSON.stringify(profile.trainingDays)} têm treino; os demais têm exercises=[].
2. Cada dia de treino deve vir nesta ordem: 2-3 itens phase="aquecimento", 4-7 itens phase="principal" e 1-2 itens phase="alongamento".
3. Todo exercício principal deve usar equipamento com disponivel=true e ter de 1 a 3 reserveExerciseIds.
4. Cada reserva deve ter o MESMO alvo_exato do principal, mas equipamento diferente. Nunca troque cabeça lateral do ombro por cabeça anterior/posterior. Elevação lateral só aceita reserva de alvo ombro_cabeca_lateral; elevação frontal nunca é equivalente.
5. Para exercícios de máquina, cabo ou smith, inclua ao menos uma reserva do mesmo alvo_exato com halter, anilha, barra, elástico ou peso corporal.
6. Nenhum ID pode se repetir na semana inteira, nem como principal, aquecimento, alongamento ou reserva.
7. Dia com ombros exige aquecimento do manguito rotador (alvo_exato começando por manguito_rotador_).
8. Alongamentos devem ter alongamento=true; aquecimentos devem ter aquecimento=true.
9. Respeite nível, duração, lesões, descanso e volume. Não diagnostique e não invente IDs.

Perfil desidentificado: ${JSON.stringify(payload)}
Catálogo: ${JSON.stringify(compactCatalog)}`;

  if (!config.GEMINI_API_KEY) {
    return { plan: deterministicPlan(profile, catalog), source: "deterministic-fallback" };
  }
  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const models = [...new Set([config.GEMINI_PLAN_MODEL, config.GEMINI_FALLBACK_MODEL, "gemini-2.5-flash"])];
  const failures: string[] = [];
  for (const model of models) {
    for (let attempt = 1; attempt <= 1; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: `${prompt}\nTentativa ${attempt}: confira todas as regras antes de responder.`,
          config: {
            temperature: 0.2,
            abortSignal: AbortSignal.timeout(45_000),
            httpOptions: { timeout: 40_000 },
            responseMimeType: "application/json",
            responseJsonSchema: geminiPlanSchema as any
          }
        });
        const parsed = planSchema.parse(JSON.parse(response.text ?? "{}"));
        return {
          plan: validatePlan(parsed, catalog, profile.trainingDays, available),
          source: `gemini:${model}`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${model}#${attempt}: ${message.slice(0, 240)}`);
        if (/INVALID_ARGUMENT|code[\"']?:400/.test(message)) break;
      }
    }
  }
  return {
    plan: deterministicPlan(profile, catalog),
    source: "deterministic-fallback",
    providerFailures: failures
  };
}

function balancedCatalog(exercises: CatalogExercise[]) {
  const buckets = new Map<string, CatalogExercise[]>();
  for (const exercise of exercises) {
    const key = `${exercise.targetKey}:${exercise.equipment}:${exercise.isWarmup}:${exercise.isStretch}`;
    const bucket = buckets.get(key) ?? [];
    if (bucket.length < 2) bucket.push(exercise);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].flat().slice(0, 360);
}

function deterministicPlan(profile: any, catalog: CatalogExercise[]): WorkoutPlan {
  const activeDays = new Set<number>(profile.trainingDays);
  const available = new Set<string>([...(profile.equipment ?? []), "peso_corporal"]);
  const used = new Set<string>();
  const usedNames = new Set<string>();
  const priorities = Array.isArray(profile.priorityMuscles) ? profile.priorityMuscles : [];
  const mains = catalog.filter(exercise =>
    !exercise.isWarmup && !exercise.isStretch && available.has(exercise.equipment) &&
    catalog.some(reserve =>
      reserve.targetKey === exercise.targetKey &&
      reserve.equipment !== exercise.equipment &&
      (!fixedEquipment.has(exercise.equipment) || freeEquipment.has(reserve.equipment))
    )
  );
  const trainingDayOrder = [...activeDays].sort((a, b) => a - b);

  const plan: WorkoutPlan = {
    days: Array.from({ length: 7 }, (_, weekday) => {
      if (!activeDays.has(weekday)) return { weekday, title: "Descanso", focusMuscles: [], exercises: [] };
      const dayIndex = trainingDayOrder.indexOf(weekday);
      const desiredMuscle = priorities[dayIndex % Math.max(priorities.length, 1)];
      const selected: Array<{ exercise: CatalogExercise; reserves: CatalogExercise[] }> = [];
      const candidates = [...mains].sort((a, b) => {
        const scoreA = a.musclePrimary === desiredMuscle ? 2 : priorities.includes(a.musclePrimary) ? 1 : 0;
        const scoreB = b.musclePrimary === desiredMuscle ? 2 : priorities.includes(b.musclePrimary) ? 1 : 0;
        return scoreB - scoreA;
      });
      for (const exercise of candidates) {
        if (selected.length >= 5) break;
        const id = String(exercise._id);
        if (used.has(id) || usedNames.has(normalizedName(exercise.name))) continue;
        const reserves = findReserves(exercise, catalog, used, usedNames);
        if (!reserves.length) continue;
        selected.push({ exercise, reserves });
        used.add(id);
        usedNames.add(normalizedName(exercise.name));
        reserves.forEach(reserve => {
          used.add(String(reserve._id));
          usedNames.add(normalizedName(reserve.name));
        });
      }
      const mainItems = selected.map(({ exercise, reserves }) => {
        const id = String(exercise._id);
        return { exerciseId: id, phase: "principal" as const, sets: 3, reps: "8-12", restSeconds: 60, reserveExerciseIds: reserves.map(reserve => String(reserve._id)) };
      });
      const shoulderDay = selected.some(({ exercise }) => exercise.targetKey.startsWith("ombro_"));
      const cuffWarmups = catalog.filter(exercise =>
        shoulderDay && exercise.isWarmup && exercise.targetKey.startsWith("manguito_rotador_") &&
        !used.has(String(exercise._id)) && !usedNames.has(normalizedName(exercise.name))
      );
      const otherWarmups = catalog.filter(exercise =>
        exercise.isWarmup && !exercise.isStretch && !used.has(String(exercise._id)) &&
        !usedNames.has(normalizedName(exercise.name)) && !cuffWarmups.includes(exercise)
      );
      const warmups = uniqueByName([...cuffWarmups, ...otherWarmups], usedNames, 2);
      warmups.forEach(exercise => {
        used.add(String(exercise._id));
        usedNames.add(normalizedName(exercise.name));
      });
      const focus = [...new Set(selected.map(({ exercise }) => exercise.musclePrimary))].slice(0, 3);
      const stretchCandidates = catalog.filter(exercise =>
        exercise.isStretch && !used.has(String(exercise._id)) && !usedNames.has(normalizedName(exercise.name))
      )
        .sort((a, b) => Number(focus.includes(b.musclePrimary)) - Number(focus.includes(a.musclePrimary)));
      const stretches = uniqueByName(stretchCandidates, usedNames, 2);
      stretches.forEach(exercise => {
        used.add(String(exercise._id));
        usedNames.add(normalizedName(exercise.name));
      });
      const exercises = [
        ...warmups.map(exercise => ({ exerciseId: String(exercise._id), phase: "aquecimento" as const, sets: 2, reps: "12-15", restSeconds: 20, reserveExerciseIds: [] })),
        ...mainItems,
        ...stretches.map(exercise => ({ exerciseId: String(exercise._id), phase: "alongamento" as const, sets: 2, reps: "30s", restSeconds: 20, reserveExerciseIds: [] }))
      ];
      return { weekday, title: `Treino de ${focus.join(" e ") || "corpo inteiro"}`, focusMuscles: focus, exercises };
    })
  };
  return validatePlan(plan, catalog, profile.trainingDays, [...available]);
}

function findReserves(exercise: CatalogExercise, catalog: CatalogExercise[], used: Set<string>, usedNames: Set<string>) {
  const reserves: CatalogExercise[] = [];
  const names = new Set(usedNames);
  for (const reserve of catalog) {
    const reserveId = String(reserve._id);
    if (
      used.has(reserveId) || usedNames.has(normalizedName(reserve.name)) ||
      reserve.isWarmup || reserve.isStretch ||
      reserve.targetKey !== exercise.targetKey || reserve.equipment === exercise.equipment
    ) continue;
    if (fixedEquipment.has(exercise.equipment) && !freeEquipment.has(reserve.equipment)) continue;
    const name = normalizedName(reserve.name);
    if (names.has(name)) continue;
    reserves.push(reserve);
    names.add(name);
    if (reserves.length === 2) break;
  }
  return reserves;
}

function uniqueByName(exercises: CatalogExercise[], usedNames: Set<string>, limit: number) {
  const selected: CatalogExercise[] = [];
  const names = new Set(usedNames);
  for (const exercise of exercises) {
    const name = normalizedName(exercise.name);
    if (names.has(name)) continue;
    selected.push(exercise);
    names.add(name);
    if (selected.length === limit) break;
  }
  return selected;
}

function normalizedName(name: string) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}
