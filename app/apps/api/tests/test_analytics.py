from app.analytics import aggregate_progress


def test_generates_volume_weight_bmi_adherence_and_records_series():
    result = aggregate_progress(
        [
            {"exerciseId": "a", "completedAt": "2026-07-06T10:00:00Z", "sets": 3, "reps": 10, "loadKg": 20},
            {"exerciseId": "a", "completedAt": "2026-07-08T10:00:00Z", "sets": 3, "reps": 10, "loadKg": 25},
        ],
        [{"measuredAt": "2026-07-08T10:00:00Z", "weightKg": 75, "bmi": 24.5}],
        3,
    )

    assert result["totalVolumeKg"] == 1350
    assert result["adherencePercent"] == 17
    assert result["personalRecords"] == 2
    assert result["weeklyVolume"][0]["volumeKg"] == 1350
    assert result["weeklyVolume"][0]["sessions"] == 2
    assert result["weightTrend"][0]["weightKg"] == 75
    assert result["bmiTrend"][0]["bmi"] == 24.5


def test_accepts_empty_history():
    result = aggregate_progress([], [])
    assert result["adherencePercent"] == 0
    assert result["totalVolumeKg"] == 0
    assert result["personalRecords"] == 0
    assert result["weeklyVolume"] == []
    assert result["weightTrend"] == []
    assert result["bmiTrend"] == []
