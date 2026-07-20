import json

from app.privacy import safe_prompt_profile


def test_strips_identifiers_photo_and_video_from_prompt():
    result = safe_prompt_profile({
        "name": "Pessoa", "email": "secret@example.com", "tenantId": "tenant", "photo": "bytes", "video": "bytes",
        "goal": "ganhar_massa", "weightKg": 80, "injuries": [{"region": "joelho"}],
    })
    assert result == {"goal": "ganhar_massa", "weightKg": 80, "injuries": [{"region": "joelho"}], "progressSummary": {}}
    dumped = json.dumps(result)
    for leaked in ("secret", "tenant", "photo", "video", "Pessoa"):
        assert leaked not in dumped
