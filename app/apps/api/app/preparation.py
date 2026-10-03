"""Conservative preparation selection, shared by both plan providers.

Source muscle/joint mappings identify involvement, not clinical suitability.
Reference: orthoinfo.aaos.org/recovery/rotator-cuff-and-shoulder-conditioning-program
"""
import re

from .plan import CatalogExercise, PlanItem, WorkoutPlan, normalized_name

REGION_MUSCLES = {
    "ombro": {"ombro", "peitoral", "costas", "trapezio"},
    "cotovelo": {"biceps", "triceps", "antebraco", "peitoral", "costas"},
    "punho": {"antebraco", "biceps", "triceps", "peitoral", "costas"},
    "coluna_cervical": {"trapezio", "ombro"},
    "coluna_lombar": {"core", "costas", "gluteos"},
    "quadril": {"gluteos", "pernas"},
    "joelho": {"pernas", "gluteos"},
    "tornozelo": {"panturrilha", "pernas"},
}
REGION_STRETCH_MUSCLES = {
    "ombro": {"ombro"}, "cotovelo": {"biceps", "triceps", "antebraco"},
    "punho": {"antebraco"}, "coluna_cervical": {"trapezio"},
    "coluna_lombar": {"core", "costas"}, "quadril": {"gluteos", "pernas"},
    "joelho": {"pernas"}, "tornozelo": {"panturrilha"},
}
REGION_LABELS = {
    "ombro": "ombro", "cotovelo": "cotovelo", "punho": "punho",
    "coluna_cervical": "coluna cervical", "coluna_lombar": "coluna lombar",
    "quadril": "quadril", "joelho": "joelho", "tornozelo": "tornozelo",
}
HIGH_RISK = re.compile(r"jump|plyo|ballistic|bounce|salto|pliometr|balistic|skater|kick|handstand|chute", re.I)
FORCED_STRETCH = re.compile(r"assisted|partner|weighted|behind neck|overhead|ponte|bridge|split|push|pushing|press|forced", re.I)


def validate_injuries(injuries: list[dict]) -> None:
    if any(i.get("status") == "dor_aguda" for i in injuries):
        raise ValueError("Dor aguda: suspenda a geração e procure avaliação profissional.")
    if any(not i.get("medicallyCleared") for i in injuries):
        raise ValueError("Informe a liberação profissional para treinar e realizar mobilidade nas regiões lesionadas.")


def involved(exercise: CatalogExercise, region: str) -> bool:
    muscles = set(exercise.target_muscles) | {exercise.muscle_primary}
    return region in exercise.joints or bool(muscles & REGION_MUSCLES.get(region, set()))


def injury_compatible(exercise: CatalogExercise, injuries: list[dict]) -> bool:
    regions = {i["region"] for i in injuries}
    if regions & set(exercise.contraindications):
        return False
    affected = [i for i in injuries if involved(exercise, i["region"])]
    if not affected:
        return True
    if any(not i.get("medicallyCleared") or i.get("status") == "dor_aguda" for i in affected):
        return False
    name = f"{normalized_name(exercise.name)} {exercise.name_raw}"
    if HIGH_RISK.search(name) or exercise.complexity == "avancado":
        return False
    if any(i.get("severity") == "grave" for i in affected):
        return False
    if exercise.is_stretch:
        return exercise.equipment == "peso_corporal" and exercise.complexity == "iniciante" and not FORCED_STRETCH.search(name)
    if "ombro" in regions and involved(exercise, "ombro"):
        if re.search(r"overhead|press|desenvolvimento|militar|arnold|upright.?row|dip", name, re.I):
            return False
        if exercise.target_key.startswith("manguito_rotador_") and exercise.equipment != "peso_corporal":
            return False
    if "coluna_cervical" in regions and involved(exercise, "coluna_cervical"):
        if exercise.equipment != "peso_corporal" or re.search(r"neck|pescoco|head|cabeca", name, re.I):
            return False
    if "coluna_lombar" in regions and re.search(r"deadlift|terra|good.?morning|curvad|superman|twist|rotation|rotacao|sit.?up|crunch", name, re.I):
        return False
    if regions & {"joelho", "quadril", "tornozelo"} and any(involved(exercise, r) for r in regions & {"joelho", "quadril", "tornozelo"}):
        if re.search(r"squat|agachamento|leg.?press|lunge|afundo|avanc|stiff|deadlift|terra|pistol", name, re.I):
            return False
    if regions & {"cotovelo", "punho"} and exercise.equipment in {"barra", "smith"}:
        return False
    return True


