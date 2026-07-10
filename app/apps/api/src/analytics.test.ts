import { describe, expect, it } from "vitest";
import { aggregateProgress } from "./analytics.js";

describe("aggregateProgress", () => {
  it("gera séries de volume, peso, IMC, aderência e recordes", () => {
    const result = aggregateProgress(
      [
        { exerciseId: "a", completedAt: "2026-07-06T10:00:00Z", sets: 3, reps: 10, loadKg: 20 },
        { exerciseId: "a", completedAt: "2026-07-08T10:00:00Z", sets: 3, reps: 10, loadKg: 25 }
      ],
      [{ measuredAt: "2026-07-08T10:00:00Z", weightKg: 75, bmi: 24.5 }],
      3
    );

    expect(result.totalVolumeKg).toBe(1350);
    expect(result.adherencePercent).toBe(17);
    expect(result.personalRecords).toBe(2);
    expect(result.weeklyVolume[0]).toMatchObject({ volumeKg: 1350, sessions: 2 });
    expect(result.weightTrend[0]?.weightKg).toBe(75);
    expect(result.bmiTrend[0]?.bmi).toBe(24.5);
  });

  it("aceita histórico vazio", () => {
    expect(aggregateProgress([], [])).toMatchObject({
      adherencePercent: 0,
      totalVolumeKg: 0,
      personalRecords: 0,
      weeklyVolume: [],
      weightTrend: [],
      bmiTrend: []
    });
  });
});
