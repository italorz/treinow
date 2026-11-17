package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

type TaskArgs struct {
	Task      string `json:"task"`
	StudentID string `json:"student_id"`
	Payload   M      `json:"payload"`
	Nonce     string `json:"nonce"`
}

func (TaskArgs) Kind() string { return "trainow_task" }

type TaskWorker struct {
	river.WorkerDefaults[TaskArgs]
	App *App
}
type dailyRotation struct{}

func (dailyRotation) Next(now time.Time) time.Time {
	now = now.UTC()
	next := time.Date(now.Year(), now.Month(), now.Day(), 3, 15, 0, 0, time.UTC)
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

func (TaskWorker) Timeout(*river.Job[TaskArgs]) time.Duration { return 30 * time.Minute }
func (w *TaskWorker) Work(ctx context.Context, job *river.Job[TaskArgs]) error {
	var e error
	switch job.Args.Task {
	case "generate_workout":
		e = w.App.generateWorkout(ctx, job.Args.StudentID)
	case "refresh_analytics":
		e = w.App.refreshAnalytics(ctx, job.Args.StudentID)
	case "import_catalog":
		e = w.App.importCatalog(ctx)
	case "rotate_weekly_plans":
		e = w.App.rotatePlans(ctx)
	default:
		return river.JobCancel(fmt.Errorf("unknown task"))
	}
	return e
}
func (a *App) InitQueue(worker bool) error {
	config := &river.Config{}
	if worker {
		workers := river.NewWorkers()
		river.AddWorker(workers, &TaskWorker{App: a})
		config.Workers = workers
		config.Queues = map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 2}}
		config.PeriodicJobs = []*river.PeriodicJob{river.NewPeriodicJob(dailyRotation{}, func() (river.JobArgs, *river.InsertOpts) {
			return TaskArgs{Task: "rotate_weekly_plans", Payload: M{}, Nonce: time.Now().UTC().Format("2006010215")}, &river.InsertOpts{MaxAttempts: 3}
		}, &river.PeriodicJobOpts{})}
	}
	q, e := river.NewClient(riverpgxv5.New(a.DB), config)
	if e != nil {
		return e
	}
	a.Queue = q
	return nil
}
func (a *App) enqueueTx(ctx context.Context, tx pgx.Tx, task, student string, payload M) (string, error) {
	args := TaskArgs{Task: task, StudentID: student, Payload: payload, Nonce: uuid.NewString()}
	result, e := a.Queue.InsertTx(ctx, tx, args, &river.InsertOpts{MaxAttempts: 3})
	if e != nil {
		return "", e
	}
	return fmt.Sprintf("go:%d", result.Job.ID), nil
}
func (a *App) enqueue(ctx context.Context, task, student string, payload M) (string, error) {
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	id, e := a.enqueueTx(ctx, tx, task, student, payload)
	if e != nil {
		return "", e
	}
	return id, tx.Commit(ctx)
}
func (a *App) jobRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/jobs/{queue}/{id}", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		raw := r.PathValue("id")
		if !strings.HasPrefix(raw, "go:") {
			writeJSON(w, 200, M{"id": raw, "state": "not_found"})
			return nil
		}
		id, e := strconv.ParseInt(strings.TrimPrefix(raw, "go:"), 10, 64)
		if e != nil || id <= 0 {
			return fail(404, "Tarefa não encontrada")
		}
		job, e := one(r.Context(), a.DB, "SELECT to_jsonb(j) FROM river_job j WHERE id=$1 AND kind='trainow_task'", id)
		if e != nil {
			return e
		}
		if job == nil {
			return fail(404, "Tarefa não encontrada")
		}
		args := obj(job["args"])
		student := str(args["student_id"])
		if !validID(student) {
			return fail(404, "Tarefa não encontrada")
		}
		if e = a.access(r.Context(), u, student); e != nil {
			return fail(404, "Tarefa não encontrada")
		}
		state := str(job["state"])
		result := M{"id": raw}
		switch state {
		case "completed":
			result["state"] = "completed"
			result["result"] = M{"ok": true}
		case "cancelled", "discarded":
			result["state"] = "failed"
			result["failedReason"] = "Não foi possível concluir o plano. Revise sua meta e tente novamente."
		case "running":
			result["state"] = "in_progress"
		default:
			result["state"] = "queued"
		}
		writeJSON(w, 200, result)
		return nil
	}))
}
func (a *App) rotatePlans(ctx context.Context) error {
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(893762012)"); e != nil {
		return e
	}
	rows, e := many(ctx, tx, `SELECT jsonb_build_object('student',p.student_id) FROM workout_plans p WHERE p.active AND p.created_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM river_job j WHERE j.kind='trainow_task' AND j.args->>'task'='generate_workout' AND j.args->>'student_id'=p.student_id::text AND j.state IN ('available','running','retryable','scheduled','pending'))`)
	if e != nil {
		return e
	}
	seen := map[string]bool{}
	for _, row := range rows {
		id := str(row["student"])
		if !seen[id] {
			if _, e = a.enqueueTx(ctx, tx, "generate_workout", id, M{}); e != nil {
				return e
			}
			seen[id] = true
		}
	}
	return tx.Commit(ctx)
}
func (a *App) generateWorkout(ctx context.Context, student string) error {
	p, e := a.profile(ctx, student)
	if e != nil {
		return e
	}
	if p == nil {
		return river.JobCancel(fmt.Errorf("Meta não configurada"))
	}
	if e = validateInjuries(objects(p["injuries"])); e != nil {
		return river.JobCancel(e)
	}
	rows, e := many(ctx, a.DB, `SELECT to_jsonb(e)-'guidance'-'created_at'-'updated_at' FROM exercises e WHERE `+ActiveCatalogSQL+` AND NOT needs_review AND ($1='' OR video->'variants' ? $1) ORDER BY id`, profileSex(p))
	if e != nil {
		return e
	}
	catalog := []M{}
	for _, v := range rows {
		if injuryCompatible(v, objects(p["injuries"])) && allowedByInjury(v, objects(p["injuries"])) {
			catalog = append(catalog, v)
		}
	}
	if len(catalog) == 0 {
		return river.JobCancel(fmt.Errorf("Catálogo compatível vazio"))
	}
	logs, e := many(ctx, a.DB, "SELECT jsonb_build_object('id',exercise_id) FROM workout_logs WHERE student_id=$1 AND completed_at>=now()-interval '8 days'", student)
	if e != nil {
		return e
	}
	recent := map[string]bool{}
	for _, l := range logs {
		recent[str(l["id"])] = true
	}
	var days []M
	source := "rules-engine"
	if a.Config.PlanEngine == "gemini" && a.Config.GeminiKey != "" {
		days, source = a.geminiPlan(ctx, p, catalog, recent)
	}
	if days == nil {
		days, e = rulesPlan(p, catalog, recent)
		source = "rules-engine"
	}
	if e != nil {
		return river.JobCancel(e)
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	current, e := one(ctx, tx, "SELECT to_jsonb(p) FROM profiles p WHERE student_id=$1 FOR UPDATE", student)
	if e != nil {
		return e
	}
	if current == nil || str(current["updated_at"]) != str(p["updated_at"]) {
		return river.JobCancel(fmt.Errorf("A meta foi alterada durante a geração. Aguarde o plano mais recente."))
	}
	if _, e = tx.Exec(ctx, "UPDATE workout_plans SET active=false WHERE student_id=$1 AND active", student); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO workout_plans(id,student_id,version,active,source,days) SELECT $1,$2,COALESCE(max(version),0)+1,true,$3,$4 FROM workout_plans WHERE student_id=$2`, uuid.NewString(), student, truncate(source, 23)+PlanCatalogTag, jsonBytes(days))
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}

func (a *App) PendingLegacy(ctx context.Context) (int64, error) {
	return a.Redis.ZCard(ctx, "arq:queue").Result()
}
func (a *App) ImportOnStart(ctx context.Context) error {
	_, e := a.enqueue(ctx, "import_catalog", "", M{})
	return e
}
func decodeJSON(data []byte) (M, error) { var m M; e := json.Unmarshal(data, &m); return m, e }
