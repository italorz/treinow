import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Exercise


def _exercise(slug: str) -> Exercise:
    return Exercise(
        id=uuid.uuid4(), slug=slug, name="Exercício de teste", name_raw="Exercicio de teste",
        muscle_primary="core", equipment="peso_corporal", complexity="iniciante", movement_pattern="core",
        target_key="core_teste", video={"fileName": "x.mp4", "objectKey": "exercises/x.mp4"},
    )


@pytest.mark.asyncio
async def test_exercise_slug_uniqueness_is_enforced_by_the_database(db_session):
    db_session.add(_exercise("slug-unico-teste"))
    await db_session.commit()

    db_session.add(_exercise("slug-unico-teste"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
