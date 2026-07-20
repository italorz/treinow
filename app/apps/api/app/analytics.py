from datetime import date as date_cls
from datetime import datetime, timedelta, timezone

import pandas as pd

from .numeric import js_round, round1


def _as_datetime(value) -> datetime | None:
    if value is None:
        return None
    dt = value if isinstance(value, datetime) else None
    if dt is None:
        try:
            dt = datetime.fromisoformat(str(value))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _week_start(dt: datetime) -> date_cls:
    day = dt.date()
    days_since_sunday = (day.weekday() + 1) % 7  # Python: segunda=0 ... JS getUTCDay: domingo=0
    return day - timedelta(days=days_since_sunday)


def _label(day: date_cls) -> str:
    return day.strftime("%d/%m")


def aggregate_progress(logs: list[dict], measurements: list[dict], training_days_per_week: int = 3) -> dict:
    """Agrega logs de treino e medidas em métricas de progresso para o painel
    do personal. Volume semanal e contagem de sessões usam pandas (groupby por
    semana) porque é uma agregação por período de tempo — o mesmo tipo de
    operação para o qual pandas existe; recordes pessoais dependem da ordem
    de chegada dos logs, então continuam num loop simples e sequencial."""
    rows: list[dict] = []
    exercise_records: dict[str, float] = {}
    personal_records = 0

    for log in logs:
        completed_at = _as_datetime(log.get("completedAt"))
        if completed_at is None:
            continue
        sets = max(0.0, float(log.get("sets") or 0))
        reps = max(0.0, float(log.get("reps") or 0))
        load = max(0.0, float(log.get("loadKg") or 0))
        volume = sets * reps * load
        exercise_id = str(log.get("exerciseId") or "unknown")
        previous_record = exercise_records.get(exercise_id, -1.0)
        if load > previous_record:
            personal_records += 1
            exercise_records[exercise_id] = load
        rows.append({"day": completed_at.date(), "week": _week_start(completed_at), "volume": volume})

    total_volume_kg = round1(sum(row["volume"] for row in rows))

    if rows:
        logs_df = pd.DataFrame(rows)
        weekly = (
            logs_df.groupby("week")
            .agg(volume_kg=("volume", "sum"), sessions=("day", "nunique"))
            .reset_index()
            .sort_values("week")
        )
        weekly_volume = [
            {"week": _label(row.week), "volumeKg": round1(row.volume_kg), "sessions": int(row.sessions)}
            for row in weekly.tail(16).itertuples()
        ]
        completed_days_count = int(logs_df["day"].nunique())
    else:
        weekly_volume = []
        completed_days_count = 0

    dated_measurements = sorted(
        (m for m in ({**item, "date": _as_datetime(item.get("measuredAt"))} for item in measurements) if m["date"] is not None),
        key=lambda m: m["date"],
    )
    weight_trend = [
        {"date": _label(m["date"].date()), "weightKg": round1(float(m["weightKg"]))}
        for m in dated_measurements if m.get("weightKg") is not None and pd.notna(m.get("weightKg"))
    ][-24:]
    bmi_trend = [
        {"date": _label(m["date"].date()), "bmi": round1(float(m["bmi"]))}
        for m in dated_measurements if m.get("bmi") is not None and pd.notna(m.get("bmi"))
    ][-24:]

    expected_sessions = max(1, min(7, training_days_per_week)) * 4
    adherence_percent = min(100, js_round((completed_days_count / expected_sessions) * 100))

    return {
        "adherencePercent": adherence_percent,
        "totalVolumeKg": total_volume_kg,
        "personalRecords": personal_records,
        "weeklyVolume": weekly_volume,
        "weightTrend": weight_trend,
        "bmiTrend": bmi_trend,
        "computedAt": datetime.now(timezone.utc).isoformat(),
    }
