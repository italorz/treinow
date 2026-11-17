package app

import (
	"context"
	"crypto/sha256"
	"fmt"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

var profileFields = map[string]string{"goal": "goal", "level": "level", "trainingDays": "training_days", "durationMinutes": "duration_minutes", "location": "location", "equipment": "equipment", "weightKg": "weight_kg", "heightCm": "height_cm", "age": "age", "sex": "sex", "priorityMuscles": "priority_muscles", "intensity": "intensity", "injuries": "injuries", "bmi": "bmi"}

func publicProfile(p M) M {
	if p == nil {
		return nil
	}
	m := M{}
	for api, db := range profileFields {
		m[api] = p[db]
	}
	return m
}
func (a *App) profile(ctx context.Context, id string) (M, error) {
	return one(ctx, a.DB, "SELECT to_jsonb(p) FROM profiles p WHERE student_id=$1", id)
}
func validateProfile(b M) error {
	for _, key := range []string{"trainingDays", "equipment", "priorityMuscles", "injuries"} {
		switch b[key].(type) {
		case []any, []int, []string, []M:
		default:
			return fail(422, "Revise os campos da meta.")
		}
	}
	enums := map[string][]string{"goal": {"mais_disposto", "mais_bonito", "mais_forte", "mais_leve", "mais_saudavel", "menos_estressado"}, "level": {"iniciante", "intermediario", "avancado"}, "sex": {"feminino", "masculino", "nao_informar"}, "intensity": {"leve", "moderada", "intensa"}, "durationMinutes": {"30", "45", "60", "75", "90"}, "location": {"academia", "casa", "ambos"}}
	for k, allowed := range enums {
		if !in(str(b[k]), allowed) {
			return fail(422, "Revise os campos da meta.")
		}
	}
	for k, bounds := range map[string][2]float64{"weightKg": {30, 300}, "heightCm": {120, 230}, "age": {14, 100}} {
		v := num(b[k])
		if math.IsNaN(v) || math.IsInf(v, 0) || v < bounds[0] || v > bounds[1] || (k != "weightKg" && v != math.Trunc(v)) {
			return fail(422, "Revise peso, altura e idade.")
		}
	}
	days := list(b["trainingDays"])
	if len(days) < 1 || len(days) > 7 {
		return fail(422, "Informe os dias de treino.")
	}
	seen := map[int]bool{}
	for _, d := range days {
		switch d.(type) {
		case float64, int:
		default:
			return fail(422, "Dias de treino inválidos.")
		}
		v := num(d)
		if v < 0 || v > 6 || v != math.Trunc(v) || seen[int(v)] {
			return fail(422, "Dias de treino inválidos.")
		}
		seen[int(v)] = true
	}
	equipment := stringsOf(b["equipment"])
	if len(equipment) < 1 || len(equipment) > 12 {
		return fail(422, "Informe os equipamentos.")
	}
	for _, v := range equipment {
		if !in(v, []string{"peso_corporal", "halter", "anilha", "barra", "cabo", "maquina", "smith", "kettlebell", "elastico", "banco", "bola", "outro"}) {
			return fail(422, "Equipamento inválido.")
		}
	}
	priorities := stringsOf(b["priorityMuscles"])
	if len(priorities) > 3 {
		return fail(422, "Escolha até três músculos prioritários.")
	}
	for _, v := range priorities {
		if !in(v, []string{"core", "peitoral", "costas", "ombro", "biceps", "triceps", "antebraco", "trapezio", "gluteos", "pernas", "panturrilha"}) {
			return fail(422, "Músculo inválido.")
		}
	}
	injuries := objects(b["injuries"])
	if len(injuries) > 8 {
		return fail(422, "Lesões inválidas.")
	}
	regions := map[string]bool{}
	for _, i := range injuries {
		region := str(i["region"])
		if !in(region, []string{"ombro", "cotovelo", "punho", "coluna_cervical", "coluna_lombar", "quadril", "joelho", "tornozelo"}) || !in(str(i["severity"]), []string{"leve", "moderada", "grave"}) || !in(str(i["status"]), []string{"recuperacao", "cronica", "dor_aguda"}) || regions[region] {
			return fail(422, "Revise as informações das lesões.")
		}
		if _, ok := i["medicallyCleared"].(bool); !ok {
			return fail(422, "Informe a liberação profissional.")
		}
		regions[region] = true
	}
	return nil
}
func round1(n float64) float64 { return math.Floor(n*10+.5) / 10 }
func (a *App) profileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/meta", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		if u.Role != "student" {
			return fail(403, "Disponível para alunos")
		}
		p, e := a.profile(r.Context(), u.ID)
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"meta": publicProfile(p)})
		return nil
	}))
	mux.HandleFunc("PUT /v1/meta", a.protected(a.putProfile))
}
func (a *App) putProfile(w http.ResponseWriter, r *http.Request, u Session) error {
	b, e := body(r)
	if e != nil {
		return e
	}
	student := u.ID
	if u.Role != "student" {
		student = str(b["studentId"])
		b = obj(b["meta"])
	}
	if e = a.access(r.Context(), u, student); e != nil {
		return e
	}
	if e = validateProfile(b); e != nil {
		return e
	}
	bmi := round1(num(b["weightKg"]) / math.Pow(num(b["heightCm"])/100, 2))
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), `INSERT INTO profiles(id,student_id,goal,level,training_days,duration_minutes,location,equipment,weight_kg,height_cm,age,sex,priority_muscles,intensity,injuries,bmi) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(student_id) DO UPDATE SET goal=EXCLUDED.goal,level=EXCLUDED.level,training_days=EXCLUDED.training_days,duration_minutes=EXCLUDED.duration_minutes,location=EXCLUDED.location,equipment=EXCLUDED.equipment,weight_kg=EXCLUDED.weight_kg,height_cm=EXCLUDED.height_cm,age=EXCLUDED.age,sex=EXCLUDED.sex,priority_muscles=EXCLUDED.priority_muscles,intensity=EXCLUDED.intensity,injuries=EXCLUDED.injuries,bmi=EXCLUDED.bmi,updated_at=now()`, uuid.NewString(), student, str(b["goal"]), str(b["level"]), intsOf(b["trainingDays"]), int(num(b["durationMinutes"])), str(b["location"]), stringsOf(b["equipment"]), num(b["weightKg"]), int(num(b["heightCm"])), int(num(b["age"])), str(b["sex"]), stringsOf(b["priorityMuscles"]), str(b["intensity"]), jsonBytes(list(b["injuries"])), bmi)
	if e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE workout_plans SET active=false WHERE student_id=$1 AND active", student); e != nil {
		return e
	}
	blocked := validateInjuries(objects(b["injuries"]))
	var id string
	if blocked == nil {
		id, e = a.enqueueTx(r.Context(), tx, "generate_workout", student, M{})
		if e != nil {
			return e
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	if blocked != nil {
		writeJSON(w, 200, M{"bmi": bmi, "jobId": nil, "generationBlocked": blocked.Error()})
	} else {
		writeJSON(w, 200, M{"bmi": bmi, "jobId": id})
	}
	return nil
}
func tokenHash(s string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(s))) }
func (a *App) trainerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/trainer/invitations", a.protected(a.invite))
	mux.HandleFunc("POST /v1/invitations/{token}/accept", a.protected(a.acceptInvite))
	mux.HandleFunc("POST /v1/memberships/{id}/revoke", a.protected(a.revokeMembership))
	mux.HandleFunc("GET /v1/memberships", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		if u.Role != "student" {
			return fail(403, "Somente o aluno")
		}
		rows, e := many(r.Context(), a.DB, `SELECT jsonb_build_object('id',m.id,'tenantName',t.name) FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.student_id=$1 AND m.status='active' ORDER BY m.created_at`, u.ID)
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"memberships": rows})
		return nil
	}))
	mux.HandleFunc("GET /v1/trainer/students", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		if u.Role != "trainer" || !validID(u.TenantID) {
			return fail(403, "Somente personal")
		}
		rows, e := many(r.Context(), a.DB, `SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email) FROM users u JOIN memberships m ON m.student_id=u.id WHERE m.tenant_id=$1 AND m.status='active' AND EXISTS(SELECT 1 FROM consents c WHERE c.membership_id=m.id AND c.revoked_at IS NULL) ORDER BY u.name`, u.TenantID)
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"students": rows})
		return nil
	}))
	mux.HandleFunc("GET /v1/trainer/students/{id}/progress", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		student := r.PathValue("id")
		if e := a.access(r.Context(), u, student); e != nil {
			return e
		}
		v, e := one(r.Context(), a.DB, `SELECT jsonb_build_object('adherencePercent',adherence_percent,'totalVolumeKg',total_volume_kg,'personalRecords',personal_records,'weeklyVolume',weekly_volume,'weightTrend',weight_trend,'bmiTrend',bmi_trend,'generatedAt',generated_at) FROM analytics_snapshots WHERE student_id=$1`, student)
		if e != nil {
			return e
		}
		writeJSON(w, 200, M{"snapshot": v})
		return nil
	}))
}
func (a *App) invite(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "trainer" || !validID(u.TenantID) {
		return fail(403, "Somente personal")
	}
	b, e := body(r)
	if e != nil {
		return e
	}
	email := strings.ToLower(strings.TrimSpace(str(b["email"])))
	if !validEmail(email) {
		return fail(400, "E-mail inválido")
	}
	token := randomToken(32)
	_, e = a.DB.Exec(r.Context(), `INSERT INTO invitations(id,tenant_id,email,token_hash,status,expires_at,created_by) VALUES($1,$2,$3,$4,'pending',now()+interval '7 days',$5)`, uuid.NewString(), u.TenantID, email, tokenHash(token), u.ID)
	if e != nil {
		return e
	}
	result := M{"ok": true}
	if a.Config.Environment == "development" {
		result["inviteUrl"] = a.Config.PublicURL + "/convite/" + token
	}
	writeJSON(w, 200, result)
	return nil
}
func (a *App) acceptInvite(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "student" {
		return fail(403, "Convite destinado a aluno")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	inv, e := one(r.Context(), tx, `SELECT to_jsonb(i) FROM invitations i WHERE token_hash=$1 AND status='pending' AND expires_at>now() FOR UPDATE`, tokenHash(r.PathValue("token")))
	if e != nil {
		return e
	}
	if inv == nil {
		return fail(404, "Convite inválido ou expirado")
	}
	var email string
	if e = tx.QueryRow(r.Context(), "SELECT email FROM users WHERE id=$1", u.ID).Scan(&email); e != nil {
		return e
	}
	if !strings.EqualFold(email, str(inv["email"])) {
		return fail(403, "O convite pertence a outro e-mail")
	}
	var membership string
	e = tx.QueryRow(r.Context(), `INSERT INTO memberships(id,tenant_id,student_id,status) VALUES($1,$2,$3,'active') ON CONFLICT(tenant_id,student_id) DO UPDATE SET status='active',updated_at=now() RETURNING id::text`, uuid.NewString(), str(inv["tenant_id"]), u.ID).Scan(&membership)
	if e != nil {
		return e
	}
	_, e = tx.Exec(r.Context(), `INSERT INTO consents(id,membership_id,version,scopes,document_hash) VALUES($1,$2,'1.0',ARRAY['progress','meta','workouts'],$3)`, uuid.NewString(), membership, tokenHash("consent-v1-full-access"))
	if e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE invitations SET status='accepted',accepted_at=now() WHERE id=$1", str(inv["id"])); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	writeJSON(w, 200, M{"ok": true})
	return nil
}
func (a *App) revokeMembership(w http.ResponseWriter, r *http.Request, u Session) error {
	if u.Role != "student" {
		return fail(403, "Somente o aluno revoga")
	}
	id := r.PathValue("id")
	if !validID(id) {
		return fail(404, "Vínculo não encontrado")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), "UPDATE memberships SET status='revoked',updated_at=now() WHERE id=$1 AND student_id=$2", id, u.ID)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return fail(404, "Vínculo não encontrado")
	}
	if _, e = tx.Exec(r.Context(), "UPDATE consents SET revoked_at=now() WHERE membership_id=$1 AND revoked_at IS NULL", id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	writeJSON(w, 200, M{"ok": true})
	return nil
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
