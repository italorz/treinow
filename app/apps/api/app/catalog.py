"""One catalog boundary for browsing, recommendations, media and planning."""
from .models import Exercise
from .plan import CatalogExercise

CATALOG_VERSION = 'appdb-catalog-v2'
PLAN_CATALOG_TAG = ':appdb-v2'

def active_catalog():
    return Exercise.is_active.is_(True) & (Exercise.classification['source'].astext == CATALOG_VERSION)

def preferred_video_variant(sex: str | None) -> str | None:
    return sex if sex in ('masculino', 'feminino') else None

def profile_catalog(sex: str | None):
    preferred = preferred_video_variant(sex)
    return active_catalog() & Exercise.video['variants'].has_key(preferred) if preferred else active_catalog()

def knowledge(exercise):
    return (exercise.classification or {}).get('knowledge', {})

def planning_exercise(row: Exercise) -> CatalogExercise:
    info = knowledge(row)
    return CatalogExercise(
        id=str(row.id), name=row.name, name_raw=row.name_raw, muscle_primary=row.muscle_primary, equipment=row.equipment,
        target_key=row.target_key, is_warmup=row.is_warmup, is_stretch=row.is_stretch,
        complexity=row.complexity, joints=row.joints or [],
        required_equipment=info.get('equipment', {}).get('required', []),
        target_muscles=info.get('targetMuscles', []), exercise_type=info.get('exerciseType', 'Strength'),
        source_scores=info.get('sourceScores', {}), measurement=info.get('measurement', {}),
        video_variants=list((row.video or {}).get('variants', {})),
        # Imported joint-based flags describe involvement, not reviewed clinical exclusions.
        contraindications=[] if 'contraindications' in (row.classification or {}).get('derivedFields', []) else row.contraindications or [],
    )
