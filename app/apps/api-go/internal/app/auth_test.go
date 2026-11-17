package app

import (
	"net/http/httptest"
	"testing"
)

func TestPythonScryptCompatibility(t *testing.T) {
	stored := "scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg==$xf/7Uq5m3uMxsVxpJpqvBVNIvSx7P/fIzNBcpafpM82IeAvNv1A2H0XV06HW2ZjR2+qMiF5jhLAeBrSN/cHCNQ=="
	if !verifyPassword("migration-test-password", stored) {
		t.Fatal("existing Python password rejected")
	}
	if verifyPassword("wrong-password", stored) {
		t.Fatal("wrong password accepted")
	}
	hash, e := hashPassword("new-password-for-go")
	if e != nil || !verifyPassword("new-password-for-go", hash) {
		t.Fatal("password roundtrip failed")
	}
	if verifyPassword("anything", "scrypt$1073741824$8$1$AA==$AA==") {
		t.Fatal("unsafe password parameters accepted")
	}
}
func TestCSRFRejectsMissingOrForgedCookie(t *testing.T) {
	a := &App{Config: Config{CSRFSecret: "test-secret-only"}}
	r := httptest.NewRequest("POST", "/v1/meta", nil)
	if a.csrf(r) == nil {
		t.Fatal("missing csrf accepted")
	}
	r.Header.Set("Cookie", "tw_csrf=test.forged")
	r.Header.Set("X-CSRF-Token", "test")
	if a.csrf(r) == nil {
		t.Fatal("forged csrf accepted")
	}
	r.Header.Set("Cookie", "tw_csrf=test."+sign("test", a.Config.CSRFSecret))
	if e := a.csrf(r); e != nil {
		t.Fatal(e)
	}
}
func TestProfileValidation(t *testing.T) {
	b := M{"goal": "mais_forte", "level": "iniciante", "sex": "masculino", "intensity": "moderada", "durationMinutes": "45", "location": "academia", "weightKg": 70, "heightCm": 170, "age": 30, "trainingDays": []any{1.0, 3.0, 5.0}, "equipment": []string{"halter"}, "priorityMuscles": []string{}, "injuries": []M{}}
	if e := validateProfile(b); e != nil {
		t.Fatal(e)
	}
	b["heightCm"] = 0
	if validateProfile(b) == nil {
		t.Fatal("invalid height accepted")
	}
	b["heightCm"] = 170
	b["injuries"] = M{"region": "ombro"}
	if validateProfile(b) == nil {
		t.Fatal("malformed injury array accepted")
	}
}
