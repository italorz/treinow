from arq.jobs import Job, JobStatus
from fastapi import APIRouter, Depends

from ..db import get_arq_pool
from ..security import SessionUser, require_user, verify_csrf

router = APIRouter(prefix="/v1", tags=["jobs"], dependencies=[Depends(verify_csrf)])


@router.get("/jobs/{queue}/{job_id}")
async def get_job(queue: str, job_id: str, _user: SessionUser = Depends(require_user)):
    pool = await get_arq_pool()
    job = Job(job_id, pool)
    status = await job.status()
    if status == JobStatus.not_found:
        return {"id": job_id, "state": "not_found"}
    if status == JobStatus.complete:
        info = await job.result_info()
        if info is not None and info.success:
            return {"id": job_id, "state": "completed", "result": info.result}
        failed_reason = str(info.result) if info is not None else "Falha desconhecida"
        return {"id": job_id, "state": "failed", "failedReason": failed_reason}
    return {"id": job_id, "state": status.value}
