package app

import (
	_ "embed"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
)

//go:embed preparation-regions.json
var regionsJSON []byte
var regionsData = func() M {
	var v M
	if e := json.Unmarshal(regionsJSON, &v); e != nil {
		panic(e)
	}
	return v
}()
var highRisk = regexp.MustCompile(`(?i)jump|plyo|ballistic|bounce|salto|pliometr|balistic|skater|kick|handstand|chute`)
var forcedStretch = regexp.MustCompile(`(?i)assisted|partner|weighted|behind neck|overhead|ponte|bridge|split|push|pushing|press|forced`)
var shoulderRisk = regexp.MustCompile(`(?i)overhead|press|desenvolvimento|militar|arnold|upright.?row|dip`)
var lumbarRisk = regexp.MustCompile(`(?i)deadlift|terra|good.?morning|curvad|superman|twist|rotation|rotacao|sit.?up|crunch`)
var legRisk = regexp.MustCompile(`(?i)squat|agachamento|leg.?press|lunge|afundo|avanc|stiff|deadlift|terra|pistol`)
var heavyLeg = regexp.MustCompile(`(?i)leg ?press|agachamento|afundo|avanc|bulgaro|salto|jump|hack|stiff|terra|pistol`)
var overhead = regexp.MustCompile(`(?i)desenvolvimento|militar|arnold|overhead`)
var spineRisk = regexp.MustCompile(`(?i)terra|deadlift|good ?morning|curvad|superman`)
var neckRisk = regexp.MustCompile(`(?i)neck|pescoco|head|cabeca`)
var freeEquipment = []string{"halter", "anilha", "barra", "peso_corporal", "elastico"}
var fixedEquipment = []string{"maquina", "cabo", "smith"}

