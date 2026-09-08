import copy
import hashlib
import json
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.requests import Request

from app import worker
from app.catalog import CATALOG_VERSION, PLAN_CATALOG_TAG
from app.models import Exercise, User, WorkoutPlan, WorkoutSession, WorkoutLog, Profile, Measurement, AnalyticsSnapshot
from app.routers.exercises import list_exercises, muscle_summary, _require_exercise, get_media, get_video_url
from app.routers.workouts import _resolve_plan_day
from app.security import SessionUser, media_signature


def item(slug):
    video={'fileName':'new.mp4','objectKey':'exercises/new.mp4','sha256':hashlib.sha256(b'new-video').hexdigest()}
    return {'slug':slug,'name':'New exercise','musclePrimary':'peitoral','secondaryMuscles':['triceps'],
            'equipment':'halter','targetKey':'peitoral_press_horizontal','searchTokens':['new','exercise'],
            'classification':{'source':CATALOG_VERSION,'knowledge':{'targetMuscles':['peitoral','ombro']}},
            'video':{**video,'variants':{'masculino':video,'feminino':{**video,'fileName':'female.mp4','objectKey':'exercises/female.mp4'}}}}


class Storage:
    def __init__(self): self.objects={'legacy/old.webm':12,'keep.txt':4}
    async def head_object(self, Bucket, Key):
        if Key not in self.objects: raise ClientError({'Error':{'Code':'404'}},'HeadObject')
        return {'ContentLength':self.objects[Key]}
    async def upload_file(self, filename, bucket, key, ExtraArgs):
        from pathlib import Path
        self.objects[key]=Path(filename).stat().st_size
    async def list_objects_v2(self, **kwargs):
        return {'Contents':[{'Key':key} for key in self.objects], 'IsTruncated':False}
    async def delete_objects(self, Bucket, Delete):
        for item in Delete['Objects']: self.objects.pop(item['Key'],None)


