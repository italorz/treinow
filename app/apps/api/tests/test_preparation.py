from types import SimpleNamespace

import pytest

from app.plan import CatalogExercise, PlanDay, PlanItem, WorkoutPlan
from app.preparation import injury_compatible, prepare_plan, validate_injuries


def exercise(id_, *, gender="feminino", equipment="peso_corporal", warm=False, stretch=False, target="ombro_cabeca_lateral"):
    return CatalogExercise(
        id=id_, name=id_, muscle_primary="ombro", equipment=equipment, target_key=target,
        is_warmup=warm, is_stretch=stretch, complexity="iniciante", joints=["ombro"],
        target_muscles=["ombro"], required_equipment=[equipment], video_variants=[gender],
    )


def profile(**overrides):
    values = dict(sex="feminino", equipment=["peso_corporal"], level="iniciante", injuries=[])
    values.update(overrides)
    return SimpleNamespace(**values)


def plan():
    return WorkoutPlan(days=[PlanDay(weekday=d, title="Ombro", exercises=[
        PlanItem(exerciseId="main", phase="principal", sets=2, reps="10", restSeconds=60),
    ]) for d in [1, 3]])


def test_missing_female_cuff_does_not_select_male_video():
    catalog = [exercise("main"), exercise("warm", warm=True), exercise("stretch", stretch=True),
               exercise("male-cuff", gender="masculino", warm=True, target="manguito_rotador_externo")]
    prepared = prepare_plan(plan(), catalog, profile())
    assert all(day.guidedCuffWarmup for day in prepared.days)
    assert all("male-cuff" not in [item.exerciseId for item in day.exercises] for day in prepared.days)
    assert all([item.phase for item in day.exercises] == ["aquecimento", "alongamento", "principal"] for day in prepared.days)


def test_preparation_can_repeat_on_separate_days_without_unsafe_fallback():
    catalog = [exercise("main"), exercise("warm", warm=True), exercise("stretch", stretch=True)]
    prepared = prepare_plan(plan(), catalog, profile())
    assert [item.exerciseId for item in prepared.days[0].exercises[:2]] == ["warm", "stretch"]
    assert [item.exerciseId for item in prepared.days[1].exercises[:2]] == ["warm", "stretch"]


def test_equipment_missing_from_warmup_produces_guidance_not_unavailable_exercise():
    catalog = [exercise("main"), exercise("cable-cuff", equipment="cabo", warm=True, target="manguito_rotador_externo"), exercise("stretch", stretch=True)]
    prepared = prepare_plan(plan(), catalog, profile())
    assert all(day.guidedGeneralWarmup for day in prepared.days)
    assert all("cable-cuff" not in [item.exerciseId for item in day.exercises] for day in prepared.days)


@pytest.mark.parametrize("injury", [
    {"region": "ombro", "severity": "leve", "status": "recuperacao", "medicallyCleared": False},
    {"region": "ombro", "severity": "leve", "status": "dor_aguda", "medicallyCleared": True},
])
def test_injury_disclosure_does_not_imply_clearance(injury):
    with pytest.raises(ValueError):
        validate_injuries([injury])


def test_clearance_does_not_override_explicit_contraindications_or_loaded_cuff():
    injury = {"region": "ombro", "severity": "leve", "status": "recuperacao", "medicallyCleared": True}
    loaded = exercise("halter-cuff", equipment="halter", warm=True, target="manguito_rotador_externo")
    contraindicated = exercise("restricted", stretch=True)
    contraindicated.contraindications = ["ombro"]
    assert not injury_compatible(loaded, [injury])
    assert not injury_compatible(contraindicated, [injury])
