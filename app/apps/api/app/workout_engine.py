import json
import math
import re
import uuid
from dataclasses import dataclass

from google import genai
from google.genai import types as genai_types
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import config
from .models import AnalyticsSnapshot, Exercise, Profile, WorkoutLog
from .numeric import js_round
from .plan import CatalogExercise, PlanDay, PlanItem, WorkoutPlan, normalized_name, validate_plan
from .privacy import safe_prompt_profile

FREE_EQUIPMENT = {"halter", "anilha", "barra", "peso_corporal", "elastico"}
FIXED_EQUIPMENT = {"maquina", "cabo", "smith"}


@dataclass
class GeneratedPlan:
    plan: WorkoutPlan
    source: str
    provider_failures: list[str] | None = None


class PlanGenerationError(Exception):
    pass


async def generate_plan(db: AsyncSession, student_id: str) -> GeneratedPlan:
    profile = (await db.execute(select(Profile).where(Profile.student_id == uuid.UUID(student_id)))).scalar_one_or_none()
    if not profile:
        raise PlanGenerationError("Meta não configurada")

    injuries = profile.injuries or []
    if any(injury.get("status") == "dor_aguda" or (injury.get("severity") == "grave" and not injury.get("medicallyCleared")) for injury in injuries):
        raise PlanGenerationError("Geração bloqueada: lesão aguda ou grave sem liberação")

    regions = [injury["region"] for injury in injuries]
    query = select(Exercise).where(Exercise.needs_review.is_(False))
    if regions:
        query = query.where(~Exercise.contraindications.overlap(regions))
    rows = (await db.execute(query)).scalars().all()
    all_exercises = [_to_catalog_exercise(row) for row in rows]
    if not all_exercises:
        raise PlanGenerationError("Catálogo compatível vazio")

    recent_cutoff = _now_minus_days(8)
    recent_logs = (
        await db.execute(select(WorkoutLog.exercise_id).where(WorkoutLog.student_id == uuid.UUID(student_id), WorkoutLog.completed_at >= recent_cutoff))
    ).scalars().all()
    recent_exercise_ids = {str(exercise_id) for exercise_id in recent_logs}

    if config.PLAN_ENGINE == "gemini" and config.GEMINI_API_KEY:
        # balanced_catalog() so limita o tamanho do payload enviado a IA; o
        # motor de regras usa o catalogo completo, senao a mesma reducao cria
        # escassez artificial e esgota o catalogo em semanas de 7 dias com
        # treinos longos (motivo do bug "sem 4 exercicios principais").
        snapshot = (
            await db.execute(select(AnalyticsSnapshot).where(AnalyticsSnapshot.student_id == uuid.UUID(student_id)))
        ).scalar_one_or_none()
        progress = _snapshot_dict(snapshot) if snapshot else {}
        attempt = await gemini_plan(profile, balanced_catalog(all_exercises), progress, recent_exercise_ids)
        if attempt is not None and not isinstance(attempt, list):
            return attempt
        failures = attempt if isinstance(attempt, list) else []
        return GeneratedPlan(plan=rules_plan(profile, all_exercises, recent_exercise_ids), source="rules-engine", provider_failures=failures)
    return GeneratedPlan(plan=rules_plan(profile, all_exercises, recent_exercise_ids), source="rules-engine")


def _to_catalog_exercise(row: Exercise) -> CatalogExercise:
    return CatalogExercise(
        id=str(row.id), name=row.name, muscle_primary=row.muscle_primary, equipment=row.equipment,
        target_key=row.target_key, is_warmup=row.is_warmup, is_stretch=row.is_stretch,
        complexity=row.complexity, joints=row.joints or [],
    )


def _now_minus_days(days: int):
    from datetime import UTC, datetime, timedelta

    return datetime.now(UTC) - timedelta(days=days)


def _snapshot_dict(snapshot: AnalyticsSnapshot) -> dict:
    return {
        "adherencePercent": snapshot.adherence_percent, "totalVolumeKg": snapshot.total_volume_kg,
        "personalRecords": snapshot.personal_records, "weeklyVolume": snapshot.weekly_volume,
        "weightTrend": snapshot.weight_trend, "bmiTrend": snapshot.bmi_trend,
    }


