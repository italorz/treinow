import json
from pathlib import Path
from types import SimpleNamespace

from app.plan import CatalogExercise
from app.workout_engine import allowed_by_injury, balanced_catalog, rules_plan


def ex(id_, name, muscle, equipment, target_key, **extra) -> CatalogExercise:
    defaults = dict(is_warmup=False, is_stretch=False, complexity="iniciante")
    defaults.update(extra)
    return CatalogExercise(id=id_, name=name, muscle_primary=muscle, equipment=equipment, target_key=target_key, **defaults)


CATALOG = [
    ex("p1", "Supino na máquina", "peitoral", "maquina", "peitoral_horizontal"),
    ex("p2", "Crucifixo com halteres", "peitoral", "halter", "peitoral_horizontal"),
    ex("c1", "Remada na máquina", "costas", "maquina", "costas_remada_horizontal"),
    ex("c2", "Remada unilateral com halter", "costas", "halter", "costas_remada_horizontal"),
    ex("l1", "Leg press", "pernas", "maquina", "quadriceps_agachamento"),
    ex("l2", "Agachamento taça", "pernas", "halter", "quadriceps_agachamento"),
    ex("l3", "Extensão de quadril com elástico", "pernas", "elastico", "pernas_unilateral"),
    ex("l4", "Extensão de quadril no cabo", "pernas", "cabo", "pernas_unilateral"),
    ex("o1", "Elevação lateral na máquina", "ombro", "maquina", "ombro_cabeca_lateral"),
    ex("o2", "Elevação lateral com halteres", "ombro", "halter", "ombro_cabeca_lateral"),
    ex("k1", "Prancha abdominal", "core", "peso_corporal", "core_estabilidade"),
    ex("k2", "Prancha com apoio no elástico", "core", "elastico", "core_estabilidade"),
    ex("w1", "Rotação externa com elástico", "ombro", "elastico", "manguito_rotador_externo", is_warmup=True),
    ex("w2", "Mobilidade torácica", "core", "peso_corporal", "core_flexao", is_warmup=True),
    ex("w3", "Elevação de calcanhares leve", "panturrilha", "peso_corporal", "panturrilha_raise", is_warmup=True),
    ex("s1", "Alongamento de peitoral", "peitoral", "peso_corporal", "peitoral_horizontal", is_stretch=True),
    ex("s2", "Alongamento de ombros", "ombro", "peso_corporal", "ombro_geral", is_stretch=True),
]


