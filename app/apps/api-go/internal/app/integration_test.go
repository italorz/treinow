package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

func TestIntegrationIsolated(t *testing.T) {
	dbURL, redisURL := os.Getenv("TRAINOW_TEST_DATABASE_URL"), os.Getenv("TRAINOW_TEST_REDIS_URL")
	if dbURL == "" || redisURL == "" {
		t.Skip("isolated database and redis not configured")
	}
	parsed, e := url.Parse(dbURL)
	if e != nil || parsed.Path != "/trainow_migration_test" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("refusing non-isolated database")
	}
	ctx := context.Background()
	config := Config{DatabaseURL: dbURL, RedisURL: redisURL, PublicURL: "http://localhost", SessionSecret: strings.Repeat("s", 32), CSRFSecret: strings.Repeat("c", 32), Environment: "development", StorageEndpoint: "http://127.0.0.1:1", StorageProvider: "gdrive", Bucket: "test", DriveBucket: "test", PlanEngine: "rules", CatalogPath: filepath.Join("..", "..", "..", "..", "catalog", "exercises.pt-BR.json"), GuidancePath: filepath.Join("..", "..", "..", "..", "catalog", "exercise-guidance.pt-BR.json")}
	a, e := Open(ctx, config)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if e = a.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = a.InitQueue(false); e != nil {
		t.Fatal(e)
	}
	if _, e = a.DB.Exec(ctx, `TRUNCATE river_job,analytics_snapshots,consents,invitations,memberships,measurements,workout_logs,workout_sessions,workout_plans,profiles,exercises,tenants,users CASCADE`); e != nil {
		t.Fatal(e)
	}
	if e = a.Redis.FlushDB(ctx).Err(); e != nil {
		t.Fatal(e)
	}
	if e = a.importCatalog(ctx); e != nil {
		t.Fatal(e)
	}
	var exerciseID string
	if e = a.DB.QueryRow(ctx, "SELECT id::text FROM exercises WHERE "+ActiveCatalogSQL+" ORDER BY id LIMIT 1").Scan(&exerciseID); e != nil {
		t.Fatal(e)
	}
	if e = a.importCatalog(ctx); e != nil {
		t.Fatal(e)
	}
	var stillExists bool
	if e = a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM exercises WHERE id=$1)", exerciseID).Scan(&stillExists); e != nil || !stillExists {
		t.Fatal("catalog import changed existing IDs")
	}
	server := httptest.NewServer(a.Router())
	defer server.Close()
	a.Config.PublicURL = server.URL
	newClient := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		return &http.Client{Jar: jar, Timeout: 15 * time.Second}
	}
	student, other, trainer := newClient(), newClient(), newClient()
	request := func(c *http.Client, method, path string, payload any) (int, M) {
		t.Helper()
		var reader io.Reader
		if payload != nil {
			reader = bytes.NewReader(jsonBytes(payload))
		}
		req, e := http.NewRequest(method, server.URL+path, reader)
		if e != nil {
			t.Fatal(e)
		}
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		target, _ := url.Parse(server.URL)
		for _, cookie := range c.Jar.Cookies(target) {
			if cookie.Name == "tw_csrf" {
				token, _, _ := strings.Cut(cookie.Value, ".")
				req.Header.Set("X-CSRF-Token", token)
			}
		}
		response, e := c.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		var value M
		if e = json.NewDecoder(response.Body).Decode(&value); e != nil {
			t.Fatalf("%s %s: %v", method, path, e)
		}
		return response.StatusCode, value
	}
	register := func(c *http.Client, email, role string) string {
		t.Helper()
		status, v := request(c, "POST", "/v1/auth/register", M{"name": "Migration Test", "email": email, "password": "migration-test-password", "role": role})
		if status != 201 {
			t.Fatalf("register %d %#v", status, v)
		}
		return str(obj(v["user"])["id"])
	}
	studentID := register(student, "student@migration.test", "student")
	otherID := register(other, "other@migration.test", "student")
	register(trainer, "trainer@migration.test", "trainer")
	if status, _ := request(newClient(), "GET", "/v1/meta", nil); status != 401 {
		t.Fatalf("anonymous access: %d", status)
	}
	if status, _ := request(student, "GET", "/v1/trainer/students/"+otherID+"/progress", nil); status != 403 {
		t.Fatal("student isolation failed")
	}
	legacyID := randomToken(32)
	if e = a.Redis.Set(ctx, "session:"+legacyID, `{"id":"`+studentID+`","role":"student","tenant_id":null}`, time.Hour).Err(); e != nil {
		t.Fatal(e)
	}
	legacy := newClient()
	target, _ := url.Parse(server.URL)
	legacy.Jar.SetCookies(target, []*http.Cookie{{Name: "tw_session", Value: legacyID + "." + sign(legacyID, a.Config.SessionSecret), Path: "/"}})
	if status, _ := request(legacy, "GET", "/v1/auth/me", nil); status != 200 {
		t.Fatal("legacy Python session failed")
	}
	status, invite := request(trainer, "POST", "/v1/trainer/invitations", M{"email": "student@migration.test"})
	if status != 200 {
		t.Fatalf("invite: %#v", invite)
	}
	inviteURL, _ := url.Parse(str(invite["inviteUrl"]))
	token := filepath.Base(inviteURL.Path)
	if status, _ = request(other, "POST", "/v1/invitations/"+token+"/accept", M{}); status != 403 {
		t.Fatal("invitation email binding failed")
	}
	if status, _ = request(student, "POST", "/v1/invitations/"+token+"/accept", M{}); status != 200 {
		t.Fatalf("accept: %d", status)
	}
	profile := M{"goal": "mais_forte", "level": "iniciante", "trainingDays": []int{int(a.localNow().Weekday())}, "durationMinutes": "45", "location": "academia", "equipment": []string{"peso_corporal", "halter", "maquina", "cabo", "elastico"}, "weightKg": 70, "heightCm": 170, "age": 30, "sex": "masculino", "priorityMuscles": []string{"ombro"}, "intensity": "moderada", "injuries": []M{}}
	status, saved := request(student, "PUT", "/v1/meta", profile)
	if status != 200 {
		t.Fatalf("profile: %d %#v", status, saved)
	}
	jobID := str(saved["jobId"])
	if jobID == "" {
		t.Fatal("missing background job")
	}
	if status, _ = request(other, "GET", "/v1/jobs/workout/"+jobID, nil); status != 404 {
		t.Fatal("job ownership leak")
	}
	if e = a.InitQueue(true); e != nil {
		t.Fatal(e)
	}
	if e = a.Queue.Start(ctx); e != nil {
		t.Fatal(e)
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if e := a.Queue.Stop(shutdown); e != nil {
			t.Error(e)
		}
	}()
	deadline := time.Now().Add(30 * time.Second)
	for {
		status, v := request(student, "GET", "/v1/jobs/workout/"+jobID, nil)
		if status != 200 {
			t.Fatalf("poll: %d %#v", status, v)
		}
		if str(v["state"]) == "completed" {
			break
		}
		if str(v["state"]) == "failed" || time.Now().After(deadline) {
			t.Fatalf("generation: %#v", v)
		}
		time.Sleep(100 * time.Millisecond)
	}
	status, today := request(student, "GET", "/v1/workouts/today", nil)
	if status != 200 || len(objects(obj(today["day"])["exercises"])) < 6 {
		t.Fatalf("today: %d %#v", status, today)
	}
	slots := objects(obj(today["day"])["exercises"])
	status, started := request(student, "POST", "/v1/workouts/sessions/start", M{})
	if status != 200 {
		t.Fatal(started)
	}
	sessionID := str(obj(started["session"])["id"])
	slot := slots[0]
	if status, _ = request(student, "PATCH", "/v1/workouts/sessions/"+sessionID+"/selection", M{"slotExerciseId": slot["id"], "selectedExerciseId": uuid.NewString()}); status != 400 {
		t.Fatal("unrelated exercise accepted")
	}
	if status, _ = request(other, "PATCH", "/v1/workouts/sessions/"+sessionID+"/selection", M{"slotExerciseId": slot["id"], "selectedExerciseId": slot["id"]}); status == 200 {
		t.Fatal("cross student session access")
	}
	if status, _ = request(student, "PATCH", "/v1/workouts/sessions/"+sessionID+"/selection", M{"slotExerciseId": slot["id"], "selectedExerciseId": slot["id"]}); status != 200 {
		t.Fatalf("selection failed %d", status)
	}
	status, finish := request(student, "POST", "/v1/workouts/sessions/"+sessionID+"/finish", M{})
	if status != 200 || !truth(finish["requiresConfirmation"]) {
		t.Fatalf("missing exercises not confirmed: %#v", finish)
	}
	if status, _ = request(student, "POST", "/v1/workouts/sessions/"+sessionID+"/finish", M{"confirmIncomplete": true}); status != 200 {
		t.Fatal("finish failed")
	}
	if status, _ = request(student, "POST", "/v1/workouts/sessions/"+sessionID+"/finish", M{"confirmIncomplete": true}); status != 404 {
		t.Fatal("duplicate finish accepted")
	}
	if status, _ = request(student, "POST", "/v1/measurements", M{"weightKg": 70, "heightCm": 170}); status != 200 {
		t.Fatal("measurement failed")
	}
	if status, _ = request(trainer, "GET", "/v1/trainer/students/"+studentID+"/progress", nil); status != 200 {
		t.Fatal("consented trainer access failed")
	}
	if status, v := request(student, "GET", "/v1/exercises?limit=3&type=Strength&search=halter", nil); status != 200 || len(objects(v["items"])) == 0 {
		t.Fatalf("catalog search %d %#v", status, v)
	}
	status, firstPage := request(student, "GET", "/v1/exercises?limit=3", nil)
	if status != 200 || len(objects(firstPage["items"])) != 3 || str(firstPage["nextCursor"]) == "" {
		t.Fatal("catalog pagination missing")
	}
	firstIDs := map[string]bool{}
	for _, item := range objects(firstPage["items"]) {
		firstIDs[str(item["id"])] = true
		if item["video"] == nil || item["musclePrimary"] == nil || item["isWarmup"] == nil {
			t.Fatal("catalog summary contract changed")
		}
	}
	status, secondPage := request(student, "GET", "/v1/exercises?limit=3&cursor="+url.QueryEscape(str(firstPage["nextCursor"])), nil)
	if status != 200 || len(objects(secondPage["items"])) != 3 {
		t.Fatal("catalog next page failed")
	}
	for _, item := range objects(secondPage["items"]) {
		if firstIDs[str(item["id"])] {
			t.Fatal("catalog repeated an exercise from the previous page")
		}
	}
	if status, _ = request(student, "GET", "/v1/exercises/muscle-summary", nil); status != 200 {
		t.Fatal("muscle summary failed")
	}
	_, initialCounts := request(student, "GET", "/v1/exercises/muscle-summary", nil)
	_, cachedCounts := request(student, "GET", "/v1/exercises/muscle-summary", nil)
	if !bytes.Equal(jsonBytes(initialCounts), jsonBytes(cachedCounts)) {
		t.Fatal("cached muscle counts changed")
	}
	revision, _ := a.Redis.Get(ctx, "go:catalog:hash").Result()
	if n, _ := a.Redis.Exists(ctx, "go:muscle-summary:"+CatalogVersion+":"+revision+":masculino").Result(); n != 1 {
		t.Fatal("muscle count cache not stored")
	}
	if status, _ = request(other, "GET", "/v1/exercises/muscle-summary", nil); status != 200 {
		t.Fatal("unfiltered muscle counts failed")
	}
	if n, _ := a.Redis.Exists(ctx, "go:muscle-summary:"+CatalogVersion+":"+revision+":").Result(); n != 1 {
		t.Fatal("profile variants shared a cache key")
	}
	if status, _ = request(student, "GET", "/v1/exercises/"+str(slot["id"]), nil); status != 200 {
		t.Fatal("exercise detail failed")
	}
	if status, v := request(student, "GET", "/v1/exercises/"+str(slot["id"])+"/video-url", nil); status != 200 || !strings.Contains(str(v["url"]), "signature=") {
		t.Fatalf("signed video URL failed: %d %#v", status, v)
	}
	// No external storage or AI provider is contacted during these checks.
	var storageCalls atomic.Int64
	fakeStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		storageCalls.Add(1)
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `<Error><Code>NoSuchKey</Code><Message>Missing test object</Message></Error>`)
	}))
	defer fakeStorage.Close()
	a.Storage, e = minio.New(strings.TrimPrefix(fakeStorage.URL, "http://"), &minio.Options{Region: "us-east-1", BucketLookup: minio.BucketLookupPath})
	if e != nil {
		t.Fatal(e)
	}
	a.Config.VideosPath = t.TempDir()
	if e = os.WriteFile(filepath.Join(a.Config.VideosPath, "range.mp4"), []byte("0123456789"), 0600); e != nil {
		t.Fatal(e)
	}
	var originalVideo []byte
	if e = a.DB.QueryRow(ctx, "SELECT video FROM exercises WHERE id=$1", str(slot["id"])).Scan(&originalVideo); e != nil {
		t.Fatal(e)
	}
	localDigest := sha256.Sum256([]byte("0123456789"))
	_, e = a.DB.Exec(ctx, "UPDATE exercises SET video=$1 WHERE id=$2", jsonBytes(M{"variants": M{"masculino": M{"fileName": "range.mp4", "objectKey": "exercises/range.mp4", "sha256": hex.EncodeToString(localDigest[:])}}}), str(slot["id"]))
	if e != nil {
		t.Fatal(e)
	}
	_, signed := request(student, "GET", "/v1/exercises/"+str(slot["id"])+"/video-url", nil)
	rangeRequest, _ := http.NewRequest("GET", str(signed["url"]), nil)
	rangeRequest.Header.Set("Range", "bytes=2-5")
	rangeResponse, e := student.Do(rangeRequest)
	if e != nil {
		t.Fatal(e)
	}
	rangeBody, _ := io.ReadAll(rangeResponse.Body)
	rangeResponse.Body.Close()
	if rangeResponse.StatusCode != 206 || string(rangeBody) != "2345" || rangeResponse.Header.Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("invalid media range: %d %s", rangeResponse.StatusCode, rangeBody)
	}
	if storageCalls.Load() != 0 {
		t.Fatal("verified local video still contacted remote storage")
	}
	if status, _ = request(student, "GET", "/v1/media/"+str(slot["id"])+"?expires=1&variant=masculino&signature=invalid", nil); status != 403 {
		t.Fatal("expired media URL accepted")
	}
	if _, e = a.DB.Exec(ctx, "UPDATE exercises SET video=$1 WHERE id=$2", originalVideo, str(slot["id"])); e != nil {
		t.Fatal(e)
	}
	providerCalls := 0
	a.ProviderHTTP = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		providerCalls++
		data, _ := io.ReadAll(req.Body)
		if bytes.Contains(data, []byte("student@migration.test")) || bytes.Contains(data, []byte("Migration Test")) {
			t.Error("identity leaked into AI prompt")
		}
		return &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"simulated unavailable"}`))}, nil
	})}
	a.Config.PlanEngine = "gemini"
	a.Config.GeminiKey = "simulated-not-a-real-key"
	a.Config.GeminiModel = "mock-primary"
	a.Config.GeminiFallback = "mock-fallback"
	if e = a.generateWorkout(ctx, studentID); e != nil {
		t.Fatalf("provider fallback failed: %v", e)
	}
	if providerCalls != 3 {
		t.Fatalf("expected simulated fallback attempts, got %d", providerCalls)
	}
	status, members := request(student, "GET", "/v1/memberships", nil)
	if status != 200 || len(objects(members["memberships"])) != 1 {
		t.Fatal("membership missing")
	}
	membership := str(objects(members["memberships"])[0]["id"])
	if status, _ = request(student, "POST", "/v1/memberships/"+membership+"/revoke", M{}); status != 200 {
		t.Fatal("revoke failed")
	}
	if status, _ = request(trainer, "GET", "/v1/trainer/students/"+studentID+"/progress", nil); status != 403 {
		t.Fatal("revoked consent still accessible")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