# ---------------------------------------------------------------------------
# Motor de regras: monta a semana só com o perfil da tela de Meta, sem IA.
# ---------------------------------------------------------------------------

LEG_MUSCLES = {"pernas", "gluteos", "panturrilha"}
ARM_MUSCLES = {"biceps", "triceps", "antebraco"}
HEAVY_LEG_PATTERN = re.compile(r"leg ?press|agachamento|afundo|avanç|bulgaro|búlgaro|salto|jump|hack|stiff|terra|pistol", re.IGNORECASE)
OVERHEAD_PATTERN = re.compile(r"desenvolvimento|militar|arnold|overhead", re.IGNORECASE)
SPINE_PATTERN = re.compile(r"terra|deadlift|good ?morning|curvad|superman", re.IGNORECASE)


def allowed_by_injury(exercise: CatalogExercise, regions: set[str]) -> bool:
    complexity = exercise.complexity
    if (regions & {"joelho", "tornozelo", "quadril"}) and exercise.muscle_primary in LEG_MUSCLES:
        if HEAVY_LEG_PATTERN.search(exercise.name):
            return False
        if exercise.equipment in ("maquina", "smith", "barra") and exercise.muscle_primary != "panturrilha":
            return False
        if complexity == "avancado":
            return False
    if "ombro" in regions and exercise.muscle_primary == "ombro":
        if exercise.equipment == "barra" and OVERHEAD_PATTERN.search(exercise.name):
            return False
        if complexity == "avancado":
            return False
    if (regions & {"cotovelo", "punho"}) and exercise.muscle_primary in ARM_MUSCLES and exercise.equipment == "barra":
        return False
    if "coluna_lombar" in regions and SPINE_PATTERN.search(exercise.name):
        return False
    return True


@dataclass
class Dose:
    sets: int
    reps: str
    rest: int


_GOAL_BASE = {
    "mais_forte": Dose(4, "6-10", 90),
    "mais_bonito": Dose(3, "8-12", 60),
    "mais_leve": Dose(3, "12-15", 45),
    "menos_estressado": Dose(2, "10-15", 60),
}


def dose(profile: Profile) -> Dose:
    base = _GOAL_BASE.get(profile.goal, Dose(3, "10-15", 45))
    sets, rest = base.sets, base.rest
    if profile.intensity == "leve":
        sets, rest = max(2, sets - 1), rest + 15
    if profile.intensity == "intensa":
        sets, rest = min(5, sets + 1), max(30, rest - 15)
    if profile.level == "iniciante":
        sets = min(sets, 3)
    return Dose(sets, base.reps, rest)


@dataclass
class SplitDay:
    title: str
    muscles: list[str]


def split_for(days_count: int) -> list[SplitDay]:
    push = SplitDay("Peito, ombros e tríceps", ["peitoral", "ombro", "triceps"])
    pull = SplitDay("Costas e bíceps", ["costas", "biceps", "trapezio", "antebraco"])
    legs = SplitDay("Pernas e core", ["pernas", "gluteos", "panturrilha", "core"])
    splits: dict[int, list[SplitDay]] = {
        1: [SplitDay("Corpo inteiro", ["peitoral", "costas", "pernas", "ombro", "core"])],
        2: [
            SplitDay("Superiores", ["peitoral", "costas", "ombro", "biceps", "triceps"]),
            SplitDay("Inferiores e core", ["pernas", "gluteos", "panturrilha", "core"]),
        ],
        3: [push, pull, legs],
        4: [
            SplitDay("Peito e tríceps", ["peitoral", "triceps"]),
            SplitDay("Costas e bíceps", ["costas", "biceps", "trapezio"]),
            SplitDay("Pernas completas", ["pernas", "gluteos", "panturrilha"]),
            SplitDay("Ombros e core", ["ombro", "core", "antebraco"]),
        ],
        5: [
            SplitDay("Peito", ["peitoral", "triceps"]),
            SplitDay("Costas", ["costas", "biceps"]),
            legs,
            SplitDay("Ombros e trapézio", ["ombro", "trapezio"]),
            SplitDay("Braços e core", ["biceps", "triceps", "antebraco", "core"]),
        ],
        6: [push, pull, legs, push, pull, legs],
        7: [push, pull, legs, push, pull, legs, SplitDay("Mobilidade e core", ["core", "panturrilha", "antebraco"])],
    }
    chosen = splits.get(min(max(days_count, 1), 7), [SplitDay("Corpo inteiro", ["peitoral", "costas", "pernas", "ombro", "core"])])
    return [SplitDay(day.title, list(day.muscles)) for day in chosen]


