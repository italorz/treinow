import pytest

from app.plan import CatalogExercise, PlanDay, PlanItem, WorkoutPlan, validate_plan


def ex(id_, target_key, equipment, **extra) -> CatalogExercise:
    defaults = dict(muscle_primary="ombro", is_warmup=False, is_stretch=False)
    defaults.update(extra)
    return CatalogExercise(id=id_, name=id_, target_key=target_key, equipment=equipment, **defaults)


def test_rejects_front_raise_as_lateral_raise_reserve():
    catalog = [
        ex("warm", "manguito_rotador_externo", "elastico", is_warmup=True),
        ex("lateral", "ombro_cabeca_lateral", "maquina"),
        ex("frontal", "ombro_cabeca_anterior", "halter"),
        ex("m2", "ombro_desenvolvimento", "halter"), ex("r2", "ombro_desenvolvimento", "barra"),
        ex("m3", "ombro_geral", "halter"), ex("r3", "ombro_geral", "elastico"),
        ex("m4", "manguito_rotador_interno", "cabo"), ex("r4", "manguito_rotador_interno", "halter"),
        ex("stretch", "ombro_geral", "peso_corporal", is_stretch=True, is_warmup=True),
    ]
    pairs = [("m2", "r2"), ("m3", "r3"), ("m4", "r4")]
    exercises = [
        PlanItem(exerciseId="warm", phase="aquecimento", sets=2, reps="15", restSeconds=20, reserveExerciseIds=[]),
        PlanItem(exerciseId="lateral", phase="principal", sets=3, reps="12", restSeconds=60, reserveExerciseIds=["frontal"]),
        *[PlanItem(exerciseId=main, phase="principal", sets=3, reps="12", restSeconds=60, reserveExerciseIds=[reserve]) for main, reserve in pairs],
        PlanItem(exerciseId="stretch", phase="alongamento", sets=2, reps="30s", restSeconds=20, reserveExerciseIds=[]),
    ]
    plan = WorkoutPlan(days=[
        PlanDay(weekday=weekday, title="Ombros" if weekday == 1 else "Descanso", focusMuscles=["ombro"] if weekday == 1 else [], exercises=exercises if weekday == 1 else [])
        for weekday in range(7)
    ])
    with pytest.raises(ValueError, match="correlação anatômica"):
        validate_plan(plan, catalog, [1], ["maquina", "cabo", "halter"])
