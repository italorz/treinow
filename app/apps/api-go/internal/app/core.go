package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/redis/go-redis/v9"
	"github.com/riverqueue/river"
	"golang.org/x/text/unicode/norm"
	"unicode"
)

type M = map[string]any

const CatalogVersion = "appdb-catalog-v2"
const PlanCatalogTag = ":appdb-v2"
const ActiveCatalogSQL = "is_active = true AND classification->>'source' = 'appdb-catalog-v2'"

type Config struct {
	Port, DatabaseURL, RedisURL, PublicURL, SessionSecret, CSRFSecret, Environment   string
	StorageEndpoint, StorageKey, StorageSecret, Bucket, DriveBucket, StorageProvider string
	PlanEngine, GeminiKey, GeminiModel, GeminiFallback                               string
	CatalogPath, GuidancePath, VideosPath                                            string
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func LoadConfig() (Config, error) {
	c := Config{Port: env("PORT", "3000"), DatabaseURL: strings.Replace(env("DATABASE_URL", ""), "postgresql+asyncpg://", "postgresql://", 1), RedisURL: env("REDIS_URL", ""), PublicURL: strings.TrimRight(env("PUBLIC_URL", "http://localhost:8080"), "/"), SessionSecret: env("SESSION_SECRET", ""), CSRFSecret: env("CSRF_SECRET", ""), Environment: env("NODE_ENV", "production"), StorageEndpoint: env("MINIO_ENDPOINT", "http://minio:9000"), StorageKey: env("MINIO_ACCESS_KEY", ""), StorageSecret: env("MINIO_SECRET_KEY", ""), Bucket: env("MINIO_BUCKET", "trainow"), DriveBucket: env("GDRIVE_BUCKET", "trainow"), StorageProvider: env("VIDEO_STORAGE_PROVIDER", "gdrive"), PlanEngine: env("PLAN_ENGINE", "rules"), GeminiKey: env("GEMINI_API_KEY", ""), GeminiModel: env("GEMINI_PLAN_MODEL", "gemini-3.1-pro-preview"), GeminiFallback: env("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash"), CatalogPath: env("CATALOG_PATH", "/app/catalog/exercises.json"), GuidancePath: env("GUIDANCE_PATH", "/app/catalog/guidance.json"), VideosPath: env("VIDEOS_PATH", "/app/videos")}
	if os.Getenv("CATALOG_PATH") == "" {
		c.CatalogPath = "/app/catalog/exercises.pt-BR.json"
	}
	if os.Getenv("GUIDANCE_PATH") == "" {
		c.GuidancePath = "/app/catalog/exercise-guidance.pt-BR.json"
	}
	if len(c.SessionSecret) < 32 || len(c.CSRFSecret) < 32 || c.DatabaseURL == "" || c.RedisURL == "" {
		return c, errors.New("database, redis and session secrets must be configured")
	}
	return c, nil
}

type App struct {
	Config       Config
	DB           *pgxpool.Pool
	Redis        *redis.Client
	Storage      *minio.Client
	Queue        *river.Client[pgx.Tx]
	Now          func() time.Time
	ProviderHTTP *http.Client
}

func Open(ctx context.Context, c Config) (*App, error) {
	pc, e := pgxpool.ParseConfig(c.DatabaseURL)
	if e != nil {
		return nil, e
	}
	pc.MaxConns = 8
	pc.MinConns = 0
	db, e := pgxpool.NewWithConfig(ctx, pc)
	if e != nil {
		return nil, e
	}
	if e = db.Ping(ctx); e != nil {
		db.Close()
		return nil, e
	}
	ro, e := redis.ParseURL(c.RedisURL)
	if e != nil {
		db.Close()
		return nil, e
	}
	rc := redis.NewClient(ro)
	if e = rc.Ping(ctx).Err(); e != nil {
		db.Close()
		rc.Close()
		return nil, e
	}
	endpoint, e := url.Parse(c.StorageEndpoint)
	if e != nil {
		db.Close()
		rc.Close()
		return nil, e
	}
	storage, e := minio.New(endpoint.Host, &minio.Options{Creds: credentials.NewStaticV4(c.StorageKey, c.StorageSecret, ""), Secure: endpoint.Scheme == "https", Region: "us-east-1", BucketLookup: minio.BucketLookupPath})
	if e != nil {
		db.Close()
		rc.Close()
		return nil, e
	}
	return &App{Config: c, DB: db, Redis: rc, Storage: storage, Now: time.Now}, nil
}
func (a *App) Close() { a.DB.Close(); _ = a.Redis.Close() }
func (a *App) EnsureStorage(ctx context.Context) error {
	if a.Config.StorageProvider == "gdrive" {
		return nil
	}
	exists, e := a.Storage.BucketExists(ctx, a.Config.Bucket)
	if e != nil {
		return e
	}
	if !exists {
		return a.Storage.MakeBucket(ctx, a.Config.Bucket, minio.MakeBucketOptions{Region: "us-east-1"})
	}
	return nil
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string          { return e.Message }
func fail(status int, message string) error { return &HTTPError{status, message} }

type Handler func(http.ResponseWriter, *http.Request) error

func (a *App) Handle(h Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if e := h(w, r); e != nil {
			var he *HTTPError
			if errors.As(e, &he) {
				writeJSON(w, he.Status, M{"error": he.Message})
				return
			}
			slog.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "error", e)
			writeJSON(w, 500, M{"error": "Falha interna"})
		}
	}
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func body(r *http.Request) (M, error) {
	var m M
	d := json.NewDecoder(r.Body)
	if e := d.Decode(&m); e != nil || m == nil {
		return nil, fail(400, "Dados inválidos")
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return nil, fail(400, "Dados inválidos")
	}
	return m, nil
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func one(ctx context.Context, q queryer, sql string, args ...any) (M, error) {
	var b []byte
	e := q.QueryRow(ctx, sql, args...).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var v M
	e = json.Unmarshal(b, &v)
	return v, e
}
func many(ctx context.Context, q queryer, sql string, args ...any) ([]M, error) {
	rows, e := q.Query(ctx, sql, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []M{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		var v M
		if e = json.Unmarshal(b, &v); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func str(v any) string { s, _ := v.(string); return s }
func num(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	}
	return 0
}
func obj(v any) M {
	m, _ := v.(map[string]any)
	if m == nil {
		return M{}
	}
	return m
}
func list(v any) []any {
	switch a := v.(type) {
	case []any:
		return a
	case []M:
		out := make([]any, len(a))
		for i := range a {
			out[i] = a[i]
		}
		return out
	case []string:
		out := make([]any, len(a))
		for i := range a {
			out[i] = a[i]
		}
		return out
	case []int:
		out := make([]any, len(a))
		for i := range a {
			out[i] = a[i]
		}
		return out
	}
	return []any{}
}
func objects(v any) []M {
	a := []M{}
	for _, x := range list(v) {
		a = append(a, obj(x))
	}
	return a
}
func stringsOf(v any) []string {
	if a, ok := v.([]string); ok {
		return a
	}
	a := []string{}
	for _, x := range list(v) {
		a = append(a, str(x))
	}
	return a
}
func intsOf(v any) []int {
	a := []int{}
	for _, x := range list(v) {
		a = append(a, int(num(x)))
	}
	return a
}
func truth(v any) bool      { b, _ := v.(bool); return b }
func validID(s string) bool { _, e := uuid.Parse(s); return e == nil }
func in(value string, values []string) bool {
	for _, s := range values {
		if s == value {
			return true
		}
	}
	return false
}
func normalized(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}
func jsonBytes(v any) []byte { b, _ := json.Marshal(v); return b }
func publicUser(v M) M {
	return M{"id": v["id"], "name": v["name"], "email": v["email"], "role": v["role"], "tenantId": v["tenant_id"]}
}
func (a *App) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.Handle(a.health))
	a.authRoutes(mux)
	a.exerciseRoutes(mux)
	a.workoutRoutes(mux)
	a.profileRoutes(mux)
	a.trainerRoutes(mux)
	a.jobRoutes(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(a.Config.PublicURL, "https://") {
			w.Header().Set("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
		}
		if r.ContentLength > 256*1024 {
			writeJSON(w, 413, M{"error": "Corpo da requisição excede o limite permitido"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
		defer func() {
			if v := recover(); v != nil {
				slog.Error("http panic", "error", fmt.Sprint(v))
				writeJSON(w, 500, M{"error": "Falha interna"})
			}
		}()
		mux.ServeHTTP(w, r)
	})
}
func (a *App) health(w http.ResponseWriter, r *http.Request) error {
	var active, retired int
	e := a.DB.QueryRow(r.Context(), "SELECT count(*) FILTER(WHERE "+ActiveCatalogSQL+"),count(*) FILTER(WHERE NOT is_active) FROM exercises").Scan(&active, &retired)
	if e != nil {
		return e
	}
	writeJSON(w, 200, M{"ok": true, "backend": "go", "catalog": M{"version": CatalogVersion, "activeExercises": active, "retiredExercises": retired}})
	return nil
}