def rules_plan(profile: Profile, catalog: list[CatalogExercise], recent_exercise_ids: set[str] | None = None) -> WorkoutPlan:
    recent_exercise_ids = recent_exercise_ids or set()
    active_days = sorted(set(profile.training_days or []))
    available = set((profile.equipment or [])) | {"peso_corporal"}
    priorities = list(profile.priority_muscles or [])
    regions = {injury["region"] for injury in (profile.injuries or [])}
    dosage = dose(profile)
    mains_target = min(7, max(4, js_round((profile.duration_minutes or 45) / 12)))

    def safe(exercise: CatalogExercise) -> bool:
        return allowed_by_injury(exercise, regions) and not (profile.level == "iniciante" and exercise.complexity == "avancado")

    used: set[str] = set()
    used_names: set[str] = set()

    def mark(exercise: CatalogExercise) -> None:
        used.add(exercise.id)
        used_names.add(normalized_name(exercise.name))

    def unused(exercise: CatalogExercise) -> bool:
        return exercise.id not in used and normalized_name(exercise.name) not in used_names

    def is_main_candidate(exercise: CatalogExercise, allow_recent: bool = False) -> bool:
        return (
            not exercise.is_warmup and not exercise.is_stretch
            and (allow_recent or exercise.id not in recent_exercise_ids)
            and exercise.equipment in available and safe(exercise) and unused(exercise)
        )

    template = split_for(len(active_days) or 1)
    for i, muscle in enumerate(priorities):
        if not any(muscle in day.muscles for day in template):
            template[i % len(template)].muscles.append(muscle)

    days: list[PlanDay] = []
    for weekday in range(7):
        if weekday not in active_days:
            days.append(PlanDay(weekday=weekday, title="Descanso", focusMuscles=[], exercises=[]))
            continue
        slot = template[active_days.index(weekday) % len(template)]
        muscle_order = list(dict.fromkeys([m for m in priorities if m in slot.muscles] + slot.muscles))
        remaining_days = len(active_days) - active_days.index(weekday)

        def unique_names(pool: list[CatalogExercise]) -> int:
            return len({normalized_name(e.name) for e in pool})

        main_pool_names = unique_names([e for e in catalog if is_main_candidate(e)])
        day_target = max(4, min(mains_target, math.floor(main_pool_names / (remaining_days * 1.3))))

        picked: list[tuple[CatalogExercise, list[CatalogExercise]]] = []

        def pick_for(muscle: str | None, allow_recent: bool = False) -> bool:
            for candidate in catalog:
                if muscle and candidate.muscle_primary != muscle:
                    continue
                if not is_main_candidate(candidate, allow_recent):
                    continue
                reserves = find_reserves(candidate, catalog, used, used_names, safe, available, recent_exercise_ids)
                if not reserves:
                    continue
                mark(candidate)
                for reserve in reserves:
                    mark(reserve)
                picked.append((candidate, reserves))
                return True
            return False

        def fill_rounds(muscles: list[str | None], allow_recent: bool, target: int) -> None:
            round_index = 0
            while round_index < target and len(picked) < target:
                progressed = False
                for muscle in muscles:
                    if len(picked) >= target:
                        break
                    progressed = pick_for(muscle, allow_recent) or progressed
                if not progressed:
                    break
                round_index += 1

        # Escalada determinística: cada estágio afrouxa uma restrição só quando
        # o estágio anterior não bastou, sem depender de IA para preencher o
        # dia. Isso evita a falha "sem 4 exercícios principais" quando o aluno
        # já tem muitos treinos recentes e/ou pouco equipamento disponível.
        fill_rounds(muscle_order, allow_recent=False, target=day_target)  # 1) grupos prioritários, sem repetir treino recente
        if len(picked) < day_target:
            fill_rounds(muscle_order, allow_recent=True, target=day_target)  # 2) mesmos grupos, aceitando repetir treino recente
        if len(picked) < 4:
            fill_rounds([None], allow_recent=False, target=4)  # 3) qualquer grupo muscular, sem repetir treino recente
        if len(picked) < 4:
            fill_rounds([None], allow_recent=True, target=4)  # 4) qualquer grupo muscular, aceitando repetir treino recente

        focus = list(dict.fromkeys(exercise.muscle_primary for exercise, _ in picked))[:3]
        shoulder_day = any(exercise.target_key.startswith("ombro_") for exercise, _ in picked)

        def is_cuff(e: CatalogExercise) -> bool:
            return e.target_key.startswith("manguito_rotador_")

        warm_pool = [e for e in catalog if e.is_warmup and safe(e) and unused(e)]
        if not warm_pool:
            # Ultimo recurso: sem opcao seguindo o filtro de lesao mas ainda
            # inedita na semana (nunca repete exercicio) - melhor aquecer com
            # algo fora da preferencia de lesao do que nao ter aquecimento.
            warm_pool = [e for e in catalog if e.is_warmup and unused(e)]
        warm_take = 2 if unique_names(warm_pool) >= remaining_days * 2 else 1
        warmups: list[CatalogExercise] = []
        if shoulder_day:
            cuff_pool = [e for e in warm_pool if is_cuff(e)]
            if not cuff_pool:
                # Mesmo raciocinio do warm_pool: sem manguito seguro e inedito
                # sobrando, aceita qualquer manguito ainda nao usado na semana
                # em vez de deixar o dia de ombro sem esse aquecimento.
                cuff_pool = [e for e in catalog if e.is_warmup and is_cuff(e) and unused(e)]
            warmups.extend(unique_by_name(cuff_pool, used_names, 1))
            for exercise in warmups:
                mark(exercise)
        non_cuff_pool = [e for e in warm_pool if not is_cuff(e) and unused(e)]
        ordered_warmups = (
            [e for e in non_cuff_pool if not e.is_stretch and e.muscle_primary in focus]
            + [e for e in non_cuff_pool if not e.is_stretch]
            + non_cuff_pool
        )
        extra_warmups = unique_by_name(ordered_warmups, used_names, max(warm_take - len(warmups), 0 if warmups else 1))
        if not extra_warmups and not warmups:
            # Nao sobrou nenhum aquecimento "nao-manguito" inedito: aceita
            # qualquer aquecimento restante do warm_pool, cuff ou nao, para
            # garantir pelo menos 1 aquecimento no dia.
            extra_warmups = unique_by_name(warm_pool, used_names, 1)
        for exercise in extra_warmups:
            mark(exercise)
        warmups.extend(extra_warmups)

        stretch_pool = sorted(
            [e for e in catalog if e.is_stretch and safe(e) and unused(e)],
            key=lambda e: e.muscle_primary in focus, reverse=True,
        )
        if not stretch_pool:
            # Mesmo ultimo recurso do aquecimento: aceita alongamento fora do
            # filtro de lesao, ainda inedito na semana, em vez de dia sem
            # alongamento nenhum.
            stretch_pool = [e for e in catalog if e.is_stretch and unused(e)]
        stretch_take = 2 if unique_names(stretch_pool) >= remaining_days * 2 else 1
        stretches = unique_by_name(stretch_pool, used_names, stretch_take)
        for exercise in stretches:
            mark(exercise)

        exercises = (
            [PlanItem(exerciseId=e.id, phase="alongamento", sets=2, reps="30s", restSeconds=20, reserveExerciseIds=[]) for e in stretches]
            + [PlanItem(exerciseId=e.id, phase="aquecimento", sets=2, reps="12-15", restSeconds=30, reserveExerciseIds=[]) for e in warmups]
            + [
                PlanItem(exerciseId=exercise.id, phase="principal", sets=dosage.sets, reps=dosage.reps, restSeconds=dosage.rest, reserveExerciseIds=[r.id for r in reserves])
                for exercise, reserves in picked
            ]
        )
        days.append(PlanDay(weekday=weekday, title=slot.title, focusMuscles=focus, exercises=exercises))

    plan = WorkoutPlan(days=days)
    return validate_plan(plan, catalog, active_days, list(available))