func validateInjuries(injuries []M) error {
	for _, i := range injuries {
		if str(i["status"]) == "dor_aguda" {
			return errors.New("Dor aguda: suspenda a geração e procure avaliação profissional.")
		}
	}
	for _, i := range injuries {
		if !truth(i["medicallyCleared"]) {
			return errors.New("Informe a liberação profissional para treinar e realizar mobilidade nas regiões lesionadas.")
		}
	}
	return nil
}
func exerciseTargets(e M) []string {
	m := stringsOf(knowledge(e)["targetMuscles"])
	if len(m) == 0 {
		m = []string{str(e["muscle_primary"])}
	}
	return m
}
func intersects(a, b []string) bool {
	for _, x := range a {
		if in(x, b) {
			return true
		}
	}
	return false
}
func involved(e M, region string) bool {
	return in(region, stringsOf(e["joints"])) || intersects(append(exerciseTargets(e), str(e["muscle_primary"])), stringsOf(obj(regionsData["REGION_MUSCLES"])[region]))
}
func injuryCompatible(e M, injuries []M) bool {
	regions := []string{}
	affected := []M{}
	for _, i := range injuries {
		region := str(i["region"])
		regions = append(regions, region)
		if involved(e, region) {
			affected = append(affected, i)
		}
	}
	if !in("contraindications", stringsOf(obj(e["classification"])["derivedFields"])) && intersects(regions, stringsOf(e["contraindications"])) {
		return false
	}
	if len(affected) == 0 {
		return true
	}
	for _, i := range affected {
		if !truth(i["medicallyCleared"]) || str(i["status"]) == "dor_aguda" || str(i["severity"]) == "grave" {
			return false
		}
	}
	name := normalized(str(e["name"]) + " " + str(e["name_raw"]))
	if highRisk.MatchString(name) || str(e["complexity"]) == "avancado" {
		return false
	}
	eq, key := str(e["equipment"]), str(e["target_key"])
	if truth(e["is_stretch"]) {
		return eq == "peso_corporal" && str(e["complexity"]) == "iniciante" && !forcedStretch.MatchString(name)
	}
	if in("ombro", regions) && involved(e, "ombro") && (shoulderRisk.MatchString(name) || (strings.HasPrefix(key, "manguito_rotador_") && eq != "peso_corporal")) {
		return false
	}
	if in("coluna_cervical", regions) && involved(e, "coluna_cervical") && (eq != "peso_corporal" || neckRisk.MatchString(name)) {
		return false
	}
	if in("coluna_lombar", regions) && lumbarRisk.MatchString(name) {
		return false
	}
	for _, region := range []string{"joelho", "quadril", "tornozelo"} {
		if in(region, regions) && involved(e, region) && legRisk.MatchString(name) {
			return false
		}
	}
	return !(intersects(regions, []string{"cotovelo", "punho"}) && in(eq, []string{"barra", "smith"}))
}
func allowedByInjury(e M, injuries []M) bool {
	regions := []string{}
	for _, i := range injuries {
		regions = append(regions, str(i["region"]))
	}
	name := normalized(str(e["name"]) + " " + str(e["name_raw"]))
	muscle, eq := str(e["muscle_primary"]), str(e["equipment"])
	if intersects(regions, []string{"joelho", "tornozelo", "quadril"}) && in(muscle, []string{"pernas", "gluteos", "panturrilha"}) {
		if heavyLeg.MatchString(name) || (in(eq, []string{"maquina", "smith", "barra"}) && muscle != "panturrilha") {
			return false
		}
	}
	if in("ombro", regions) && muscle == "ombro" && (overhead.MatchString(name) || str(e["complexity"]) == "avancado") {
		return false
	}
	if intersects(regions, []string{"cotovelo", "punho"}) && in(muscle, []string{"biceps", "triceps", "antebraco"}) && eq == "barra" {
		return false
	}
	return !(in("coluna_lombar", regions) && spineRisk.MatchString(name))
}
func equipmentCompatible(e M, available []string) bool {
	allowed := append(append([]string{}, available...), "peso_corporal")
	if !in(str(e["equipment"]), allowed) {
		return false
	}
	for _, v := range stringsOf(obj(knowledge(e)["equipment"])["required"]) {
		if !in(v, allowed) {
			return false
		}
	}
	return true
}
func exerciseType(e M) string {
	if s := str(knowledge(e)["exerciseType"]); s != "" {
		return s
	}
	return "Strength"
}
func compatible(e, p M) bool {
	if !equipmentCompatible(e, stringsOf(p["equipment"])) || !injuryCompatible(e, objects(p["injuries"])) || !allowedByInjury(e, objects(p["injuries"])) || str(p["level"]) == "iniciante" && str(e["complexity"]) == "avancado" {
		return false
	}
	sex := profileSex(p)
	_, ok := obj(obj(e["video"])["variants"])[sex]
	return sex == "" || ok
}

type splitDay struct {
	title   string
	muscles []string
}

