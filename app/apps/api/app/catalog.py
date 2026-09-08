"""One catalog boundary for browsing, recommendations, media and planning."""
from .models import Exercise

CATALOG_VERSION = 'appdb-catalog-v2'
PLAN_CATALOG_TAG = ':appdb-v2'

def active_catalog():
    return Exercise.is_active.is_(True) & (Exercise.classification['source'].astext == CATALOG_VERSION)

def knowledge(exercise):
    return (exercise.classification or {}).get('knowledge', {})