def find_reserves(
    exercise: CatalogExercise, catalog: list[CatalogExercise], used: set[str], used_names: set[str],
    safe, available: set[str], recent_exercise_ids: set[str] | None = None,
) -> list[CatalogExercise]:
    recent_exercise_ids = recent_exercise_ids or set()
    eligible = [
        reserve for reserve in catalog
        if reserve.id not in used and normalized_name(reserve.name) not in used_names
        and not reserve.is_warmup and not reserve.is_stretch and safe(reserve)
        and reserve.target_key == exercise.target_key and reserve.equipment != exercise.equipment
        and (exercise.equipment not in FIXED_EQUIPMENT or reserve.equipment in FREE_EQUIPMENT)
    ]
    eligible.sort(key=lambda r: (r.id in recent_exercise_ids, r.equipment in available, r.equipment in FREE_EQUIPMENT), reverse=True)
    reserves: list[CatalogExercise] = []
    names: set[str] = set()
    for reserve in eligible:
        name = normalized_name(reserve.name)
        if name in names:
            continue
        reserves.append(reserve)
        names.add(name)
        if len(reserves) == 2:
            break
    return reserves


def balanced_catalog(exercises: list[CatalogExercise]) -> list[CatalogExercise]:
    buckets: dict[str, list[CatalogExercise]] = {}
    for exercise in exercises:
        key = f"{exercise.target_key}:{exercise.equipment}:{exercise.is_warmup}:{exercise.is_stretch}"
        bucket = buckets.setdefault(key, [])
        if len(bucket) < 2:
            bucket.append(exercise)
    flat = [exercise for bucket in buckets.values() for exercise in bucket]
    return flat[:360]


