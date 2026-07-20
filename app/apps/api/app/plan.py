import unicodedata
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from .schemas.common import Phase

FIXED_EQUIPMENT = {"maquina", "cabo", "smith"}
FREE_EQUIPMENT = {"halter", "anilha", "barra", "peso_corporal", "elastico"}


class PlanItem(BaseModel):
    exerciseId: str
    phase: Phase
    sets: int = Field(ge=1, le=8)
    reps: str = Field(min_length=1, max_length=20)
    restSeconds: int = Field(ge=15, le=300)
    reserveExerciseIds: list[str] = Field(max_length=3, default_factory=list)


class PlanDay(BaseModel):
    weekday: int = Field(ge=0, le=6)
    title: str = Field(min_length=2, max_length=80)
    focusMuscles: list[str] = Field(max_length=4, default_factory=list)
    exercises: list[PlanItem] = Field(max_length=14, default_factory=list)


class WorkoutPlan(BaseModel):
    days: list[PlanDay]


@dataclass
class CatalogExercise:
    id: str
    name: str
    muscle_primary: str
    equipment: str
    target_key: str
    is_warmup: bool
    is_stretch: bool
    complexity: str | None = None
    joints: list[str] = field(default_factory=list)


def normalized_name(name: str) -> str:
    decomposed = unicodedata.normalize("NFD", name)
    without_diacritics = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return without_diacritics.strip().lower()


def validate_plan(plan: WorkoutPlan, catalog: list[CatalogExercise], training_days: list[int], available_equipment: list[str]) -> WorkoutPlan:
    by_id = {exercise.id: exercise for exercise in catalog}
    active_days = set(training_days)
    allowed_main_equipment = set(available_equipment) | {"peso_corporal"}
    globally_used: set[str] = set()
    globally_used_names: set[str] = set()

    if len({day.weekday for day in plan.days}) != 7:
        raise ValueError("Plano deve conter os sete dias sem duplicação")

    for day in plan.days:
        if day.weekday not in active_days:
            if day.exercises:
                raise ValueError("Dias de descanso não podem conter treino principal")
            continue

        warmups = [item for item in day.exercises if item.phase == "aquecimento"]
        mains = [item for item in day.exercises if item.phase == "principal"]
        stretches = [item for item in day.exercises if item.phase == "alongamento"]
        if not warmups or len(mains) < 4 or not stretches:
            raise ValueError("Cada treino precisa de aquecimento, 4 exercícios principais e alongamento")

        for item in day.exercises:
            exercise = by_id.get(item.exerciseId)
            if not exercise:
                raise ValueError("Plano contém exercício inexistente")
            if item.exerciseId in globally_used:
                raise ValueError("Exercício repetido durante a semana")
            exercise_name = normalized_name(exercise.name)
            if exercise_name in globally_used_names:
                raise ValueError("Exercício com nome repetido durante a semana")
            globally_used.add(item.exerciseId)
            globally_used_names.add(exercise_name)
            if item.phase == "aquecimento" and not exercise.is_warmup:
                raise ValueError("Item de aquecimento não é adequado para aquecer")
            if item.phase == "alongamento" and not exercise.is_stretch:
                raise ValueError("Item final não é um alongamento")
            if item.phase != "principal" and item.reserveExerciseIds:
                raise ValueError("Aquecimentos e alongamentos não usam reservas")
            if item.phase == "principal" and exercise.equipment not in allowed_main_equipment:
                raise ValueError("Exercício principal usa equipamento indisponível")
            if item.phase == "principal" and not item.reserveExerciseIds:
                raise ValueError("Exercício principal sem alternativa reserva")

            reserves: list[CatalogExercise] = []
            for reserve_id in item.reserveExerciseIds:
                reserve = by_id.get(reserve_id)
                if not reserve:
                    raise ValueError("Reserva inexistente")
                if reserve.is_warmup or reserve.is_stretch:
                    raise ValueError("Aquecimento ou alongamento não pode ser exercício reserva")
                if reserve.target_key != exercise.target_key:
                    raise ValueError(f"Reserva sem correlação anatômica exata: {exercise.target_key} != {reserve.target_key}")
                if reserve.equipment == exercise.equipment:
                    raise ValueError("Reserva deve oferecer equipamento diferente")
                if reserve_id in globally_used:
                    raise ValueError("Reserva repetida durante a semana")
                reserve_name = normalized_name(reserve.name)
                if reserve_name in globally_used_names:
                    raise ValueError("Reserva com nome repetido durante a semana")
                globally_used.add(reserve_id)
                globally_used_names.add(reserve_name)
                reserves.append(reserve)

            if item.phase == "principal" and exercise.equipment in FIXED_EQUIPMENT and not any(reserve.equipment in FREE_EQUIPMENT for reserve in reserves):
                raise ValueError("Exercício de máquina/cabo sem alternativa com peso livre")

        shoulder_day = any(by_id.get(item.exerciseId) and by_id[item.exerciseId].target_key.startswith("ombro_") for item in mains)
        if shoulder_day and not any(by_id.get(item.exerciseId) and by_id[item.exerciseId].target_key.startswith("manguito_rotador_") for item in warmups):
            raise ValueError("Treino de ombro sem aquecimento de manguito rotador")

    return plan