def prepare_plan(plan: WorkoutPlan, catalog: list[CatalogExercise], profile) -> WorkoutPlan:
    injuries = profile.injuries or []
    validate_injuries(injuries)
    available = set(profile.equipment or []) | {"peso_corporal"}
    by_id = {e.id: e for e in catalog}
    sex = getattr(profile, "sex", None)
    preferred = sex if sex in ("masculino", "feminino") else None

    def compatible(e: CatalogExercise) -> bool:
        return (e.equipment in available and set(e.required_equipment).issubset(available)
                and injury_compatible(e, injuries)
                and (not preferred or preferred in e.video_variants)
                and not (profile.level == "iniciante" and e.complexity == "avancado"))

    for day in plan.days:
        mains = [i for i in day.exercises if i.phase == "principal"]
        if not mains:
            day.preparationNotes = []
            day.guidedCuffWarmup = False
            day.guidedGeneralWarmup = False
            continue
        main_exercises = []
        for item in mains:
            for exercise_id in [item.exerciseId, *item.reserveExerciseIds]:
                exercise = by_id.get(exercise_id)
                if not exercise or not compatible(exercise):
                    raise ValueError("Plano incompatível com equipamentos, vídeos ou limitações do perfil.")
            main_exercises.append(by_id[item.exerciseId])
        affected = [i for i in injuries if any(involved(e, i["region"]) for e in main_exercises)]
        focus = {m for e in main_exercises for m in (e.target_muscles or [e.muscle_primary])}
        shoulder = "ombro" in focus or any(i["region"] == "ombro" for i in affected)
        day.preparationNotes = ["Comece com 5 a 10 minutos de atividade leve, sem dor, antes da mobilidade e das séries principais."]
        day.guidedCuffWarmup = False
        day.guidedGeneralWarmup = False
        for injury in affected:
            region = REGION_LABELS[injury["region"]]
            day.preparationNotes.append(f"Limitação em {region}: siga a amplitude e a carga liberadas pelo profissional. Interrompa se houver dor.")
        selected: list[CatalogExercise] = []
        selected_names = {normalized_name(by_id[exercise_id].name) for item in mains for exercise_id in [item.exerciseId, *item.reserveExerciseIds]}

        def choose(pool: list[CatalogExercise]) -> CatalogExercise | None:
            for exercise in pool:
                name = normalized_name(exercise.name)
                if name not in selected_names:
                    selected_names.add(name)
                    selected.append(exercise)
                    return exercise
            return None

        warmups = [e for e in catalog if e.is_warmup and not e.is_stretch and compatible(e)]
        warmups.sort(key=lambda e: (e.equipment != "peso_corporal", e.complexity != "iniciante", -len(set(e.target_muscles) & focus), len(e.joints), e.name))
        if shoulder:
            cuff = choose([e for e in warmups if e.target_key.startswith("manguito_rotador_")])
            if not cuff:
                day.guidedCuffWarmup = True
                day.preparationNotes.append("Manguito rotador: realize o aquecimento orientado pelo profissional, sem dor. Não há vídeo compatível disponível neste perfil.")
        choose([e for e in warmups if not e.target_key.startswith("manguito_rotador_")])
        warm_items = [PlanItem(exerciseId=e.id, phase="aquecimento", sets=1, reps="10-12", restSeconds=30) for e in selected]
        if not warm_items:
            day.guidedGeneralWarmup = True
            day.preparationNotes.append("Não há vídeo de aquecimento compatível. Use uma atividade leve liberada pelo profissional antes dos alongamentos.")

        stretch_pool = [e for e in catalog if e.is_stretch and compatible(e) and set(e.target_muscles or [e.muscle_primary]) & focus]
        stretch_pool.sort(key=lambda e: (-len(set(e.target_muscles) & focus), e.complexity != "iniciante", len(e.joints), e.name))
        stretches: list[CatalogExercise] = []
        for injury in affected:
            region = injury["region"]
            candidate = choose([e for e in stretch_pool if region in e.joints and set(e.target_muscles or [e.muscle_primary]) & REGION_STRETCH_MUSCLES[region]])
            if candidate:
                stretches.append(candidate)
            else:
                day.preparationNotes.append(f"Mobilidade de {REGION_LABELS[region]}: use somente os movimentos liberados pelo profissional; o catálogo não contém uma opção compatível.")
        if len(stretches) < 2:
            candidate = choose(stretch_pool)
            if candidate:
                stretches.append(candidate)
        if not stretches:
            raise ValueError("Não há alongamento compatível com as limitações e os equipamentos informados.")
        stretch_items = [PlanItem(exerciseId=e.id, phase="alongamento", sets=1, reps="15-20s", restSeconds=20) for e in stretches[:4]]
        day.exercises = warm_items + stretch_items + mains
    return plan