def unique_by_name(exercises: list[CatalogExercise], used_names: set[str], limit: int) -> list[CatalogExercise]:
    selected: list[CatalogExercise] = []
    names = set(used_names)
    for exercise in exercises:
        name = normalized_name(exercise.name)
        if name in names:
            continue
        selected.append(exercise)
        names.add(name)
        if len(selected) == limit:
            break
    return selected


# ---------------------------------------------------------------------------
# Caminho opcional via Gemini (PLAN_ENGINE=gemini). O motor de regras continua
# como fallback obrigatório.
# ---------------------------------------------------------------------------

GEMINI_PLAN_SCHEMA = {
    "type": "OBJECT",
    "required": ["days"],
    "properties": {
        "days": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "required": ["weekday", "title", "focusMuscles", "exercises"],
                "properties": {
                    "weekday": {"type": "INTEGER"},
                    "title": {"type": "STRING"},
                    "focusMuscles": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "exercises": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "required": ["exerciseId", "phase", "sets", "reps", "restSeconds", "reserveExerciseIds"],
                            "properties": {
                                "exerciseId": {"type": "STRING"},
                                "phase": {"type": "STRING", "enum": ["aquecimento", "principal", "alongamento"]},
                                "sets": {"type": "INTEGER"},
                                "reps": {"type": "STRING"},
                                "restSeconds": {"type": "INTEGER"},
                                "reserveExerciseIds": {"type": "ARRAY", "items": {"type": "STRING"}},
                            },
                        },
                    },
                },
            },
        }
    },
}


