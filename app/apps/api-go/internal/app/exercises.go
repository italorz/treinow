package app

import (
	"crypto/hmac"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/minio/minio-go/v7"
)

//go:embed guidance-cues.json
var cuesJSON []byte
var cuesData = func() M {
	var v M
	if e := json.Unmarshal(cuesJSON, &v); e != nil {
		panic(e)
	}
	return v
}()

func knowledge(e M) M { return obj(obj(e["classification"])["knowledge"]) }
func executionGuide(e M) any {
	g := obj(e["guidance"])
	if len(g) == 0 {
		return nil
	}
	return M{"execucao": g["execucao"], "evitarLesoes": g["evitarLesoes"], "cargaExcessiva": g["cargaExcessiva"], "narracao": g["narracao"], "disclaimer": "Orientação geral, não substitui um profissional.", "hasNarration": str(g["narracao"]) != ""}
}
func guidance(e M) M {
	targets := stringsOf(knowledge(e)["targetMuscles"])
	if len(targets) == 0 {
		targets = []string{str(e["muscle_primary"])}
	}
	labels := []string{}
	for _, v := range targets {
		if s := str(obj(cuesData["MUSCLES"])[v]); s != "" && !in(s, labels) {
			labels = append(labels, s)
		}
	}
	target := strings.Join(labels, ", ")
	if target == "" {
		target = "os músculos indicados no vídeo"
	}
	key := str(e["target_key"])
	var cues []string
	general := false
	switch {
	case truth(e["is_stretch"]):
		cues = []string{"Alongamento com foco em " + target + "; siga a posição demonstrada.", "Entre na posição devagar, mantenha os apoios e respire normalmente.", "Use uma tensão leve e confortável, sem forçar a amplitude nem fazer balanços.", "Prender a respiração ou mudar os apoios para ir mais longe são sinais para diminuir a amplitude.", "Alongamento não deve provocar dor. Dor articular, formigamento ou sensação de choque exige interrupção."}
	case strings.HasPrefix(key, "manguito_rotador"):
		cues = stringsOf(obj(cuesData["CUES"])["manguito_rotador"])
	case truth(e["is_warmup"]) || str(knowledge(e)["exerciseType"]) == "Aerobic":
		cues = []string{"Preparação ou atividade dinâmica envolvendo " + target + ".", "Comece em ritmo leve, seguindo os apoios e a trajetória do vídeo.", "Aumente o ritmo somente enquanto conseguir controlar o movimento e respirar confortavelmente.", "Perder o equilíbrio ou precisar de impulso para manter o movimento pede redução do ritmo.", "Dor, tontura ou falta de ar incomum pede interrupção. Com lesão, siga a atividade liberada pelo profissional."}
	case key == "pernas_hinge" || key == "posterior_coxa_hinge":
		cues = stringsOf(cuesData["HINGE"])
	default:
		prefixes := []string{}
		for p := range obj(cuesData["CUES"]) {
			prefixes = append(prefixes, p)
		}
		sort.Slice(prefixes, func(i, j int) bool { return len(prefixes[i]) > len(prefixes[j]) })
		for _, p := range prefixes {
			if strings.HasPrefix(key, p) {
				cues = stringsOf(obj(cuesData["CUES"])[p])
				break
			}
		}
	}
	if len(cues) < 5 {
		general = true
		cues = []string{"Exercício com foco em " + target + ". Orientação geral: confirme a técnica desta variação com um profissional.", "Observe a posição inicial, os apoios e a trajetória no vídeo antes de começar.", "Comece com baixa resistência e mantenha o movimento controlado, sem forçar a amplitude.", "Perder os apoios, dar trancos ou precisar de impulso são sinais para revisar a execução.", "Não use a localização da sensação para diagnosticar erro. Dor, formigamento ou perda de força exige interrupção."}
	}
	return M{"description": cues[0], "steps": cues[1:3], "commonMistake": cues[3], "attention": cues[4], "targetMuscles": labels, "general": general, "sensation": "Esforço pode ocorrer nos músculos-alvo e auxiliares. Onde você sente, sozinho, não confirma execução correta ou incorreta.", "stop": "Interrompa se houver dor aguda, articular, irradiada, formigamento ou perda de força. Peça avaliação profissional antes de continuar."}
}
func exerciseSummary(e M) M {
	return M{"id": e["id"], "slug": e["slug"], "name": e["name"], "musclePrimary": e["muscle_primary"], "equipment": e["equipment"], "complexity": e["complexity"], "requiresHighMindMuscleAwareness": e["requires_high_mind_muscle_awareness"], "exerciseType": knowledge(e)["exerciseType"], "isWarmup": e["is_warmup"], "isStretch": e["is_stretch"], "video": e["video"]}
}
func exerciseDetail(e M) M {
	v := exerciseSummary(e)
	delete(v, "video")
	for api, db := range map[string]string{"secondaryMuscles": "secondary_muscles", "movementPattern": "movement_pattern", "targetKey": "target_key", "isUnilateral": "is_unilateral", "joints": "joints"} {
		v[api] = e[db]
	}
	variants := []string{}
	for k := range obj(obj(e["video"])["variants"]) {
		variants = append(variants, k)
	}
	sort.Strings(variants)
	v["videoVariants"] = variants
	v["knowledge"] = knowledge(e)
	v["guidance"] = guidance(e)
	v["executionGuide"] = executionGuide(e)
	return v
}
func (a *App) exercise(r *http.Request, id string) (M, error) {
	if !validID(id) {
		return nil, fail(400, "Exercício inválido")
	}
	e, err := one(r.Context(), a.DB, "SELECT to_jsonb(e) FROM exercises e WHERE id=$1 AND "+ActiveCatalogSQL, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, fail(404, "Exercício não encontrado")
	}
	return e, nil
}
func (a *App) exerciseRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/exercises", a.protected(a.listExercises))
	mux.HandleFunc("GET /v1/exercises/muscle-summary", a.protected(a.muscleSummary))
	mux.HandleFunc("GET /v1/exercises/{id}", a.protected(a.exerciseInfo))
	mux.HandleFunc("GET /v1/exercises/{id}/video-url", a.protected(a.videoURL))
	mux.HandleFunc("GET /v1/media/{id}", a.Handle(a.media))
}
func profileSex(p M) string {
	s := str(p["sex"])
	if s == "masculino" || s == "feminino" {
		return s
	}
	return ""
}
func (a *App) listExercises(w http.ResponseWriter, r *http.Request, u Session) error {
	p, e := a.profile(r.Context(), u.ID)
	if e != nil {
		return e
	}
	args := []any{}
	where := ActiveCatalogSQL
	add := func(clause string, v any) { args = append(args, v); where += " AND " + fmt.Sprintf(clause, len(args)) }
	if s := profileSex(p); s != "" {
		add("video->'variants' ? $%d", s)
	}
	q := r.URL.Query()
	if t := q.Get("type"); t != "" {
		if t == "warmup" {
			where += " AND is_warmup AND NOT is_stretch"
		} else if in(t, []string{"Strength", "Stretching", "Aerobic"}) {
			add("classification->'knowledge'->>'exerciseType'=$%d", t)
		} else {
			return fail(400, "Categoria de exercício inválida")
		}
	}
	if m := q.Get("muscle"); m != "" {
		args = append(args, m)
		where += fmt.Sprintf(" AND (muscle_primary=$%d OR classification->'knowledge'->'targetMuscles' @> jsonb_build_array($%d::text))", len(args), len(args))
	}
	if v := q.Get("equipment"); v != "" {
		add("equipment=$%d", v)
	}
	for _, token := range strings.FieldsFunc(normalized(q.Get("search")), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		add("$%d=ANY(search_tokens)", token)
	}
	if cursor := q.Get("cursor"); validID(cursor) {
		add("id>$%d::uuid", cursor)
	}
	limit := 9
	if v, e := strconv.Atoi(q.Get("limit")); e == nil {
		limit = max(1, min(v, 24))
	}
	args = append(args, limit)
	rows, e := many(r.Context(), a.DB, "SELECT to_jsonb(e) FROM exercises e WHERE "+where+fmt.Sprintf(" ORDER BY id LIMIT $%d", len(args)), args...)
	if e != nil {
		return e
	}
	out := []M{}
	for _, v := range rows {
		out = append(out, exerciseSummary(v))
	}
	var next any
	if len(rows) == limit {
		next = rows[len(rows)-1]["id"]
	}
	writeJSON(w, 200, M{"items": out, "nextCursor": next})
	return nil
}
func (a *App) muscleSummary(w http.ResponseWriter, r *http.Request, u Session) error {
	p, e := a.profile(r.Context(), u.ID)
	if e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), `SELECT target,count(*) FROM exercises, jsonb_array_elements_text(classification->'knowledge'->'targetMuscles') target WHERE `+ActiveCatalogSQL+` AND ($1='' OR video->'variants' ? $1) GROUP BY target`, profileSex(p))
	if e != nil {
		return e
	}
	defer rows.Close()
	counts := M{}
	for rows.Next() {
		var name string
		var n int
		if e = rows.Scan(&name, &n); e != nil {
			return e
		}
		counts[name] = n
	}
	if e = rows.Err(); e != nil {
		return e
	}
	writeJSON(w, 200, M{"counts": counts})
	return nil
}
func (a *App) exerciseInfo(w http.ResponseWriter, r *http.Request, u Session) error {
	ex, e := a.exercise(r, r.PathValue("id"))
	if e != nil {
		return e
	}
	p, e := a.profile(r.Context(), u.ID)
	if e != nil {
		return e
	}
	rows, e := many(r.Context(), a.DB, `SELECT to_jsonb(e) FROM exercises e WHERE `+ActiveCatalogSQL+` AND id<>$1 AND NOT needs_review AND (is_warmup OR is_stretch) AND ($2='' OR video->'variants' ? $2) ORDER BY CASE WHEN target_key LIKE 'manguito_rotador_%' THEN 0 ELSE 1 END, CASE WHEN complexity='iniciante' THEN 0 ELSE 1 END,name`, str(ex["id"]), profileSex(p))
	if e != nil {
		return e
	}
	warm, stretch := []M{}, []M{}
	target := append(stringsOf(knowledge(ex)["targetMuscles"]), str(ex["muscle_primary"]))
	for _, v := range rows {
		if p != nil && (!injuryCompatible(v, objects(p["injuries"])) || !equipmentCompatible(v, stringsOf(p["equipment"]))) {
			continue
		}
		matched := str(ex["muscle_primary"]) == "ombro" && strings.HasPrefix(str(v["target_key"]), "manguito_rotador_")
		for _, t := range stringsOf(knowledge(v)["targetMuscles"]) {
			matched = matched || in(t, target)
		}
		if !matched {
			continue
		}
		row := M{"id": v["id"], "name": v["name"], "equipment": v["equipment"]}
		if truth(v["is_stretch"]) {
			if len(stretch) < 3 {
				stretch = append(stretch, row)
			}
		} else if truth(v["is_warmup"]) && len(warm) < 3 {
			warm = append(warm, row)
		}
	}
	writeJSON(w, 200, M{"exercise": exerciseDetail(ex), "warmups": warm, "stretches": stretch})
	return nil
}
func mediaSignature(secret, id, variant string, expiry int64) string {
	h := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(h, "%s:%s:%d", id, variant, expiry)
	return hex.EncodeToString(h.Sum(nil))
}
func (a *App) videoURL(w http.ResponseWriter, r *http.Request, u Session) error {
	ex, e := a.exercise(r, r.PathValue("id"))
	if e != nil {
		return e
	}
	p, e := a.profile(r.Context(), u.ID)
	if e != nil {
		return e
	}
	variants := obj(obj(ex["video"])["variants"])
	variant := r.URL.Query().Get("variant")
	if _, explicit := r.URL.Query()["variant"]; explicit {
		if _, ok := variants[variant]; !ok {
			return fail(400, "Variante de vídeo indisponível")
		}
	} else {
		variant = profileSex(p)
		if variant != "" {
			if _, ok := variants[variant]; !ok {
				return fail(404, "Não há demonstração disponível para o sexo informado no perfil.")
			}
		} else {
			keys := []string{}
			for k := range variants {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			variant = "padrao"
			if len(keys) > 0 {
				variant = keys[0]
			}
		}
	}
	expiry := a.Now().Add(5 * time.Minute).Unix()
	id := str(ex["id"])
	url := fmt.Sprintf("%s/v1/media/%s?variant=%s&expires=%d&signature=%s", a.Config.PublicURL, id, variant, expiry, mediaSignature(a.Config.SessionSecret, id, variant, expiry))
	writeJSON(w, 200, M{"url": url})
	return nil
}
func (a *App) media(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	id, variant := r.PathValue("id"), q.Get("variant")
	if variant == "" {
		variant = "padrao"
	}
	expiry, e := strconv.ParseInt(q.Get("expires"), 10, 64)
	if e != nil || expiry < a.Now().Unix() || !hmac.Equal([]byte(q.Get("signature")), []byte(mediaSignature(a.Config.SessionSecret, id, variant, expiry))) {
		return fail(403, "URL de mídia inválida ou expirada")
	}
	ex, e := a.exercise(r, id)
	if e != nil {
		return e
	}
	video := obj(ex["video"])
	variants := obj(video["variants"])
	selected := video
	if len(variants) > 0 {
		selected = obj(variants[variant])
	}
	if len(selected) == 0 {
		return fail(404, "Variante de vídeo não encontrada")
	}
	key := str(selected["objectKey"])
	file := str(selected["fileName"])
	bucket := a.Config.Bucket
	if a.Config.StorageProvider == "gdrive" {
		bucket = a.Config.DriveBucket
		if strings.HasPrefix(key, "exercises/") && file != "" {
			kind := "forca"
			if truth(ex["is_stretch"]) {
				kind = "alongamento"
			} else if truth(ex["is_warmup"]) {
				kind = "aquecimento"
			} else if str(knowledge(ex)["exerciseType"]) == "Aerobic" {
				kind = "aerobico"
			}
			key = str(ex["muscle_primary"]) + "/" + kind + "/" + variant + "/" + file
		}
	}
	object, e := a.Storage.GetObject(r.Context(), bucket, key, minio.GetObjectOptions{})
	if e == nil {
		defer object.Close()
		stat, err := object.Stat()
		if err == nil {
			w.Header().Set("Cache-Control", "private, max-age=300")
			w.Header().Set("Content-Type", "video/mp4")
			http.ServeContent(w, r, file, stat.LastModified, object)
			return nil
		}
		e = err
	}
	if a.Config.StorageProvider == "gdrive" && file != "" && filepath.Base(file) == file {
		f, err := os.Open(filepath.Join(a.Config.VideosPath, file))
		if err == nil {
			defer f.Close()
			stat, err := f.Stat()
			if err == nil && stat.Mode().IsRegular() {
				w.Header().Set("Cache-Control", "private, max-age=300")
				w.Header().Set("Content-Type", "video/mp4")
				http.ServeContent(w, r, file, stat.ModTime(), f)
				return nil
			}
		}
	}
	return fail(503, "Vídeo temporariamente indisponível")
}
