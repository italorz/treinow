import { GoogleGenAI } from "@google/genai";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { db } from "./infra.js";
import { planSchema, validatePlan, type CatalogExercise, type WorkoutPlan } from "./plan.js";
import { safePromptProfile } from "./privacy.js";

const freeEquipment = new Set(["halter", "anilha", "barra", "peso_corporal", "elastico"]);
const fixedEquipment = new Set(["maquina", "cabo", "smith"]);

export type GeneratedPlan = {
  plan: WorkoutPlan;
  source: "rules-engine" | `gemini:${string}`;
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

  if (config.PLAN_ENGINE === "gemini" && config.GEMINI_API_KEY) {
    const attempt = await geminiPlan(profile, catalog);
    if ("plan" in attempt) return attempt;
    return { plan: rulesPlan(profile, catalog), source: "rules-engine", providerFailures: attempt.failures };
  }
  return { plan: rulesPlan(profile, catalog), source: "rules-engine" };
}

// ---------------------------------------------------------------------------
// Motor de regras: monta a semana só com o perfil da tela de Meta, sem IA.
// ---------------------------------------------------------------------------

const legMuscles = new Set(["pernas", "gluteos", "panturrilha"]);
const armMuscles = new Set(["biceps", "triceps", "antebraco"]);
const heavyLegPattern = /leg ?press|agachamento|afundo|avanç|bulgaro|búlgaro|salto|jump|hack|stiff|terra|pistol/i;
const overheadPattern = /desenvolvimento|militar|arnold|overhead/i;
const spinePattern = /terra|deadlift|good ?morning|curvad|superman/i;

// O catálogo já exclui exercícios contraindicados para a região lesionada.
// Estas regras adicionam a camada de bom senso: com articulação sensível,
// evitamos padrões de carga alta mesmo quando o músculo é treinável.
export function allowedByInjury(exercise: CatalogExercise, regions: Set<string>) {
  const complexity = (exercise as any).complexity;
  if ((regions.has("joelho") || regions.has("tornozelo") || regions.has("quadril")) && legMuscles.has(exercise.musclePrimary)) {
    if (heavyLegPattern.test(exercise.name)) return false;
    if (["maquina", "smith", "barra"].includes(exercise.equipment) && exercise.musclePrimary !== "panturrilha") return false;
    if (complexity === "avancado") return false;
  }
  if (regions.has("ombro") && exercise.musclePrimary === "ombro") {
    if (exercise.equipment === "barra" && overheadPattern.test(exercise.name)) return false;
    if (complexity === "avancado") return false;
  }
  if ((regions.has("cotovelo") || regions.has("punho")) && armMuscles.has(exercise.musclePrimary) && exercise.equipment === "barra") return false;
  if (regions.has("coluna_lombar") && spinePattern.test(exercise.name)) return false;
  return true;
}

function dose(profile: any) {
  const base = ({
    mais_forte: { sets: 4, reps: "6-10", rest: 90 },
    mais_bonito: { sets: 3, reps: "8-12", rest: 60 },
    mais_leve: { sets: 3, reps: "12-15", rest: 45 },
    menos_estressado: { sets: 2, reps: "10-15", rest: 60 }
  } as Record<string, { sets: number; reps: string; rest: number }>)[profile.goal] ?? { sets: 3, reps: "10-15", rest: 45 };
  let { sets, rest } = base;
  if (profile.intensity === "leve") { sets = Math.max(2, sets - 1); rest += 15; }
  if (profile.intensity === "intensa") { sets = Math.min(5, sets + 1); rest = Math.max(30, rest - 15); }
  if (profile.level === "iniciante") sets = Math.min(sets, 3);
  return { sets, reps: base.reps, rest };
}

