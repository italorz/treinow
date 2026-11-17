package app

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
)

func dateValue(v any) (time.Time, bool) {
	if t, ok := v.(time.Time); ok {
		return t, true
	}
	t, e := time.Parse(time.RFC3339Nano, str(v))
	return t, e == nil
}
func aggregateProgress(logs, measurements []M, trainingDays int) M {
	sort.SliceStable(logs, func(i, j int) bool { return str(logs[i]["completed_at"]) < str(logs[j]["completed_at"]) })
	total := 0.0
	records := 0
	best := map[string]float64{}
	days := map[string]bool{}
	weekly := map[string]M{}
	weeklyDays := map[string]map[string]bool{}
	for _, l := range logs {
		t, ok := dateValue(l["completed_at"])
		if !ok {
			continue
		}
		t = t.UTC()
		day := t.Format(time.DateOnly)
		week := t.AddDate(0, 0, -int(t.Weekday())).Format(time.DateOnly)
		volume := max(0, num(l["sets"])) * max(0, num(l["reps"])) * max(0, num(l["load_kg"]))
		total += volume
		load := max(0, num(l["load_kg"]))
		id := str(l["exercise_id"])
		previous, ok := best[id]
		if !ok || load > previous {
			records++
			best[id] = load
		}
		days[day] = true
		if weekly[week] == nil {
			weekly[week] = M{"volumeKg": 0.0}
			weeklyDays[week] = map[string]bool{}
		}
		weekly[week]["volumeKg"] = num(weekly[week]["volumeKg"]) + volume
		weeklyDays[week][day] = true
	}
	keys := []string{}
	for k := range weekly {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > 16 {
		keys = keys[len(keys)-16:]
	}
	volumes := []M{}
	for _, k := range keys {
		t, _ := time.Parse(time.DateOnly, k)
		volumes = append(volumes, M{"week": t.Format("02/01"), "volumeKg": round1(num(weekly[k]["volumeKg"])), "sessions": len(weeklyDays[k])})
	}
	sort.SliceStable(measurements, func(i, j int) bool { return str(measurements[i]["measured_at"]) < str(measurements[j]["measured_at"]) })
	weights, bmis := []M{}, []M{}
	for _, m := range measurements {
		t, ok := dateValue(m["measured_at"])
		if !ok {
			continue
		}
		date := t.UTC().Format("02/01")
		if m["weight_kg"] != nil {
			weights = append(weights, M{"date": date, "weightKg": round1(num(m["weight_kg"]))})
		}
		if m["bmi"] != nil {
			bmis = append(bmis, M{"date": date, "bmi": round1(num(m["bmi"]))})
		}
	}
	if len(weights) > 24 {
		weights = weights[len(weights)-24:]
	}
	if len(bmis) > 24 {
		bmis = bmis[len(bmis)-24:]
	}
	adherence := min(100, int(math.Floor(float64(len(days))/float64(max(1, min(7, trainingDays))*4)*100+.5)))
	return M{"adherencePercent": adherence, "totalVolumeKg": round1(total), "personalRecords": records, "weeklyVolume": volumes, "weightTrend": weights, "bmiTrend": bmis}
}
func (a *App) refreshAnalytics(ctx context.Context, student string) error {
	logs, e := many(ctx, a.DB, "SELECT to_jsonb(l) FROM workout_logs l WHERE student_id=$1 ORDER BY completed_at,id", student)
	if e != nil {
		return e
	}
	measurements, e := many(ctx, a.DB, "SELECT to_jsonb(m) FROM measurements m WHERE student_id=$1 ORDER BY measured_at,id", student)
	if e != nil {
		return e
	}
	p, e := a.profile(ctx, student)
	if e != nil {
		return e
	}
	days := len(intsOf(p["training_days"]))
	if days == 0 {
		days = 3
	}
	v := aggregateProgress(logs, measurements, days)
	_, e = a.DB.Exec(ctx, `INSERT INTO analytics_snapshots(id,student_id,adherence_percent,total_volume_kg,personal_records,weekly_volume,weight_trend,bmi_trend) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(student_id) DO UPDATE SET adherence_percent=EXCLUDED.adherence_percent,total_volume_kg=EXCLUDED.total_volume_kg,personal_records=EXCLUDED.personal_records,weekly_volume=EXCLUDED.weekly_volume,weight_trend=EXCLUDED.weight_trend,bmi_trend=EXCLUDED.bmi_trend,generated_at=now()`, uuid.NewString(), student, int(num(v["adherencePercent"])), num(v["totalVolumeKg"]), int(num(v["personalRecords"])), jsonBytes(v["weeklyVolume"]), jsonBytes(v["weightTrend"]), jsonBytes(v["bmiTrend"]))
	return e
}
