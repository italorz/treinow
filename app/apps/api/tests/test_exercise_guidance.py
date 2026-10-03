from types import SimpleNamespace

from app.exercise_guidance import exercise_guidance


def exercise(key, **changes):
    values = dict(target_key=key, muscle_primary="ombro", is_stretch=False, is_warmup=False, classification={})
    return SimpleNamespace(**(values | changes))


def test_shoulder_cues_distinguish_compensation_from_diagnosis():
    result = exercise_guidance(exercise("ombro_cabeca_lateral"))
    assert "Encolher" in result["commonMistake"]
    assert "não um diagnóstico" in result["attention"]
    assert "sozinho" in result["sensation"]
    assert not result["general"]


def test_cuff_warmup_preserves_specific_rotation_cues():
    result = exercise_guidance(exercise("manguito_rotador_externo", is_warmup=True))
    assert "Rotação" in result["description"]
    assert "profissional" in result["attention"]


def test_stretch_does_not_use_strength_family_instructions():
    result = exercise_guidance(exercise("ombro_alongamento", is_stretch=True))
    assert "Alongamento" in result["description"]
    assert "sem forçar" in result["steps"][1]


def test_unknown_movement_is_explicitly_general():
    result = exercise_guidance(exercise("individual_unknown"))
    assert result["general"]
    assert "Orientação geral" in result["description"]
    assert "formigamento" in result["stop"]


def test_source_target_muscles_are_used_without_exposing_internal_keys():
    result = exercise_guidance(exercise("biceps_flexao", classification={"knowledge": {"targetMuscles": ["biceps", "antebraco"]}}))
    assert result["targetMuscles"] == ["bíceps", "antebraços"]