function splitFor(daysCount: number): { title: string; muscles: string[] }[] {
  const push = { title: "Peito, ombros e tríceps", muscles: ["peitoral", "ombro", "triceps"] };
  const pull = { title: "Costas e bíceps", muscles: ["costas", "biceps", "trapezio", "antebraco"] };
  const legs = { title: "Pernas e core", muscles: ["pernas", "gluteos", "panturrilha", "core"] };
  const splits: Record<number, { title: string; muscles: string[] }[]> = {
    1: [{ title: "Corpo inteiro", muscles: ["peitoral", "costas", "pernas", "ombro", "core"] }],
    2: [
      { title: "Superiores", muscles: ["peitoral", "costas", "ombro", "biceps", "triceps"] },
      { title: "Inferiores e core", muscles: ["pernas", "gluteos", "panturrilha", "core"] }
    ],
    3: [push, pull, legs],
    4: [
      { title: "Peito e tríceps", muscles: ["peitoral", "triceps"] },
      { title: "Costas e bíceps", muscles: ["costas", "biceps", "trapezio"] },
      { title: "Pernas completas", muscles: ["pernas", "gluteos", "panturrilha"] },
      { title: "Ombros e core", muscles: ["ombro", "core", "antebraco"] }
    ],
    5: [
      { title: "Peito", muscles: ["peitoral", "triceps"] },
      { title: "Costas", muscles: ["costas", "biceps"] },
      legs,
      { title: "Ombros e trapézio", muscles: ["ombro", "trapezio"] },
      { title: "Braços e core", muscles: ["biceps", "triceps", "antebraco", "core"] }
    ],
    6: [push, pull, legs, push, pull, legs],
    7: [push, pull, legs, push, pull, legs, { title: "Mobilidade e core", muscles: ["core", "panturrilha", "antebraco"] }]
  };
  const chosen = splits[Math.min(Math.max(daysCount, 1), 7)] ?? [{ title: "Corpo inteiro", muscles: ["peitoral", "costas", "pernas", "ombro", "core"] }];
  return chosen.map(day => ({ title: day.title, muscles: [...day.muscles] }));
}

export function rulesPlan(profile: any, catalog: CatalogExercise[]): WorkoutPlan {
  const activeDays = [...new Set<number>(profile.trainingDays ?? [])].sort((a, b) => a - b);
  const available = new Set<string>([...(profile.equipment ?? []), "peso_corporal"]);
  const priorities: string[] = Array.isArray(profile.priorityMuscles) ? profile.priorityMuscles : [];
  const regions = new Set<string>((profile.injuries ?? []).map((injury: any) => injury.region));
  const { sets, reps, rest } = dose(profile);
  const mainsTarget = Math.min(7, Math.max(4, Math.round(Number(profile.durationMinutes || 45) / 12)));

  const safe = (exercise: CatalogExercise) =>
    allowedByInjury(exercise, regions) &&
    !(profile.level === "iniciante" && (exercise as any).complexity === "avancado");
  const used = new Set<string>();
  const usedNames = new Set<string>();
  const mark = (exercise: CatalogExercise) => { used.add(String(exercise._id)); usedNames.add(normalizedName(exercise.name)); };
  const unused = (exercise: CatalogExercise) => !used.has(String(exercise._id)) && !usedNames.has(normalizedName(exercise.name));
  const isMainCandidate = (exercise: CatalogExercise) =>
    !exercise.isWarmup && !exercise.isStretch && available.has(exercise.equipment) && safe(exercise) && unused(exercise);

  const template = splitFor(activeDays.length || 1);
  priorities.forEach((muscle, i) => {
    if (!template.some(day => day.muscles.includes(muscle))) template[i % template.length]?.muscles.push(muscle);
  });

  const plan: WorkoutPlan = {
    days: Array.from({ length: 7 }, (_, weekday) => {
      if (!activeDays.includes(weekday)) return { weekday, title: "Descanso", focusMuscles: [], exercises: [] };
      const slot = template[activeDays.indexOf(weekday) % template.length]!;
      const muscleOrder = [...new Set([...priorities.filter(m => slot.muscles.includes(m)), ...slot.muscles])];

      const picked: Array<{ exercise: CatalogExercise; reserves: CatalogExercise[] }> = [];
      const pickFor = (muscle?: string) => {
        const candidate = catalog.find(exercise =>
          (muscle ? exercise.musclePrimary === muscle : true) && isMainCandidate(exercise) &&
          findReserves(exercise, catalog, used, usedNames, safe, available).length > 0
        );
        if (!candidate) return false;
        const reserves = findReserves(candidate, catalog, used, usedNames, safe, available);
        mark(candidate); reserves.forEach(mark);
        picked.push({ exercise: candidate, reserves });
        return true;
      };
      for (let round = 0; round < mainsTarget && picked.length < mainsTarget; round++) {
        let progressed = false;
        for (const muscle of muscleOrder) {
          if (picked.length >= mainsTarget) break;
          progressed = pickFor(muscle) || progressed;
        }
        if (!progressed) break;
      }
      while (picked.length < 4 && pickFor()) { /* completa o mínimo com qualquer grupo */ }

      const focus = [...new Set(picked.map(p => p.exercise.musclePrimary))].slice(0, 3);
      const shoulderDay = picked.some(p => p.exercise.targetKey.startsWith("ombro_"));
      const warmPool = catalog.filter(e => e.isWarmup && !e.isStretch && safe(e) && unused(e));
      const orderedWarmups = [
        ...(shoulderDay ? warmPool.filter(e => e.targetKey.startsWith("manguito_rotador_")) : []),
        ...warmPool.filter(e => focus.includes(e.musclePrimary)),
        ...warmPool
      ];
      const warmups = uniqueByName(orderedWarmups, usedNames, 2);
      warmups.forEach(mark);
      const stretchPool = catalog.filter(e => e.isStretch && safe(e) && unused(e))
        .sort((a, b) => Number(focus.includes(b.musclePrimary)) - Number(focus.includes(a.musclePrimary)));
      const stretches = uniqueByName(stretchPool, usedNames, 2);
      stretches.forEach(mark);

      return {
        weekday,
        title: slot.title,
        focusMuscles: focus,
        exercises: [
          ...warmups.map(e => ({ exerciseId: String(e._id), phase: "aquecimento" as const, sets: 2, reps: "12-15", restSeconds: 30, reserveExerciseIds: [] })),
          ...picked.map(({ exercise, reserves }) => ({
            exerciseId: String(exercise._id), phase: "principal" as const, sets, reps, restSeconds: rest,
            reserveExerciseIds: reserves.map(r => String(r._id))
          })),
          ...stretches.map(e => ({ exerciseId: String(e._id), phase: "alongamento" as const, sets: 2, reps: "30s", restSeconds: 20, reserveExerciseIds: [] }))
        ]
      };
    })
  };
  return validatePlan(plan, catalog, activeDays, [...available]);
}

