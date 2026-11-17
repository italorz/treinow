package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func catalogFixture(t testing.TB) []M {
	t.Helper()
	data, e := os.ReadFile(filepath.Join("..", "..", "..", "..", "catalog", "exercises.pt-BR.json"))
	if e != nil {
		t.Fatal(e)
	}
	var source []M
	if e = json.Unmarshal(data, &source); e != nil {
		t.Fatal(e)
	}
	out := []M{}
	for _, v := range source {
		if truth(v["needsReview"]) {
			continue
		}
		row := M{"id": v["slug"], "name": v["name"], "classification": v["classification"], "equipment": v["equipment"], "complexity": v["complexity"], "video": v["video"]}
		for key, value := range map[string]string{"name_raw": "nameRaw", "muscle_primary": "musclePrimary", "target_key": "targetKey", "is_warmup": "isWarmup", "is_stretch": "isStretch", "joints": "joints", "contraindications": "contraindications"} {
			row[key] = v[value]
		}
		out = append(out, row)
	}
	return out
}
func baseProfile() M {
	return M{"goal": "mais_forte", "level": "iniciante", "intensity": "moderada", "duration_minutes": 45, "training_days": []int{1, 3, 5}, "equipment": []string{"peso_corporal", "halter", "elastico", "maquina", "cabo"}, "priority_muscles": []string{"ombro"}, "injuries": []M{}, "sex": "nao_informar"}
}
func TestRulesPlanRealCatalog(t *testing.T) {
	catalog := catalogFixture(t)
	for _, sex := range []string{"masculino", "feminino", "nao_informar"} {
		t.Run(sex, func(t *testing.T) {
			p := baseProfile()
			p["sex"] = sex
			days, e := rulesPlan(p, catalog, map[string]bool{})
			if e != nil {
				t.Fatal(e)
			}
			if e = validatePlan(days, catalog, p); e != nil {
				t.Fatal(e)
			}
			if len(days) != 7 {
				t.Fatal("incomplete week")
			}
		})
	}
}
func TestRulesPlanFullWeekAndRecentExercises(t *testing.T) {
	catalog := catalogFixture(t)
	for _, equipment := range [][]string{{"peso_corporal", "halter"}, {"bola", "elastico"}, {"peso_corporal", "elastico"}} {
		t.Run(equipment[len(equipment)-1], func(t *testing.T) {
			p := baseProfile()
			p["training_days"] = []int{0, 1, 2, 3, 4, 5, 6}
			p["duration_minutes"] = 90
			p["equipment"] = equipment
			p["priority_muscles"] = []string{"panturrilha", "trapezio", "antebraco"}
			recent := map[string]bool{}
			for _, e := range catalog[:80] {
				recent[str(e["id"])] = true
			}
			days, e := rulesPlan(p, catalog, recent)
			if e != nil {
				t.Fatal(e)
			}
			if e = validatePlan(days, catalog, p); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestInjuryRulesCannotBeBypassed(t *testing.T) {
	for _, injury := range []M{{"region": "ombro", "severity": "leve", "status": "dor_aguda", "medicallyCleared": true}, {"region": "ombro", "severity": "leve", "status": "recuperacao", "medicallyCleared": false}} {
		if validateInjuries([]M{injury}) == nil {
			t.Fatal("unsafe injury accepted")
		}
	}
	p := baseProfile()
	p["injuries"] = []M{{"region": "joelho", "severity": "grave", "status": "cronica", "medicallyCleared": true}}
	catalog := catalogFixture(t)
	days, e := rulesPlan(p, catalog, map[string]bool{})
	if e != nil {
		t.Fatal(e)
	}
	if e = validatePlan(days, catalog, p); e != nil {
		t.Fatal(e)
	}
}
func TestPlanRejectsWrongReserveAndMissingPreparation(t *testing.T) {
	catalog := catalogFixture(t)
	p := baseProfile()
	days, e := rulesPlan(p, catalog, map[string]bool{})
	if e != nil {
		t.Fatal(e)
	}
	for _, day := range days {
		if len(objects(day["exercises"])) == 0 {
			continue
		}
		day["guidedGeneralWarmup"] = false
		main := []M{}
		for _, item := range objects(day["exercises"]) {
			if str(item["phase"]) == "principal" {
				item["reserveExerciseIds"] = []string{str(item["exerciseId"])}
				main = append(main, item)
			}
		}
		day["exercises"] = main
		break
	}
	if validatePlan(days, catalog, p) == nil {
		t.Fatal("unsafe plan accepted")
	}
}
func TestAnalyticsWithoutPandas(t *testing.T) {
	logs := []M{{"exercise_id": "a", "sets": 3, "reps": 10, "load_kg": 20, "completed_at": "2026-11-01T10:00:00Z"}, {"exercise_id": "a", "sets": 3, "reps": 10, "load_kg": 25, "completed_at": "2026-11-02T10:00:00Z"}, {"exercise_id": "b", "sets": 2, "reps": 5, "load_kg": 10, "completed_at": "2026-11-02T11:00:00Z"}}
	v := aggregateProgress(logs, []M{}, 3)
	if num(v["totalVolumeKg"]) != 1450 || num(v["personalRecords"]) != 3 || num(v["adherencePercent"]) != 17 {
		t.Fatalf("unexpected metrics: %#v", v)
	}
	weekly := objects(v["weeklyVolume"])
	if len(weekly) != 1 || num(weekly[0]["sessions"]) != 2 {
		t.Fatalf("invalid weekly grouping: %#v", weekly)
	}
}