def base_profile(**overrides) -> SimpleNamespace:
    values = dict(
        goal="mais_forte", level="iniciante", intensity="moderada", duration_minutes=45,
        training_days=[1], equipment=["maquina", "halter", "cabo", "elastico"],
        priority_muscles=["ombro"], injuries=[],
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_knee_injury_avoids_leg_press_and_keeps_plan_valid():
    profile = base_profile(injuries=[{"region": "joelho", "severity": "leve", "status": "recuperacao", "medicallyCleared": True}])
    plan = rules_plan(profile, CATALOG)
    day = plan.days[1]
    ids = [item.exerciseId for item in day.exercises] + [rid for item in day.exercises for rid in item.reserveExerciseIds]
    names = " ".join(next(e.name for e in CATALOG if e.id == id_) for id_ in ids)
    assert "leg press" not in names.lower() and "agachamento" not in names.lower()
    assert len([item for item in day.exercises if item.phase == "principal"]) >= 4


def test_shoulder_day_includes_cuff_warmup_and_prioritizes_muscle():
    plan = rules_plan(base_profile(), CATALOG)
    day = plan.days[1]
    warmup_ids = [item.exerciseId for item in day.exercises if item.phase == "aquecimento"]
    assert "w1" in warmup_ids
    assert next(item for item in day.exercises if item.phase == "principal").exerciseId == "o1"


def test_beginner_caps_sets_at_three_even_for_strength_goal():
    plan = rules_plan(base_profile(), CATALOG)
    mains = [item for item in plan.days[1].exercises if item.phase == "principal"]
    assert all(item.sets <= 3 for item in mains)


def test_leg_press_eligible_again_without_injury():
    plan = rules_plan(base_profile(), CATALOG)
    ids = [item.exerciseId for item in plan.days[1].exercises] + [rid for item in plan.days[1].exercises for rid in item.reserveExerciseIds]
    assert "l1" in ids


def test_swaps_exercise_done_last_week_but_keeps_it_as_known_reserve():
    plan = rules_plan(base_profile(), CATALOG, recent_exercise_ids={"p1"})
    day = plan.days[1]
    assert "p1" not in [item.exerciseId for item in day.exercises if item.phase == "principal"]
    assert "p1" in [rid for item in day.exercises for rid in item.reserveExerciseIds]


def _load_real_catalog() -> list[CatalogExercise]:
    catalog_path = Path(__file__).resolve().parents[3] / "catalog" / "exercises.pt-BR.json"
    raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    return [
        CatalogExercise(
            id=f"id{i}", name=item["name"], muscle_primary=item["musclePrimary"], equipment=item["equipment"],
            target_key=item["targetKey"], is_warmup=item.get("isWarmup", False), is_stretch=item.get("isStretch", False),
            complexity=item.get("complexity"), joints=item.get("joints", []),
        )
        for i, item in enumerate(raw) if not item.get("needsReview") and item.get("targetKey")
    ]


def _assert_every_day_is_complete(plan) -> None:
    for day in plan.days:
        assert len([i for i in day.exercises if i.phase == "aquecimento"]) >= 1
        assert len([i for i in day.exercises if i.phase == "principal"]) >= 4
        assert len([i for i in day.exercises if i.phase == "alongamento"]) >= 1


def test_full_week_with_real_catalog_bodyweight_and_dumbbells_only():
    balanced = balanced_catalog(_load_real_catalog())
    profile = base_profile(training_days=[0, 1, 2, 3, 4, 5, 6], equipment=["peso_corporal", "halter"], priority_muscles=[])
    _assert_every_day_is_complete(rules_plan(profile, balanced))


def test_full_week_long_workouts_survive_narrow_equipment_and_rare_priority_muscles():
    # Regressao: com balanced_catalog() (usado antes so para limitar o payload
    # da IA) alimentando tambem o motor de regras, uma semana de 7 dias com
    # treinos de 90min, equipamento raro ("bola") e musculos prioritarios de
    # catalogo pequeno (panturrilha/trapezio/antebraco) esgotava o catalogo
    # reduzido no ultimo dia e falhava com "sem 4 exercicios principais".
    real = _load_real_catalog()
    profile = base_profile(
        training_days=[0, 1, 2, 3, 4, 5, 6], duration_minutes=90, equipment=["bola"],
        priority_muscles=["panturrilha", "trapezio", "antebraco"],
        injuries=[{"region": "joelho", "severity": "grave", "status": "cronica", "medicallyCleared": True}],
    )
    _assert_every_day_is_complete(rules_plan(profile, real))


def test_regenerating_plan_with_many_recent_exercises_still_succeeds():
    # Regressao: quando o aluno ja treinou bastante (muitos exerciseId ficam
    # de fora dos "principais" por estarem em recent_exercise_ids), equipamento
    # restrito + semana cheia + treino curto podia esgotar as opcoes e falhar
    # a geracao inteira em vez de simplesmente aceitar repetir algo recente.
    real = _load_real_catalog()
    profile = base_profile(
        training_days=[0, 1, 2, 3, 4, 5, 6], duration_minutes=30, equipment=["peso_corporal", "elastico"],
        priority_muscles=["antebraco"],
    )
    recent_ids = {e.id for e in real[:80]}
    _assert_every_day_is_complete(rules_plan(profile, real, recent_exercise_ids=recent_ids))


def test_allowed_by_injury_blocks_heavy_leg_machine_but_allows_calf():
    assert allowed_by_injury(ex("x", "Cadeira extensora", "pernas", "maquina", "quadriceps_extensao"), {"joelho"}) is False
    assert allowed_by_injury(ex("y", "Panturrilha em pé", "panturrilha", "maquina", "panturrilha_raise"), {"joelho"}) is True
    assert allowed_by_injury(ex("z", "Desenvolvimento militar", "ombro", "barra", "ombro_desenvolvimento"), {"ombro"}) is False