function findReserves(
  exercise: CatalogExercise, catalog: CatalogExercise[], used: Set<string>, usedNames: Set<string>,
  safe: (e: CatalogExercise) => boolean, available: Set<string>
) {
  const eligible = catalog.filter(reserve =>
    !used.has(String(reserve._id)) && !usedNames.has(normalizedName(reserve.name)) &&
    !reserve.isWarmup && !reserve.isStretch && safe(reserve) &&
    reserve.targetKey === exercise.targetKey && reserve.equipment !== exercise.equipment &&
    (!fixedEquipment.has(exercise.equipment) || freeEquipment.has(reserve.equipment))
  );
  // Reserva serve quando o aparelho do principal está ocupado: prioriza
  // equipamento que o aluno tem e, entre eles, os de peso livre.
  eligible.sort((a, b) =>
    Number(available.has(b.equipment)) - Number(available.has(a.equipment)) ||
    Number(freeEquipment.has(b.equipment)) - Number(freeEquipment.has(a.equipment))
  );
  const reserves: CatalogExercise[] = [];
  const names = new Set<string>();
  for (const reserve of eligible) {
    const name = normalizedName(reserve.name);
    if (names.has(name)) continue;
    reserves.push(reserve); names.add(name);
    if (reserves.length === 2) break;
  }
  return reserves;
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

// ---------------------------------------------------------------------------
// Caminho opcional via Gemini (PLAN_ENGINE=gemini). O motor de regras continua
// como fallback obrigatório.
// ---------------------------------------------------------------------------

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

async function geminiPlan(profile: any, catalog: CatalogExercise[]): Promise<GeneratedPlan | { failures: string[] }> {
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

  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const models = [...new Set([config.GEMINI_PLAN_MODEL, config.GEMINI_FALLBACK_MODEL, "gemini-2.5-flash"])];
  const failures: string[] = [];
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `${prompt}\nConfira todas as regras antes de responder.`,
        config: {
          temperature: 0.2,
          abortSignal: AbortSignal.timeout(45_000),
          httpOptions: { timeout: 40_000 },
          responseMimeType: "application/json",
          responseJsonSchema: geminiPlanSchema as any
        }
      });
      const parsed = planSchema.parse(JSON.parse(response.text ?? "{}"));
      return { plan: validatePlan(parsed, catalog, profile.trainingDays, available), source: `gemini:${model}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}: ${message.slice(0, 240)}`);
    }
  }
  return { failures };
}