func splits(n int) []splitDay {
	push := splitDay{"Peito, ombros e tríceps", []string{"peitoral", "ombro", "triceps"}}
	pull := splitDay{"Costas e bíceps", []string{"costas", "biceps", "trapezio", "antebraco"}}
	legs := splitDay{"Pernas e core", []string{"pernas", "gluteos", "panturrilha", "core"}}
	all := map[int][]splitDay{
		1: {{"Corpo inteiro", []string{"peitoral", "costas", "pernas", "ombro", "core"}}},
		2: {{"Superiores", []string{"peitoral", "costas", "ombro", "biceps", "triceps"}}, {"Inferiores e core", legs.muscles}}, 3: {push, pull, legs},
		4: {{"Peito e tríceps", []string{"peitoral", "triceps"}}, {"Costas e bíceps", []string{"costas", "biceps", "trapezio"}}, {"Pernas completas", []string{"pernas", "gluteos", "panturrilha"}}, {"Ombros e core", []string{"ombro", "core", "antebraco"}}},
		5: {{"Peito", []string{"peitoral", "triceps"}}, {"Costas", []string{"costas", "biceps"}}, legs, {"Ombros e trapézio", []string{"ombro", "trapezio"}}, {"Braços e core", []string{"biceps", "triceps", "antebraco", "core"}}},
		6: {push, pull, legs, push, pull, legs}, 7: {push, pull, legs, push, pull, legs, {"Mobilidade e core", []string{"core", "panturrilha", "antebraco"}}}}
	return all[max(1, min(7, n))]
}
func dosage(p M) (int, string, int) {
	sets, reps, rest := 3, "10-15", 45
	switch str(p["goal"]) {
	case "mais_forte":
		sets, reps, rest = 4, "6-10", 90
	case "mais_bonito":
		sets, reps, rest = 3, "8-12", 60
	case "mais_leve":
		sets, reps, rest = 3, "12-15", 45
	case "menos_estressado":
		sets, reps, rest = 2, "10-15", 60
	}
	switch str(p["intensity"]) {
	case "leve":
		sets, rest = max(2, sets-1), rest+15
	case "intensa":
		sets, rest = min(5, sets+1), max(30, rest-15)
	}
	if str(p["level"]) == "iniciante" {
		sets = min(sets, 3)
	}
	return sets, reps, rest
}
func recommendationScore(e, p M, focus string, usedTargets map[string]int, recent map[string]bool) (float64, float64) {
	k := knowledge(e)
	source := obj(k["sourceScores"])
	quality := num(source["gpt"])*2 + num(source["popularity"])
	target := map[string]float64{"iniciante": 2, "intermediario": 4, "avancado": 5}[str(p["level"])]
	if target == 0 {
		target = 3
	}
	experience := num(source["experience"])
	if experience == 0 {
		experience = target
	}
	score := -math.Abs(experience-target) + quality - float64(usedTargets[str(e["target_key"])])*5
	if recent[str(e["id"])] {
		score -= 20
	}
	targets := append(exerciseTargets(e), str(e["muscle_primary"]))
	priorities := stringsOf(p["priority_muscles"])
	for i, m := range priorities {
		if in(m, targets) {
			score += float64((len(priorities) - i) * 3)
		}
	}
	if focus != "" && in(focus, targets) {
		score += 8
	}
	measurement := obj(k["measurement"])
	switch str(p["goal"]) {
	case "mais_forte":
		if truth(measurement["weight"]) {
			score += 4
		}
		for _, s := range []string{"press", "remada", "puxada", "agachamento", "hinge"} {
			if strings.Contains(str(e["target_key"]), s) {
				score += 2
				break
			}
		}
	case "mais_bonito", "mais_leve":
		if truth(measurement["repetitions"]) {
			score += 3
		}
	case "menos_estressado":
		if in(str(e["equipment"]), []string{"peso_corporal", "elastico", "maquina"}) {
			score += 3
		}
		if experience <= 2 {
			score += 2
		}
	}
	return score, quality
}
func mainCandidate(e, p M, used, names, recent map[string]bool, allowRecent bool) bool {
	return !truth(e["is_warmup"]) && !truth(e["is_stretch"]) && exerciseType(e) == "Strength" && !strings.HasPrefix(str(e["target_key"]), "individual_") && compatible(e, p) && !used[str(e["id"])] && !names[normalized(str(e["name"]))] && (allowRecent || !recent[str(e["id"])])
}
func findReserves(e, p M, catalog []M, used, names, recent map[string]bool) []M {
	eligible := []M{}
	for _, v := range catalog {
		if str(v["target_key"]) == str(e["target_key"]) && str(v["equipment"]) != str(e["equipment"]) && mainCandidate(v, p, used, names, recent, true) && (!in(str(e["equipment"]), fixedEquipment) || in(str(v["equipment"]), freeEquipment)) {
			eligible = append(eligible, v)
		}
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		si, sj := 0, 0
		if recent[str(eligible[i]["id"])] {
			si += 2
		}
		if recent[str(eligible[j]["id"])] {
			sj += 2
		}
		if in(str(eligible[i]["equipment"]), freeEquipment) {
			si++
		}
		if in(str(eligible[j]["equipment"]), freeEquipment) {
			sj++
		}
		return si > sj
	})
	out := []M{}
	localNames := map[string]bool{normalized(str(e["name"])): true}
	for _, v := range eligible {
		name := normalized(str(v["name"]))
		if !localNames[name] {
			out = append(out, v)
			localNames[name] = true
		}
		if len(out) == 2 {
			break
		}
	}
	return out
}
func rulesPlan(p M, catalog []M, recent map[string]bool) ([]M, error) {
	if e := validateInjuries(objects(p["injuries"])); e != nil {
		return nil, e
	}
	daysActive := intsOf(p["training_days"])
	sort.Ints(daysActive)
	template := splits(len(daysActive))
	priorities := stringsOf(p["priority_muscles"])
	for i, m := range priorities {
		present := false
		for _, d := range template {
			present = present || in(m, d.muscles)
		}
		if !present {
			index := i % len(template)
			template[index].muscles = append(template[index].muscles, m)
		}
	}
	used, names := map[string]bool{}, map[string]bool{}
	usedTargets := map[string]int{}
	mark := func(e M) { used[str(e["id"])] = true; names[normalized(str(e["name"]))] = true }
	sets, reps, rest := dosage(p)
	mainsTarget := min(7, max(4, int(math.Floor(num(p["duration_minutes"])/12+.5))))
	days := []M{}
	activeIndex := 0
	for weekday := 0; weekday < 7; weekday++ {
		active := false
		for _, d := range daysActive {
			active = active || d == weekday
		}
		day := M{"weekday": weekday, "title": "Descanso", "focusMuscles": []string{}, "exercises": []M{}, "preparationNotes": []string{}, "guidedCuffWarmup": false, "guidedGeneralWarmup": false}
		if !active {
			days = append(days, day)
			continue
		}
		split := template[activeIndex%len(template)]
		muscleOrder := []string{}
		for _, m := range append(append([]string{}, priorities...), split.muscles...) {
			if in(m, split.muscles) && !in(m, muscleOrder) {
				muscleOrder = append(muscleOrder, m)
			}
		}
		availableNames := map[string]bool{}
		for _, e := range catalog {
			if mainCandidate(e, p, used, names, recent, false) {
				availableNames[normalized(str(e["name"]))] = true
			}
		}
		target := max(4, min(mainsTarget, int(math.Floor(float64(len(availableNames))/float64(len(daysActive)-activeIndex)/1.3))))
		picked := []M{}
		focus := []string{}
		pick := func(muscle string, allowRecent bool) bool {
			type ranked struct {
				exercise       M
				score, quality float64
			}
			candidates := []ranked{}
			for _, candidate := range catalog {
				if muscle != "" && str(candidate["muscle_primary"]) != muscle && !in(muscle, exerciseTargets(candidate)) {
					continue
				}
				if !mainCandidate(candidate, p, used, names, recent, allowRecent) {
					continue
				}
				score, quality := recommendationScore(candidate, p, muscle, usedTargets, recent)
				candidates = append(candidates, ranked{candidate, score, quality})
			}
			sort.SliceStable(candidates, func(i, j int) bool {
				si, qi := candidates[i].score, candidates[i].quality
				sj, qj := candidates[j].score, candidates[j].quality
				if si == sj {
					return qi > qj
				}
				return si > sj
			})
			for _, entry := range candidates {
				candidate := entry.exercise
				reserves := findReserves(candidate, p, catalog, used, names, recent)
				if len(reserves) == 0 {
					continue
				}
				mark(candidate)
				usedTargets[str(candidate["target_key"])]++
				rids := []string{}
				for _, reserve := range reserves {
					mark(reserve)
					rids = append(rids, str(reserve["id"]))
				}
				picked = append(picked, M{"exerciseId": candidate["id"], "phase": "principal", "sets": sets, "reps": reps, "restSeconds": rest, "reserveExerciseIds": rids})
				muscle := str(candidate["muscle_primary"])
				if !in(muscle, focus) && len(focus) < 3 {
					focus = append(focus, muscle)
				}
				return true
			}
			return false
		}
		fill := func(muscles []string, allowRecent bool, n int) {
			for round := 0; round < n && len(picked) < n; round++ {
				progressed := false
				for _, m := range muscles {
					if len(picked) >= n {
						break
					}
					if pick(m, allowRecent) {
						progressed = true
					}
				}
				if !progressed {
					break
				}
			}
		}
		fill(muscleOrder, false, target)
		if len(picked) < target {
			fill(muscleOrder, true, target)
		}
		if len(picked) < 4 {
			fill([]string{""}, false, 4)
		}
		if len(picked) < 4 {
			fill([]string{""}, true, 4)
		}
		day["title"] = split.title
		day["focusMuscles"] = focus
		day["exercises"] = picked
		days = append(days, day)
		activeIndex++
	}
	if e := preparePlan(days, catalog, p); e != nil {
		return nil, e
	}
	if e := validatePlan(days, catalog, p); e != nil {
		return nil, e
	}
	return days, nil
}
func preparePlan(days, catalog []M, p M) error {
	injuries := objects(p["injuries"])
	if e := validateInjuries(injuries); e != nil {
		return e
	}
	byID := map[string]M{}
	for _, e := range catalog {
		byID[str(e["id"])] = e
	}
	for _, day := range days {
		mains := []M{}
		focus := []string{}
		selectedNames := map[string]bool{}
		mainExercises := []M{}
		for _, item := range objects(day["exercises"]) {
			if str(item["phase"]) != "principal" {
				continue
			}
			mains = append(mains, item)
			e := byID[str(item["exerciseId"])]
			if e == nil {
				return errors.New("Exercício inexistente")
			}
			mainExercises = append(mainExercises, e)
			focus = append(focus, exerciseTargets(e)...)
			for _, id := range append([]string{str(item["exerciseId"])}, stringsOf(item["reserveExerciseIds"])...) {
				e := byID[id]
				if e == nil || !compatible(e, p) {
					return errors.New("Plano incompatível com equipamentos, vídeos ou limitações do perfil.")
				}
				selectedNames[normalized(str(e["name"]))] = true
			}
		}
		if len(mains) == 0 {
			day["preparationNotes"] = []string{}
			day["guidedCuffWarmup"] = false
			day["guidedGeneralWarmup"] = false
			continue
		}
		notes := []string{"Comece com 5 a 10 minutos de atividade leve, sem dor, antes da mobilidade e das séries principais."}
		affected := []M{}
		shoulder := in("ombro", focus)
		for _, injury := range injuries {
			for _, e := range mainExercises {
				if involved(e, str(injury["region"])) {
					affected = append(affected, injury)
					label := str(obj(regionsData["REGION_LABELS"])[str(injury["region"])])
					notes = append(notes, "Limitação em "+label+": siga a amplitude e a carga liberadas pelo profissional. Interrompa se houver dor.")
					shoulder = shoulder || str(injury["region"]) == "ombro"
					break
				}
			}
		}
		warm, stretches := []M{}, []M{}
		for _, e := range catalog {
			if !compatible(e, p) {
				continue
			}
			if truth(e["is_warmup"]) && !truth(e["is_stretch"]) {
				warm = append(warm, e)
			}
			if truth(e["is_stretch"]) && intersects(exerciseTargets(e), focus) {
				stretches = append(stretches, e)
			}
		}
		overlap := func(e M) int {
			n := 0
			for _, m := range exerciseTargets(e) {
				if in(m, focus) {
					n++
				}
			}
			return n
		}
		sort.SliceStable(warm, func(i, j int) bool {
			a, b := warm[i], warm[j]
			if (str(a["equipment"]) == "peso_corporal") != (str(b["equipment"]) == "peso_corporal") {
				return str(a["equipment"]) == "peso_corporal"
			}
			if (str(a["complexity"]) == "iniciante") != (str(b["complexity"]) == "iniciante") {
				return str(a["complexity"]) == "iniciante"
			}
			if overlap(a) != overlap(b) {
				return overlap(a) > overlap(b)
			}
			if len(stringsOf(a["joints"])) != len(stringsOf(b["joints"])) {
				return len(stringsOf(a["joints"])) < len(stringsOf(b["joints"]))
			}
			return str(a["name"]) < str(b["name"])
		})
		sort.SliceStable(stretches, func(i, j int) bool {
			a, b := stretches[i], stretches[j]
			if overlap(a) != overlap(b) {
				return overlap(a) > overlap(b)
			}
			if (str(a["complexity"]) == "iniciante") != (str(b["complexity"]) == "iniciante") {
				return str(a["complexity"]) == "iniciante"
			}
			if len(stringsOf(a["joints"])) != len(stringsOf(b["joints"])) {
				return len(stringsOf(a["joints"])) < len(stringsOf(b["joints"]))
			}
			return str(a["name"]) < str(b["name"])
		})
		choose := func(pool []M, filter func(M) bool) M {
			for _, e := range pool {
				name := normalized(str(e["name"]))
				if !selectedNames[name] && filter(e) {
					selectedNames[name] = true
					return e
				}
			}
			return nil
		}
		warmItems := []M{}
		makeItem := func(e M, phase, reps string, rest int) M {
			return M{"exerciseId": e["id"], "phase": phase, "sets": 1, "reps": reps, "restSeconds": rest, "reserveExerciseIds": []string{}}
		}
		day["guidedCuffWarmup"] = false
		day["guidedGeneralWarmup"] = false
		if shoulder {
			cuff := choose(warm, func(e M) bool { return strings.HasPrefix(str(e["target_key"]), "manguito_rotador_") })
			if cuff != nil {
				warmItems = append(warmItems, makeItem(cuff, "aquecimento", "10-12", 30))
			} else {
				day["guidedCuffWarmup"] = true
				notes = append(notes, "Manguito rotador: realize o aquecimento orientado pelo profissional, sem dor. Não há vídeo compatível disponível neste perfil.")
			}
		}
		if e := choose(warm, func(e M) bool { return !strings.HasPrefix(str(e["target_key"]), "manguito_rotador_") }); e != nil {
			warmItems = append(warmItems, makeItem(e, "aquecimento", "10-12", 30))
		}
		if len(warmItems) == 0 {
			day["guidedGeneralWarmup"] = true
			notes = append(notes, "Não há vídeo de aquecimento compatível. Use uma atividade leve liberada pelo profissional antes dos alongamentos.")
		}
		stretchItems := []M{}
		for _, injury := range affected {
			region := str(injury["region"])
			candidate := choose(stretches, func(e M) bool {
				return in(region, stringsOf(e["joints"])) && intersects(exerciseTargets(e), stringsOf(obj(regionsData["REGION_STRETCH_MUSCLES"])[region]))
			})
			if candidate != nil {
				stretchItems = append(stretchItems, makeItem(candidate, "alongamento", "15-20s", 20))
			} else {
				label := str(obj(regionsData["REGION_LABELS"])[region])
				notes = append(notes, "Mobilidade de "+label+": use somente os movimentos liberados pelo profissional; o catálogo não contém uma opção compatível.")
			}
		}
		if len(stretchItems) < 2 {
			if e := choose(stretches, func(M) bool { return true }); e != nil {
				stretchItems = append(stretchItems, makeItem(e, "alongamento", "15-20s", 20))
			}
		}
		if len(stretchItems) == 0 {
			return errors.New("Não há alongamento compatível com as limitações e os equipamentos informados.")
		}
		if len(stretchItems) > 4 {
			stretchItems = stretchItems[:4]
		}
		day["exercises"] = append(append(warmItems, stretchItems...), mains...)
		day["preparationNotes"] = notes
	}
	return nil
}
func validatePlan(days, catalog []M, p M) error {
	byID := map[string]M{}
	for _, e := range catalog {
		byID[str(e["id"])] = e
	}
	seenDays := map[int]bool{}
	used, names := map[string]bool{}, map[string]bool{}
	active := intsOf(p["training_days"])
	if len(days) != 7 {
		return errors.New("Plano deve conter os sete dias")
	}
	for _, day := range days {
		weekday := int(num(day["weekday"]))
		if weekday < 0 || weekday > 6 || seenDays[weekday] {
			return errors.New("Dia repetido ou inválido")
		}
		seenDays[weekday] = true
		isActive := false
		for _, d := range active {
			isActive = isActive || d == weekday
		}
		items := objects(day["exercises"])
		if !isActive {
			if len(items) > 0 {
				return errors.New("Descanso não pode conter exercícios")
			}
			continue
		}
		warm, stretch, mains, lastPhase := 0, 0, 0, -1
		daily, dailyNames := map[string]bool{}, map[string]bool{}
		shoulder, cuff := false, false
		if len(items) > 14 {
			return errors.New("Treino excede o limite de exercícios")
		}
		for _, item := range items {
			id, phase := str(item["exerciseId"]), str(item["phase"])
			e := byID[id]
			order := phaseOrder(phase)
			if e == nil || order == 99 || order < lastPhase || !compatible(e, p) {
				return errors.New("Exercício incompatível ou fora da ordem de preparação")
			}
			lastPhase = order
			name := normalized(str(e["name"]))
			if daily[id] || dailyNames[name] {
				return errors.New("Exercício repetido no mesmo treino")
			}
			daily[id], dailyNames[name] = true, true
			sets, rest := int(num(item["sets"])), int(num(item["restSeconds"]))
			if sets < 1 || sets > 8 || rest < 15 || rest > 300 || len(str(item["reps"])) < 1 || len(str(item["reps"])) > 20 {
				return errors.New("Dose de treino inválida")
			}
			reserves := stringsOf(item["reserveExerciseIds"])
			if len(reserves) > 3 {
				return errors.New("Reservas excedem o limite")
			}
			switch phase {
			case "aquecimento":
				warm++
				if !truth(e["is_warmup"]) || truth(e["is_stretch"]) || len(reserves) > 0 {
					return errors.New("Aquecimento inválido")
				}
				cuff = cuff || strings.HasPrefix(str(e["target_key"]), "manguito_rotador_")
			case "alongamento":
				stretch++
				if !truth(e["is_stretch"]) || len(reserves) > 0 {
					return errors.New("Alongamento inválido")
				}
			case "principal":
				mains++
				if used[id] || names[name] || truth(e["is_warmup"]) || truth(e["is_stretch"]) || exerciseType(e) != "Strength" || strings.HasPrefix(str(e["target_key"]), "individual_") || len(reserves) == 0 {
					return errors.New("Exercício principal repetido ou sem reserva equivalente")
				}
				used[id], names[name] = true, true
				shoulder = shoulder || strings.HasPrefix(str(e["target_key"]), "ombro_")
			}
			free := false
			for _, rid := range reserves {
				v := byID[rid]
				n := normalized(str(v["name"]))
				if v == nil || used[rid] || names[n] || !compatible(v, p) || truth(v["is_warmup"]) || truth(v["is_stretch"]) || exerciseType(v) != "Strength" || str(v["target_key"]) != str(e["target_key"]) || str(v["equipment"]) == str(e["equipment"]) {
					return errors.New("Reserva sem equivalência anatômica ou repetida")
				}
				used[rid], names[n] = true, true
				free = free || in(str(v["equipment"]), freeEquipment)
			}
			if phase == "principal" && in(str(e["equipment"]), fixedEquipment) && !free {
				return errors.New("Exercício de máquina sem reserva com peso livre")
			}
		}
		if mains < 4 || stretch == 0 || (warm == 0 && !truth(day["guidedGeneralWarmup"])) || (shoulder && !cuff && !truth(day["guidedCuffWarmup"])) {
			return errors.New("Cada treino precisa de aquecimento, quatro exercícios principais e alongamento compatível")
		}
	}
	return nil
}
