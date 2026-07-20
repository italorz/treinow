from contextlib import asynccontextmanager
from typing import AsyncIterator

import aioboto3
import redis.asyncio as aioredis
from arq import ArqRedis, create_pool
from arq.connections import RedisSettings
from botocore.config import Config as BotoConfig
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import config

engine = create_async_engine(config.DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

redis = aioredis.from_url(config.REDIS_URL, decode_responses=True)

_boto_session = aioboto3.Session()
_boto_config = BotoConfig(s3={"addressing_style": "path"}, signature_version="s3v4")

arq_pool: ArqRedis | None = None


async def get_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def s3_client():
    async with _boto_session.client(
        "s3",
        endpoint_url=config.MINIO_ENDPOINT,
        region_name="us-east-1",
        aws_access_key_id=config.MINIO_ACCESS_KEY,
        aws_secret_access_key=config.MINIO_SECRET_KEY,
        config=_boto_config,
    ) as client:
        yield client


async def ensure_bucket() -> None:
    async with s3_client() as s3:
        try:
            await s3.create_bucket(Bucket=config.MINIO_BUCKET)
        except s3.exceptions.ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise


async def get_arq_pool() -> ArqRedis:
    global arq_pool
    if arq_pool is None:
        arq_pool = await create_pool(RedisSettings.from_dsn(config.REDIS_URL))
    return arq_pool


async def close_infra() -> None:
    global arq_pool
    if arq_pool is not None:
        await arq_pool.close()
        arq_pool = None
    await redis.aclose()
    await engine.dispose()
