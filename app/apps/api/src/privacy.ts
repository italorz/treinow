export function safePromptProfile(meta: Record<string, unknown>, progress: Record<string, unknown> = {}) {
  const allowed = ["goal", "level", "trainingDays", "durationMinutes", "location", "equipment", "weightKg", "heightCm", "bmi", "age", "sex", "priorityMuscles", "intensity", "injuries"];
  return Object.fromEntries(allowed.filter(k => k in meta).map(k => [k, meta[k]]).concat([["progressSummary", progress]]));
}
