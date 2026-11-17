package app

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"time"
	_ "time/tzdata"

	"github.com/google/uuid"
)

var brazil = func() *time.Location {
	z, e := time.LoadLocation("America/Sao_Paulo")
	if e != nil {
		panic(e)
	}
	return z
}()

func (a *App) localNow() time.Time { return a.Now().In(brazil) }
func phaseOrder(s string) int {
	switch s {
	case "aquecimento":
		return 0
	case "alongamento":
		return 1
	case "principal":
		return 2
	}
	return 99
}
func (a *App) currentPlan(ctx context.Context, q queryer, student string) (M, error) {
	return one(ctx, q, `SELECT to_jsonb(p) FROM workout_plans p WHERE student_id=$1 AND active AND right(source,9)=':appdb-v2' ORDER BY version DESC LIMIT 1`, student)
}
func (a *App) resolveDay(ctx context.Context, q queryer, student string, weekday int) (M, error) {
	plan, e := a.currentPlan(ctx, q, student)
	if e != nil || plan == nil {
		return nil, e
	}
	var day M
	for _, v := range objects(plan["days"]) {
		if int(num(v["weekday"])) == weekday {
			day = v
			break
		}
	}
	if day == nil {
		return nil, nil
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, slot := range objects(day["exercises"]) {
		all := append([]string{str(slot["exerciseId"])}, stringsOf(slot["reserveExerciseIds"])...)
		for _, id := range all {
			if !validID(id) {
				return nil, nil
			}
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	byID := map[string]M{}
	if len(ids) > 0 {
		rows, err := many(ctx, q, "SELECT to_jsonb(e) FROM exercises e WHERE id::text=ANY($1::text[]) AND "+ActiveCatalogSQL, ids)
		if err != nil {
			return nil, err
		}
		for _, v := range rows {
			byID[str(v["id"])] = v
		}
		if len(byID) != len(ids) {
			return nil, nil
		}
	}
	recent, e := many(ctx, q, `SELECT jsonb_build_object('id',exercise_id) FROM workout_logs WHERE student_id=$1 AND completed_at>=now()-interval '8 days'`, student)
	if e != nil {
		return nil, e
	}
	familiar := map[string]bool{}
	for _, v := range recent {
		familiar[str(v["id"])] = true
	}
	slots := objects(day["exercises"])
	sort.SliceStable(slots, func(i, j int) bool { return phaseOrder(str(slots[i]["phase"])) < phaseOrder(str(slots[j]["phase"])) })
	out := []M{}
	for _, slot := range slots {
		id := str(slot["exerciseId"])
		ex := byID[id]
		slot["id"] = id
		slot["name"] = ex["name"]
		slot["equipment"] = ex["equipment"]
		slot["musclePrimary"] = ex["muscle_primary"]
		slot["targetKey"] = ex["target_key"]
		slot["guidance"] = guidance(ex)
		slot["executionGuide"] = executionGuide(ex)
		slot["warmup"] = str(slot["phase"]) == "aquecimento" || truth(slot["warmup"])
		reserves := []M{}
		for _, rid := range stringsOf(slot["reserveExerciseIds"]) {
			v := byID[rid]
			reserves = append(reserves, M{"id": rid, "name": v["name"], "equipment": v["equipment"], "guidance": guidance(v), "executionGuide": executionGuide(v), "familiar": familiar[rid]})
		}
		slot["reserves"] = reserves
		out = append(out, slot)
	}
	day["exercises"] = out
	return day, nil
}
func sessionShape(v M) M {
	if v == nil {
		return nil
	}
	return M{"id": v["id"], "status": v["status"], "selections": obj(v["selections"]), "startedAt": v["started_at"], "finishedAt": v["finished_at"]}
}
func (a *App) student(r *http.Request, u Session) (string, error) {
	id := u.ID
	if u.Role != "student" {
		id = r.URL.Query().Get("studentId")
	}
	return id, a.access(r.Context(), u, id)
}
func (a *App) workoutRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/workouts/calendar", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		id, e := a.student(r, u)
		if e != nil {
			return e
		}
		p, e := a.currentPlan(r.Context(), a.DB, id)
		if e != nil {
			return e
		}
		var plan any
		if p != nil {
			plan = M{"days": p["days"]}
		}
		writeJSON(w, 200, M{"plan": plan})
		return nil
	}))
	mux.HandleFunc("GET /v1/workouts/today", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		id, e := a.student(r, u)
		if e != nil {
			return e
		}
		d, e := a.resolveDay(r.Context(), a.DB, id, int(a.localNow().Weekday()))
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"day": d})
		return nil
	}))
	mux.HandleFunc("GET /v1/workouts/day/{weekday}", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		id, e := a.student(r, u)
		if e != nil {
			return e
		}
		weekday, e := strconv.Atoi(r.PathValue("weekday"))
		if e != nil || weekday < 0 || weekday > 6 {
			return fail(400, "Dia inválido")
		}
		d, e := a.resolveDay(r.Context(), a.DB, id, weekday)
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"day": d})
		return nil
	}))
	mux.HandleFunc("POST /v1/workouts/sessions/start", a.protected(a.startSession))
	mux.HandleFunc("GET /v1/workouts/sessions/today", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		if u.Role != "student" {
			return fail(403, "Somente o aluno")
		}
		v, e := one(r.Context(), a.DB, "SELECT to_jsonb(s) FROM workout_sessions s WHERE student_id=$1 AND workout_date=$2::date", u.ID, a.localNow().Format(time.DateOnly))
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"session": sessionShape(v)})
		return nil
	}))
	mux.HandleFunc("PATCH /v1/workouts/sessions/{id}/selection", a.protected(a.selectExercise))
	mux.HandleFunc("POST /v1/workouts/sessions/{id}/finish", a.protected(a.finishSession))
	mux.HandleFunc("POST /v1/workouts/logs", a.protected(a.createLog))
	mux.HandleFunc("POST /v1/measurements", a.protected(a.measure))
}
func (a *App) startSession(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "student" {
		return fail(403, "Somente o aluno inicia o treino")
	}
	date := a.localNow().Format(time.DateOnly)
	_, e := a.DB.Exec(r.Context(), `INSERT INTO workout_sessions(id,student_id,workout_date,selections,status,missing_exercise_ids) VALUES($1,$2,$3::date,'{}','active','{}') ON CONFLICT(student_id,workout_date) DO NOTHING`, uuid.NewString(), u.ID, date)
	if e != nil {
		return e
	}
	v, e := one(r.Context(), a.DB, "SELECT to_jsonb(s) FROM workout_sessions s WHERE student_id=$1 AND workout_date=$2::date", u.ID, date)
	if e != nil {
		return e
	}
	writeJSON(w, 200, M{"session": sessionShape(v)})
	return nil
}
func allowedSelection(slot M, id string) bool {
	return id == str(slot["id"]) || in(id, stringsOf(slot["reserveExerciseIds"]))
}
func (a *App) selectExercise(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "student" {
		return fail(403, "Somente o aluno")
	}
	b, e := body(r)
	if e != nil {
		return e
	}
	sid, slotID, selected := r.PathValue("id"), str(b["slotExerciseId"]), str(b["selectedExerciseId"])
	if !validID(sid) || !validID(slotID) || (selected != "" && !validID(selected)) {
		return fail(400, "Seleção inválida")
	}
	day, e := a.resolveDay(r.Context(), a.DB, u.ID, int(a.localNow().Weekday()))
	if e != nil {
		return e
	}
	var slot M
	for _, v := range objects(day["exercises"]) {
		if str(v["id"]) == slotID {
			slot = v
			break
		}
	}
	if slot == nil || (selected != "" && !allowedSelection(slot, selected)) {
		return fail(400, "O exercício selecionado não pertence a este bloco")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	v, e := one(r.Context(), tx, "SELECT to_jsonb(s) FROM workout_sessions s WHERE id=$1 AND student_id=$2 AND status='active' AND workout_date=$3::date FOR UPDATE", sid, u.ID, a.localNow().Format(time.DateOnly))
	if e != nil {
		return e
	}
	if v == nil {
		return fail(404, "Treino ativo não encontrado")
	}
	selections := obj(v["selections"])
	if selected == "" {
		delete(selections, slotID)
	} else {
		selections[slotID] = selected
	}
	if _, e = tx.Exec(r.Context(), "UPDATE workout_sessions SET selections=$1,updated_at=now() WHERE id=$2", jsonBytes(selections), sid); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	v["selections"] = selections
	writeJSON(w, 200, M{"session": sessionShape(v)})
	return nil
}
func (a *App) finishSession(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "student" {
		return fail(403, "Somente o aluno")
	}
	b, e := body(r)
	if e != nil {
		return e
	}
	sid := r.PathValue("id")
	if !validID(sid) {
		return fail(404, "Treino ativo não encontrado")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	session, e := one(r.Context(), tx, "SELECT to_jsonb(s) FROM workout_sessions s WHERE id=$1 AND student_id=$2 AND status='active' AND workout_date=$3::date FOR UPDATE", sid, u.ID, a.localNow().Format(time.DateOnly))
	if e != nil {
		return e
	}
	if session == nil {
		return fail(404, "Treino ativo não encontrado")
	}
	day, e := a.resolveDay(r.Context(), tx, u.ID, int(a.localNow().Weekday()))
	if e != nil {
		return e
	}
	if day == nil {
		return fail(409, "O plano foi alterado. Atualize o treino antes de finalizar.")
	}
	valid := M{}
	missing := []string{}
	for _, slot := range objects(day["exercises"]) {
		id := str(slot["id"])
		selected := str(obj(session["selections"])[id])
		if selected != "" && allowedSelection(slot, selected) {
			valid[id] = selected
		} else {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 && !truth(b["confirmIncomplete"]) {
		writeJSON(w, 200, M{"requiresConfirmation": true, "missingCount": len(missing)})
		return nil
	}
	for _, id := range valid {
		if _, e = tx.Exec(r.Context(), `INSERT INTO workout_logs(id,student_id,exercise_id,session_id,sets,reps,load_kg,completed_at) VALUES($1,$2,$3,$4,1,1,0,now())`, uuid.NewString(), u.ID, str(id), sid); e != nil {
			return e
		}
	}
	if _, e = tx.Exec(r.Context(), "UPDATE workout_sessions SET status='finished',comment=$1,missing_exercise_ids=$2,finished_at=now(),updated_at=now() WHERE id=$3", truncate(str(b["comment"]), 1000), missing, sid); e != nil {
		return e
	}
	if _, e = a.enqueueTx(r.Context(), tx, "refresh_analytics", u.ID, M{}); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	writeJSON(w, 200, M{"finished": true})
	return nil
}
func (a *App) createLog(w http.ResponseWriter, r *http.Request, u Session) error {
	b, e := body(r)
	if e != nil {
		return e
	}
	id := u.ID
	if u.Role != "student" {
		id = str(b["studentId"])
	}
	if e = a.access(r.Context(), u, id); e != nil {
		return e
	}
	exercise, e := a.exercise(r, str(b["exerciseId"]))
	if e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), `INSERT INTO workout_logs(id,student_id,exercise_id,sets,reps,load_kg,completed_at) VALUES($1,$2,$3,$4,$5,$6,now())`, uuid.NewString(), id, str(exercise["id"]), max(1, min(20, int(num(b["sets"])))), max(1, min(100, int(num(b["reps"])))), max(0, min(1000, num(b["loadKg"]))))
	if e != nil {
		return e
	}
	if _, e = a.enqueueTx(r.Context(), tx, "refresh_analytics", id, M{}); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	writeJSON(w, 200, M{"ok": true})
	return nil
}
func (a *App) measure(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "student" {
		return fail(403, "Somente o aluno registra medidas")
	}
	b, e := body(r)
	if e != nil {
		return e
	}
	height, weight := num(b["heightCm"]), num(b["weightKg"])
	if height < 120 || height > 230 || weight < 30 || weight > 300 {
		return fail(400, "Peso ou altura inválidos")
	}
	var waist any
	if b["waistCm"] != nil {
		n := num(b["waistCm"])
		if n < 20 || n > 300 {
			return fail(400, "Medida de cintura inválida")
		}
		waist = n
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), `INSERT INTO measurements(id,student_id,measured_at,weight_kg,height_cm,bmi,waist_cm) VALUES($1,$2,now(),$3,$4,$5,$6)`, uuid.NewString(), u.ID, weight, int(height), round1(weight/((height/100)*(height/100))), waist)
	if e != nil {
		return e
	}
	if _, e = a.enqueueTx(r.Context(), tx, "refresh_analytics", u.ID, M{}); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	writeJSON(w, 200, M{"ok": true})
	return nil
}
