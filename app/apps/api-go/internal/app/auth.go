package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/scrypt"
)

type Session struct {
	ID       string `json:"id"`
	Role     string `json:"role"`
	TenantID string `json:"tenant_id"`
}
type Authed func(http.ResponseWriter, *http.Request, Session) error

const sessionTTL = 14 * 24 * time.Hour

var passwordSlots = make(chan struct{}, 2)

func sign(value, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func randomToken(n int) string {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func hashPassword(password string) (string, error) {
	passwordSlots <- struct{}{}
	defer func() { <-passwordSlots }()
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return "", e
	}
	key, e := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if e != nil {
		return "", e
	}
	return fmt.Sprintf("scrypt$16384$8$1$%s$%s", base64.StdEncoding.EncodeToString(salt), base64.StdEncoding.EncodeToString(key)), nil
}
func verifyPassword(password, stored string) bool {
	passwordSlots <- struct{}{}
	defer func() { <-passwordSlots }()
	p := strings.Split(stored, "$")
	if len(p) != 6 || p[0] != "scrypt" {
		return false
	}
	n, e := strconv.Atoi(p[1])
	if e != nil {
		return false
	}
	r, e := strconv.Atoi(p[2])
	if e != nil {
		return false
	}
	parallel, e := strconv.Atoi(p[3])
	if e != nil || n != 16384 || r != 8 || parallel != 1 {
		return false
	}
	salt, e := base64.StdEncoding.DecodeString(p[4])
	if e != nil {
		return false
	}
	expected, e := base64.StdEncoding.DecodeString(p[5])
	if e != nil || len(expected) != 64 {
		return false
	}
	derived, e := scrypt.Key([]byte(password), salt, n, r, parallel, len(expected))
	return e == nil && subtle.ConstantTimeCompare(derived, expected) == 1
}
func (a *App) createSession(ctx context.Context, w http.ResponseWriter, u Session) (string, error) {
	id, csrf := randomToken(32), randomToken(24)
	if e := a.Redis.Set(ctx, "session:"+id, jsonBytes(u), sessionTTL).Err(); e != nil {
		return "", e
	}
	secure := strings.HasPrefix(a.Config.PublicURL, "https://")
	for _, v := range []struct {
		name, value string
		httpOnly    bool
	}{{"tw_session", id + "." + sign(id, a.Config.SessionSecret), true}, {"tw_csrf", csrf + "." + sign(csrf, a.Config.CSRFSecret), false}} {
		http.SetCookie(w, &http.Cookie{Name: v.name, Value: v.value, HttpOnly: v.httpOnly, Secure: secure, SameSite: http.SameSiteStrictMode, Path: "/", MaxAge: int(sessionTTL.Seconds())})
	}
	return csrf, nil
}
func (a *App) require(r *http.Request) (Session, error) {
	var u Session
	c, e := r.Cookie("tw_session")
	if e != nil {
		return u, fail(401, "Não autenticado")
	}
	id, sig, ok := strings.Cut(c.Value, ".")
	if !ok || !hmac.Equal([]byte(sign(id, a.Config.SessionSecret)), []byte(sig)) {
		return u, fail(401, "Sessão inválida")
	}
	b, e := a.Redis.Get(r.Context(), "session:"+id).Bytes()
	if errors.Is(e, redis.Nil) {
		return u, fail(401, "Sessão expirada")
	}
	if e != nil {
		return u, e
	}
	if json.Unmarshal(b, &u) != nil || !validID(u.ID) || !in(u.Role, []string{"student", "trainer"}) {
		return u, fail(401, "Sessão inválida")
	}
	return u, nil
}
func (a *App) csrf(r *http.Request) error {
	if r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS" {
		return nil
	}
	c, e := r.Cookie("tw_csrf")
	if e != nil {
		return fail(403, "Token CSRF inválido")
	}
	v, s, ok := strings.Cut(c.Value, ".")
	if !ok || v == "" || !hmac.Equal([]byte(v), []byte(r.Header.Get("X-CSRF-Token"))) || !hmac.Equal([]byte(sign(v, a.Config.CSRFSecret)), []byte(s)) {
		return fail(403, "Token CSRF inválido")
	}
	return nil
}
func (a *App) protected(h Authed) http.HandlerFunc {
	return a.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if e := a.csrf(r); e != nil {
			return e
		}
		u, e := a.require(r)
		if e != nil {
			return e
		}
		return h(w, r, u)
	})
}
func (a *App) access(ctx context.Context, u Session, student string) error {
	if !validID(student) {
		return fail(400, "Aluno inválido")
	}
	if u.Role == "student" {
		if student != u.ID {
			return fail(403, "Acesso negado")
		}
		return nil
	}
	if !validID(u.TenantID) {
		return fail(403, "Acesso negado")
	}
	var allowed bool
	e := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships m JOIN consents c ON c.membership_id=m.id WHERE m.tenant_id=$1 AND m.student_id=$2 AND m.status='active' AND c.revoked_at IS NULL)`, u.TenantID, student).Scan(&allowed)
	if e != nil {
		return e
	}
	if !allowed {
		return fail(403, "Consentimento ou vínculo inexistente")
	}
	return nil
}
func (a *App) limit(r *http.Request, key string, n int, window time.Duration) error {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); ip != nil && ip.IsPrivate() {
		// Walk the proxy-appended chain from the trusted side, never a client-supplied first entry.
		forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for i := len(forwarded) - 1; i >= 0; i-- {
			real := net.ParseIP(strings.TrimSpace(forwarded[i]))
			if real != nil && real.IsGlobalUnicast() && !real.IsPrivate() {
				host = real.String()
				break
			}
		}
	}
	result, e := a.Redis.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n`, []string{"go:limit:" + key + ":" + host}, window.Milliseconds()).Int()
	if e != nil {
		return e
	}
	if result > n {
		return fail(429, "Muitas tentativas. Tente novamente mais tarde.")
	}
	return nil
}
func validEmail(value string) bool {
	address, e := mail.ParseAddress(value)
	return e == nil && address.Address == value && len(value) <= 254
}
func (a *App) authRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/auth/me", a.protected(func(w http.ResponseWriter, r *http.Request, u Session) error {
		v, e := one(r.Context(), a.DB, "SELECT to_jsonb(u) FROM users u WHERE id=$1", u.ID)
		if e != nil {
			return e
		}
		if v == nil {
			return fail(401, "Não autenticado")
		}
		writeJSON(w, 200, M{"user": publicUser(v)})
		return nil
	}))
	mux.HandleFunc("POST /v1/auth/register", a.Handle(a.register))
	mux.HandleFunc("POST /v1/auth/login", a.Handle(a.login))
	mux.HandleFunc("POST /v1/auth/logout", a.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if e := a.csrf(r); e != nil {
			return e
		}
		if c, e := r.Cookie("tw_session"); e == nil {
			id, _, _ := strings.Cut(c.Value, ".")
			if e = a.Redis.Del(r.Context(), "session:"+id).Err(); e != nil {
				return e
			}
		}
		for _, name := range []string{"tw_session", "tw_csrf"} {
			http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: name == "tw_session", Secure: strings.HasPrefix(a.Config.PublicURL, "https://"), SameSite: http.SameSiteStrictMode})
		}
		writeJSON(w, 200, M{"ok": true})
		return nil
	}))
}
func (a *App) register(w http.ResponseWriter, r *http.Request) error {
	if e := a.limit(r, "register", 8, time.Hour); e != nil {
		return e
	}
	b, e := body(r)
	if e != nil {
		return e
	}
	name, email, password, role := strings.TrimSpace(str(b["name"])), strings.ToLower(strings.TrimSpace(str(b["email"]))), str(b["password"]), str(b["role"])
	if utf8.RuneCountInString(name) < 2 || utf8.RuneCountInString(name) > 100 || !validEmail(email) || utf8.RuneCountInString(password) < 12 || utf8.RuneCountInString(password) > 128 || !in(role, []string{"student", "trainer"}) {
		return fail(400, "Dados inválidos")
	}
	hash, e := hashPassword(password)
	if e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	id := uuid.NewString()
	_, e = tx.Exec(r.Context(), "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)", id, name, email, hash, role)
	if e != nil {
		var pg *pgconn.PgError
		if errors.As(e, &pg) && pg.Code == "23505" {
			return fail(409, "E-mail já cadastrado")
		}
		return e
	}
	u := Session{ID: id, Role: role}
	var tenant any
	if role == "trainer" {
		u.TenantID = uuid.NewString()
		tenant = u.TenantID
		if _, e = tx.Exec(r.Context(), "INSERT INTO tenants(id,name,owner_id) VALUES($1,$2,$3)", u.TenantID, "Equipe de "+name, id); e != nil {
			return e
		}
		if _, e = tx.Exec(r.Context(), "UPDATE users SET tenant_id=$1 WHERE id=$2", u.TenantID, id); e != nil {
			return e
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	csrf, e := a.createSession(r.Context(), w, u)
	if e != nil {
		return e
	}
	writeJSON(w, 201, M{"user": M{"id": id, "name": name, "email": email, "role": role, "tenantId": tenant}, "csrf": csrf})
	return nil
}
func (a *App) login(w http.ResponseWriter, r *http.Request) error {
	if e := a.limit(r, "login", 10, 15*time.Minute); e != nil {
		return e
	}
	b, e := body(r)
	if e != nil {
		return e
	}
	email, password := strings.ToLower(strings.TrimSpace(str(b["email"]))), str(b["password"])
	if !validEmail(email) || len(password) > 512 {
		return fail(400, "Dados inválidos")
	}
	v, e := one(r.Context(), a.DB, "SELECT to_jsonb(u) FROM users u WHERE email=$1", email)
	if e != nil {
		return e
	}
	hash := str(v["password_hash"])
	if v == nil {
		hash = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
	}
	ok := verifyPassword(password, hash)
	if v == nil || !ok {
		return fail(401, "Credenciais inválidas")
	}
	csrf, e := a.createSession(r.Context(), w, Session{ID: str(v["id"]), Role: str(v["role"]), TenantID: str(v["tenant_id"])})
	if e != nil {
		return e
	}
	writeJSON(w, 200, M{"user": publicUser(v), "csrf": csrf})
	return nil
}
