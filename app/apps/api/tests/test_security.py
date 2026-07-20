from app.security import hash_password, media_signature, verify_password


def test_password_hash_roundtrip():
    stored = hash_password("uma-senha-bem-forte-123")
    assert verify_password("uma-senha-bem-forte-123", stored)
    assert not verify_password("senha-errada", stored)


def test_password_hash_is_salted():
    assert hash_password("mesma-senha-123456") != hash_password("mesma-senha-123456")


def test_media_signature_is_deterministic_for_same_inputs():
    assert media_signature("exercise-1", 12345) == media_signature("exercise-1", 12345)
    assert media_signature("exercise-1", 12345) != media_signature("exercise-2", 12345)
