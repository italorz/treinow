package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func balancedCatalog(catalog []M) []M {
	counts := map[string]int{}
	out := []M{}
	for _, e := range catalog {
		key := str(e["target_key"]) + ":" + str(e["equipment"])
		if truth(e["is_warmup"]) {
			key += ":warm"
		}
		if truth(e["is_stretch"]) {
			key += ":stretch"
		}
		if counts[key] < 2 {
			counts[key]++
			out = append(out, e)
		}
		if len(out) == 360 {
			break
		}
	}
	return out
}
func (a *App) geminiPlan(ctx context.Context, p M, catalog []M, recent map[string]bool) ([]M, string) {
	compact := []M{}
	for _, e := range balancedCatalog(catalog) {
		compact = append(compact, M{"id": e["id"], "nome": e["name"], "musculo": e["muscle_primary"], "alvo_exato": e["target_key"], "equipamento": e["equipment"], "disponivel": equipmentCompatible(e, stringsOf(p["equipment"])), "feito_ultima_semana": recent[str(e["id"])], "aquecimento": e["is_warmup"], "alongamento": e["is_stretch"], "articulacoes": e["joints"], "musculos_alvo": exerciseTargets(e), "tipo": exerciseType(e), "equipamentos_necessarios": obj(knowledge(e)["equipment"])["required"]})
	}
	// Only an explicit, deidentified profile allowlist may cross the provider boundary.
	profile := publicProfile(p)
	snapshot, e := one(ctx, a.DB, `SELECT jsonb_build_object('adherencePercent',adherence_percent,'totalVolumeKg',total_volume_kg,'personalRecords',personal_records,'weeklyVolume',weekly_volume,'weightTrend',weight_trend,'bmiTrend',bmi_trend) FROM analytics_snapshots WHERE student_id=$1`, str(p["student_id"]))
	if e != nil {
		return nil, ""
	}
	profile["progressSummary"] = snapshot
	prompt := `Gere somente JSON {"days":[{"weekday":0,"title":"...","focusMuscles":[],"exercises":[{"exerciseId":"ID","phase":"principal","sets":3,"reps":"10-12","restSeconds":60,"reserveExerciseIds":["ID"]}]}]}. Exatamente 7 dias, 0=domingo. Somente trainingDays têm exercícios. Cada dia ativo exige 4 a 7 principais, escolhidos SOMENTE dos IDs fornecidos, tipo Strength, disponivel=true e sem feito_ultima_semana. Aquecimentos e alongamentos serão adicionados pela aplicação. Cada principal exige 1 a 3 reservas de MESMO alvo_exato, equipamento diferente e disponível. Máquina/cabo/smith exige reserva de peso livre. Nenhum principal ou reserva pode se repetir na semana, inclusive pelo nome. Respeite lesões, nível e equipamentos; não prescreva reabilitação nem invente IDs. Personalize dose por objetivo, intensidade, duração e prioridades. Títulos em português. Perfil desidentificado: ` + string(jsonBytes(profile)) + ` Catálogo: ` + string(jsonBytes(compact))
	client := &http.Client{Timeout: 90 * time.Second}
	if a.ProviderHTTP != nil {
		client = a.ProviderHTTP
	}
	models := []string{a.Config.GeminiModel, a.Config.GeminiFallback, "gemini-2.5-flash"}
	seen := map[string]bool{}
	for _, model := range models {
		if seen[model] || model == "" {
			continue
		}
		seen[model] = true
		if ctx.Err() != nil {
			return nil, ""
		}
		payload := M{"contents": []M{{"parts": []M{{"text": prompt}}}}, "generationConfig": M{"temperature": 0.2, "responseMimeType": "application/json"}}
		req, e := http.NewRequestWithContext(ctx, http.MethodPost, "https://generativelanguage.googleapis.com/v1beta/models/"+url.PathEscape(model)+":generateContent", bytes.NewReader(jsonBytes(payload)))
		if e != nil {
			return nil, ""
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-goog-api-key", a.Config.GeminiKey)
		response, e := client.Do(req)
		if e != nil {
			slog.WarnContext(ctx, "plan.provider_failed", "model", model)
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 2<<20))
		response.Body.Close()
		if readErr != nil || response.StatusCode != 200 {
			slog.WarnContext(ctx, "plan.provider_failed", "model", model, "status", response.StatusCode)
			continue
		}
		v, e := decodeJSON(data)
		if e != nil {
			continue
		}
		candidates := objects(v["candidates"])
		if len(candidates) == 0 {
			continue
		}
		parts := objects(obj(candidates[0]["content"])["parts"])
		var text strings.Builder
		for _, part := range parts {
			text.WriteString(str(part["text"]))
		}
		var result M
		if json.Unmarshal([]byte(text.String()), &result) != nil {
			continue
		}
		days := objects(result["days"])
		if preparePlan(days, catalog, p) != nil || validatePlan(days, catalog, p) != nil {
			continue
		}
		return days, "gemini:" + model
	}
	return nil, ""
}
