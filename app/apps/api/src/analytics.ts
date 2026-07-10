type WorkoutLog = {
  exerciseId?: unknown;
  completedAt?: Date | string;
  sets?: number;
  reps?: number;
  loadKg?: number;
};

type Measurement = {
  measuredAt?: Date | string;
  weightKg?: number;
  bmi?: number;
};

const validDate = (value: Date | string | undefined) => {
  const date = value instanceof Date ? value : new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date;
};

const weekKey = (date: Date) => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString().slice(0, 10);
};

const label = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);

export function aggregateProgress(
  logs: WorkoutLog[],
  measurements: Measurement[],
  trainingDaysPerWeek = 3
) {
  const weeks = new Map<string, { volumeKg: number; sessions: Set<string> }>();
  const completedDays = new Set<string>();
  const records = new Map<string, number>();
  let totalVolumeKg = 0;
  let personalRecords = 0;

  for (const log of logs) {
    const completedAt = validDate(log.completedAt);
    if (!completedAt) continue;
    const sets = Math.max(0, Number(log.sets ?? 0));
    const reps = Math.max(0, Number(log.reps ?? 0));
    const load = Math.max(0, Number(log.loadKg ?? 0));
    const volume = sets * reps * load;
    const day = completedAt.toISOString().slice(0, 10);
    const week = weekKey(completedAt);
    const currentWeek = weeks.get(week) ?? { volumeKg: 0, sessions: new Set<string>() };
    currentWeek.volumeKg += volume;
    currentWeek.sessions.add(day);
    weeks.set(week, currentWeek);
    completedDays.add(day);
    totalVolumeKg += volume;

    const exercise = String(log.exerciseId ?? "unknown");
    const previousRecord = records.get(exercise) ?? -1;
    if (load > previousRecord) {
      personalRecords++;
      records.set(exercise, load);
    }
  }

  const orderedMeasurements = measurements
    .map(item => ({ ...item, date: validDate(item.measuredAt) }))
    .filter((item): item is typeof item & { date: Date } => item.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const expectedSessions = Math.max(1, Math.min(7, trainingDaysPerWeek)) * 4;
  return {
    adherencePercent: Math.min(100, Math.round((completedDays.size / expectedSessions) * 100)),
    totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
    personalRecords,
    weeklyVolume: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-16)
      .map(([week, data]) => ({
        week: label(new Date(`${week}T00:00:00Z`)),
        volumeKg: Math.round(data.volumeKg * 10) / 10,
        sessions: data.sessions.size
      })),
    weightTrend: orderedMeasurements
      .filter(item => Number.isFinite(Number(item.weightKg)))
      .slice(-24)
      .map(item => ({ date: label(item.date), weightKg: Math.round(Number(item.weightKg) * 10) / 10 })),
    bmiTrend: orderedMeasurements
      .filter(item => Number.isFinite(Number(item.bmi)))
      .slice(-24)
      .map(item => ({ date: label(item.date), bmi: Math.round(Number(item.bmi) * 10) / 10 })),
    computedAt: new Date().toISOString()
  };
}
