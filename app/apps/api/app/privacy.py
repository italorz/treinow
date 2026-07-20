ALLOWED_PROFILE_FIELDS = [
    "goal", "level", "trainingDays", "durationMinutes", "location", "equipment",
    "weightKg", "heightCm", "bmi", "age", "sex", "priorityMuscles", "intensity", "injuries",
]


def safe_prompt_profile(meta: dict, progress: dict | None = None) -> dict:
    payload = {key: meta[key] for key in ALLOWED_PROFILE_FIELDS if key in meta}
    payload["progressSummary"] = progress or {}
    return payload