@pytest.mark.asyncio
async def test_rollout_purges_legacy_dependencies_preserves_profiles_and_is_idempotent(engine, tmp_path, monkeypatch):
    factory=async_sessionmaker(engine,expire_on_commit=False)
    slug=f'new-{uuid.uuid4()}'
    data=item(slug)
    path=tmp_path/'catalog.json'
    path.write_text(json.dumps([data]),encoding='utf-8')
    (tmp_path/'new.mp4').write_bytes(b'new-video')
    (tmp_path/'female.mp4').write_bytes(b'new-video')
    store=Storage()
    @asynccontextmanager
    async def storage(): yield store
    monkeypatch.setattr(worker,'AsyncSessionLocal',factory)
    monkeypatch.setattr(worker,'CATALOG_PATH',path)
    monkeypatch.setattr(worker,'VIDEOS_DIR',tmp_path)
    monkeypatch.setattr(worker,'s3_client',storage)
    queue=AsyncMock()
    async with factory() as db:
        old=Exercise(slug=f'old-{uuid.uuid4()}',**worker._exercise_values(data))
        old.classification={'source':'codex-curated-rules-v2'}
        user=User(name='Catalog test',email=f'{uuid.uuid4()}@example.test',password_hash='unused',role='student')
        db.add_all([old,user]);await db.flush()
        old_plan=WorkoutPlan(student_id=user.id,version=7,active=True,source='rules-engine',days=[{'weekday':1,'exercises':[{'exerciseId':str(old.id),'phase':'principal'}]}])
        db.add(old_plan)
        session=WorkoutSession(student_id=user.id,workout_date=date.today(),selections={'old':str(old.id)},missing_exercise_ids=[str(old.id)])
        profile=Profile(student_id=user.id,goal='mais_forte',level='iniciante',training_days=[1,3,5],duration_minutes=45,location='academia',equipment=['halter'],weight_kg=75,height_cm=175,age=30,sex='masculino',intensity='moderada',bmi=24.5)
        measure=Measurement(student_id=user.id,measured_at=datetime.now(timezone.utc),weight_kg=75,height_cm=175,bmi=24.5)
        snapshot=AnalyticsSnapshot(student_id=user.id,adherence_percent=50,total_volume_kg=300,personal_records=1)
        db.add_all([session,profile,measure,snapshot]);await db.flush()
        log=WorkoutLog(student_id=user.id,exercise_id=old.id,session_id=session.id,sets=3,reps=10,load_kg=10,completed_at=datetime.now(timezone.utc))
        db.add(log);await db.commit()
        old_id, user_id=old.id,user.id
    broken=copy.deepcopy(data);broken['video']['variants']['feminino']['fileName']='missing.mp4'
    path.write_text(json.dumps([broken]),encoding='utf-8')
    with pytest.raises(ValueError,match='Missing catalog video'): await worker.import_catalog({'redis':queue})
    async with factory() as db:
        assert await db.get(Exercise,old_id) is not None
        assert await db.get(WorkoutLog,log.id) is not None
    path.write_text(json.dumps([data]),encoding='utf-8')
    result=await worker.import_catalog({'redis':queue})
    assert result['active']==1 and result['verifiedVideos']==2
    assert result['deletedExercises']==1 and result['deletedPlans']==1
    assert result['deletedSessions']==1 and result['deletedLogs']==1 and result['retired']==0
    assert result['deletedVideoObjects']==1 and 'legacy/old.webm' not in store.objects and 'keep.txt' in store.objects
    queue.enqueue_job.assert_any_await('generate_workout',str(user_id),_job_id=f'catalog-plan-v2:{user_id}')
    async with factory() as db:
        legacy=await db.get(Exercise,old_id)
        assert legacy is None
        assert await db.get(WorkoutPlan,old_plan.id) is None
        assert await db.get(WorkoutSession,session.id) is None
        assert await db.get(WorkoutLog,log.id) is None
        assert await db.get(AnalyticsSnapshot,snapshot.id) is None
        assert await db.get(Profile,profile.id) is not None
        assert await db.get(User,user_id) is not None
        assert await db.get(Measurement,measure.id) is not None
        assert await _resolve_plan_day(db,str(user_id),1) is None
        with pytest.raises(HTTPException) as error: await _require_exercise(db,str(old_id))
        assert error.value.status_code==404
        request=Request({'type':'http','query_string':b'search=new+exercise&muscle=ombro','headers':[]})
        listing=await list_exercises(request,db,SessionUser(str(user_id),'student'))
        assert [e['slug'] for e in listing['items']]==[slug]
        assert (await muscle_summary(db,None))['counts']=={'peitoral':1,'ombro':1}
        new_id=listing['items'][0]['id']
        signed=await get_video_url(new_id,db,SessionUser(str(user_id),'student'),variant='feminino')
        assert 'variant=feminino' in signed['url']
        expiry=int(time.time())+300
        tampered=Request({'type':'http','query_string':f'variant=masculino&expires={expiry}&signature={media_signature(new_id+":feminino",expiry)}'.encode(),'headers':[]})
        with pytest.raises(HTTPException) as error: await get_media(new_id,tampered,db)
        assert error.value.status_code==403
    again=await worker.import_catalog({'redis':queue})
    assert again['active']==1
    assert all(again[k]==0 for k in ('deletedExercises','deletedPlans','deletedSessions','deletedLogs'))
    async with factory() as db:
        assert (await db.execute(select(Exercise.id).where(Exercise.slug==slug))).scalar_one()==uuid.UUID(new_id)

    # A missing file prevents activation/retirement before the database is touched.
    broken=copy.deepcopy(data);broken['video']['variants']['feminino']['fileName']='missing.mp4'
    path.write_text(json.dumps([broken]),encoding='utf-8')
    with pytest.raises(ValueError,match='Missing catalog video'): await worker.import_catalog({'redis':queue})
    async with factory() as db: assert (await db.get(Exercise,uuid.UUID(new_id))).is_active

    # The deleted legacy plan cannot leak into the new plan/version.
    generated=SimpleNamespace(source='rules-engine',plan=SimpleNamespace(days=[]),provider_failures=None)
    monkeypatch.setattr(worker,'generate_plan',AsyncMock(return_value=generated))
    result=await worker.generate_workout({},str(user_id))
    assert result['version']==1
    async with factory() as db:
        current=(await db.execute(select(WorkoutPlan).where(WorkoutPlan.student_id==user_id,WorkoutPlan.active.is_(True)))).scalar_one()
        assert current.source.endswith(PLAN_CATALOG_TAG)
    path.write_text(json.dumps([data]),encoding='utf-8')
    await worker.import_catalog({'redis':queue})
    async with factory() as db:
        assert await db.get(WorkoutPlan,current.id) is not None