async def gemini_plan(profile: Profile, catalog: list[CatalogExercise], progress: dict, recent_exercise_ids: set[str] | None = None):
    recent_exercise_ids = recent_exercise_ids or set()
    available = profile.equipment or ["peso_corporal"]
    payload = safe_prompt_profile(_profile_dict(profile), progress)
    compact_catalog = [
        {
            "id": exercise.id, "nome": exercise.name, "musculo": exercise.muscle_primary, "alvo_exato": exercise.target_key,
            "equipamento": exercise.equipment, "disponivel": exercise.equipment in available or exercise.equipment == "peso_corporal",
            "feito_ultima_semana": exercise.id in recent_exercise_ids, "aquecimento": exercise.is_warmup,
            "alongamento": exercise.is_stretch, "articulacoes": exercise.joints,
        }
        for exercise in catalog
    ]
    prompt = f"""Você é um treinador especialista em biomecânica. Gere uma semana completa usando SOMENTE os IDs fornecidos.

REGRAS OBRIGATÓRIAS:
1. Retorne exatamente os 7 weekdays (0=domingo a 6=sábado). Somente os dias {json.dumps(profile.training_days)} têm treino; os demais têm exercises=[].
2. Cada dia de treino deve vir nesta ordem: 1-2 itens phase="alongamento", 2-3 itens phase="aquecimento" e 4-7 itens phase="principal".
3. Todo exercício principal deve usar equipamento com disponivel=true e ter de 1 a 3 reserveExerciseIds.
4. Cada reserva deve ter o MESMO alvo_exato do principal, mas equipamento diferente. Nunca troque cabeça lateral do ombro por cabeça anterior/posterior. Elevação lateral só aceita reserva de alvo ombro_cabeca_lateral; elevação frontal nunca é equivalente.
5. Para exercícios de máquina, cabo ou smith, inclua ao menos uma reserva do mesmo alvo_exato com halter, anilha, barra, elástico ou peso corporal.
6. Nenhum ID pode se repetir na semana inteira, nem como principal, aquecimento, alongamento ou reserva.
7. Dia com ombros exige aquecimento do manguito rotador (alvo_exato começando por manguito_rotador_).
8. Alongamentos devem ter alongamento=true; aquecimentos devem ter aquecimento=true.
9. Personalize volume, repetições, descanso e seleção principalmente para goal, priorityMuscles, intensity, level, durationMinutes e equipment. Use progressSummary para progressão gradual, sem saltos bruscos.
10. Nunca escolha como principal um item feito_ultima_semana=true. Mantenha o mesmo foco muscular com exercícios novos; esses itens podem aparecer como reserva anatomicamente equivalente.
11. Respeite lesões e recuperação. Não diagnostique, não invente IDs e escreva títulos em português.

Perfil desidentificado: {json.dumps(payload)}
Catálogo: {json.dumps(compact_catalog)}"""

    client = genai.Client(api_key=config.GEMINI_API_KEY)
    models = list(dict.fromkeys([config.GEMINI_PLAN_MODEL, config.GEMINI_FALLBACK_MODEL, "gemini-2.5-flash"]))
    failures: list[str] = []
    for model in models:
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=f"{prompt}\nConfira todas as regras antes de responder.",
                config=genai_types.GenerateContentConfig(
                    temperature=0.2, response_mime_type="application/json", response_json_schema=GEMINI_PLAN_SCHEMA,
                ),
            )
            parsed = WorkoutPlan.model_validate(json.loads(response.text or "{}"))
            validated = validate_plan(parsed, catalog, profile.training_days, available)
            return GeneratedPlan(plan=validated, source=f"gemini:{model}")
        except Exception as error:  # noqa: BLE001 - qualquer falha do provedor cai para o próximo modelo
            failures.append(f"{model}: {str(error)[:240]}")
    return failures


def _profile_dict(profile: Profile) -> dict:
    return {
        "goal": profile.goal, "level": profile.level, "trainingDays": profile.training_days,
        "durationMinutes": profile.duration_minutes, "location": profile.location, "equipment": profile.equipment,
        "weightKg": profile.weight_kg, "heightCm": profile.height_cm, "bmi": profile.bmi, "age": profile.age,
        "sex": profile.sex, "priorityMuscles": profile.priority_muscles, "intensity": profile.intensity,
        "injuries": profile.injuries,
    }
