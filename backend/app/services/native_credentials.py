from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import SessionLocal
from app.models.account import AccountStatus, MTAccount
from app.models.log import OperationLog
from app.models.native_refresh import NativeCredentialRefreshJob
from app.services.meituan_native_login import MeituanNativeLoginError, exchange_native_credential
from app.services.native_fingerprint import build_account_fingerprint, generate_lxcuid
from app.services.wxcode_client import WxcodeOpenAPIClient, WxcodeOpenAPIError
from app.utils.encryption import decrypt_token, encrypt_token


TERMINAL_STATES = {"success", "failed"}
RUNNING_STATES = {"pending", "requesting", "waiting", "exchanging"}
_WORKER_ID = f"mtcoupon-{uuid.uuid4().hex}"
_running_tasks: dict[str, asyncio.Task] = {}


class NativeRefreshConflict(RuntimeError):
    def __init__(self, message: str, job_id: str = ""):
        super().__init__(message)
        self.job_id = job_id


def _safe_message(value: object) -> str:
    text = str(value or "Native 凭据刷新失败")
    text = re.sub(r"(?i)(authorization|api[_ -]?key|token|encrypteddata|iv)\s*[:=]\s*[^\s,&]+", r"\1=[REDACTED]", text)
    return text[:500]


def _update_lease(job: NativeCredentialRefreshJob) -> None:
    job.worker_id = _WORKER_ID
    job.lease_expires_at = datetime.now() + timedelta(seconds=30)


def create_native_refresh_job(
    *, requested_by: int, account_id: Optional[int], remark: str, instance: dict[str, Any]
) -> NativeCredentialRefreshJob:
    instance_id = str(instance.get("instance_id") or "").strip()
    instance_code = str(instance.get("instance_code") or "").strip().upper()
    if not instance_id or not instance_code:
        raise ValueError("实例标识不完整")

    db = SessionLocal()
    try:
        account = None
        if account_id is not None:
            account = db.query(MTAccount).filter(
                MTAccount.id == account_id,
                MTAccount.user_id == requested_by,
            ).first()
            if not account:
                raise ValueError("账号不存在或无权访问")
        active = db.query(NativeCredentialRefreshJob).filter(
            NativeCredentialRefreshJob.state.in_(RUNNING_STATES),
            (
                (NativeCredentialRefreshJob.account_id == account_id)
                if account_id is not None
                else (NativeCredentialRefreshJob.instance_code == instance_code)
            ),
        ).first()
        if active:
            raise NativeRefreshConflict("该账号或实例已有刷新任务", active.id)

        bound = db.query(MTAccount).filter(MTAccount.native_instance_code == instance_code).first()
        if bound and (account_id is None or bound.id != account_id):
            raise NativeRefreshConflict("该 Native 实例已绑定其他账号")

        job = NativeCredentialRefreshJob(
            id=f"nref_{uuid.uuid4().hex}",
            requested_by=requested_by,
            account_id=account_id,
            remark=str(remark or (account.remark if account else "")).strip(),
            instance_id=instance_id,
            instance_code=instance_code,
            instance_name=str(instance.get("name") or "").strip(),
            agent_name=str(instance.get("agent_name") or "").strip(),
            active_instance_code=instance_code,
            active_account_id=account_id,
        )
        db.add(job)
        if account:
            account.credential_refresh_status = "queued"
            account.credential_refresh_error = None
        db.commit()
        db.refresh(job)
        return job
    except IntegrityError as exc:
        db.rollback()
        raise NativeRefreshConflict("该账号或实例已有刷新任务") from exc
    finally:
        db.close()


def _claim_job(job_id: str) -> bool:
    db = SessionLocal()
    try:
        now = datetime.now()
        updated = db.query(NativeCredentialRefreshJob).filter(
            NativeCredentialRefreshJob.id == job_id,
            NativeCredentialRefreshJob.state.in_(RUNNING_STATES),
            (
                NativeCredentialRefreshJob.lease_expires_at.is_(None)
                | (NativeCredentialRefreshJob.lease_expires_at < now)
                | (NativeCredentialRefreshJob.worker_id == _WORKER_ID)
            ),
        ).update({
            NativeCredentialRefreshJob.worker_id: _WORKER_ID,
            NativeCredentialRefreshJob.lease_expires_at: now + timedelta(seconds=30),
            NativeCredentialRefreshJob.started_at: now,
        }, synchronize_session=False)
        db.commit()
        return updated == 1
    finally:
        db.close()


def _job_snapshot(job_id: str) -> dict[str, Any] | None:
    db = SessionLocal()
    try:
        job = db.query(NativeCredentialRefreshJob).filter(NativeCredentialRefreshJob.id == job_id).first()
        if not job:
            return None
        return {
            "id": job.id,
            "account_id": job.account_id or job.active_account_id,
            "requested_by": job.requested_by,
            "remark": job.remark or "",
            "instance_id": job.instance_id,
            "instance_code": job.instance_code,
            "instance_name": job.instance_name or "",
            "agent_name": job.agent_name or "",
            "created_at": job.created_at,
            "state": job.state,
            "phone_task_id": job.phone_task_id or "",
            "code_task_id": job.code_task_id or "",
        }
    finally:
        db.close()


def _save_job_progress(job_id: str, **values: Any) -> None:
    db = SessionLocal()
    try:
        job = db.query(NativeCredentialRefreshJob).filter(NativeCredentialRefreshJob.id == job_id).first()
        if not job or job.state in TERMINAL_STATES:
            return
        for key, value in values.items():
            setattr(job, key, value)
        _update_lease(job)
        if job.account_id:
            account = db.query(MTAccount).filter(MTAccount.id == job.account_id).first()
            if account:
                account.credential_refresh_status = job.step
                account.credential_refresh_error = None
        db.commit()
    finally:
        db.close()


def _fail_job(job_id: str, code: str, message: str) -> None:
    db = SessionLocal()
    try:
        job = db.query(NativeCredentialRefreshJob).filter(NativeCredentialRefreshJob.id == job_id).first()
        if not job or job.state == "success":
            return
        safe = _safe_message(message)
        job.state = "failed"
        job.step = "failed"
        job.error_code = str(code or "NATIVE_REFRESH_FAILED")[:64]
        job.error_message = safe
        job.finished_at = datetime.now()
        job.active_instance_code = None
        job.active_account_id = None
        job.lease_expires_at = None
        if job.account_id:
            account = db.query(MTAccount).filter(MTAccount.id == job.account_id).first()
            if account:
                account.credential_refresh_status = "failed"
                account.credential_refresh_error = safe
        db.commit()
    finally:
        db.close()


def _read_identity(account_id: Optional[int]) -> tuple[str, str]:
    if not account_id:
        return generate_lxcuid(), build_account_fingerprint()
    db = SessionLocal()
    try:
        account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
        if not account:
            raise MeituanNativeLoginError("ACCOUNT_NOT_FOUND", "待刷新账号不存在")
        login_uuid = account.login_uuid or account.csecuuid or generate_lxcuid()
        fingerprint = decrypt_token(account.wechat_fingerprint or "") or build_account_fingerprint()
        return login_uuid, fingerprint
    finally:
        db.close()


def _apply_success(job_id: str, credential, login_uuid: str, fingerprint: str) -> int:
    db = SessionLocal()
    try:
        job = db.query(NativeCredentialRefreshJob).filter(NativeCredentialRefreshJob.id == job_id).first()
        if not job or job.state in TERMINAL_STATES:
            if job and job.result_account_id:
                return job.result_account_id
            raise MeituanNativeLoginError("JOB_NOT_ACTIVE", "刷新任务已结束")

        expected_account_id = job.account_id or job.active_account_id
        account = db.query(MTAccount).filter(MTAccount.id == expected_account_id).first() if expected_account_id else None
        if expected_account_id and not account:
            raise MeituanNativeLoginError("ACCOUNT_NOT_FOUND", "待刷新的账号已不存在，未创建替代账号")
        same_user = db.query(MTAccount).filter(MTAccount.userid == credential.user_id).first()
        if account:
            if str(account.userid) != credential.user_id:
                raise MeituanNativeLoginError(
                    "ACCOUNT_IDENTITY_MISMATCH",
                    "实例中的美团账号与所选历史账号不一致；为保护订单归属，未更新账号",
                )
            if same_user and same_user.id != account.id:
                raise MeituanNativeLoginError("ACCOUNT_ALREADY_EXISTS", "该美团账号已存在于其他记录")
        else:
            if same_user:
                raise MeituanNativeLoginError("ACCOUNT_ALREADY_EXISTS", "该美团账号已存在，请在已有账号上绑定实例")
            account = MTAccount(
                user_id=job.requested_by,
                remark=job.remark or job.instance_name or credential.user_id,
                userid=credential.user_id,
                token="",
                status=AccountStatus.NORMAL,
            )
            db.add(account)

        bound = db.query(MTAccount).filter(
            MTAccount.native_instance_code == job.instance_code,
            MTAccount.id != (account.id or 0),
        ).first()
        if bound:
            raise MeituanNativeLoginError("INSTANCE_ALREADY_BOUND", "该 Native 实例已绑定其他账号")

        now = datetime.now()
        account.token = encrypt_token(credential.token)
        # Native token lives only in the encrypted token column. Do not mirror
        # it into the legacy URL field as plaintext.
        account.url = "https://i.meituan.com/mttouch/page/account?" + urlencode({
            "userId": credential.user_id,
        })
        account.csecuuid = login_uuid
        account.login_uuid = login_uuid
        account.wechat_fingerprint = encrypt_token(fingerprint)
        account.open_id = credential.open_id
        account.open_id_cipher = credential.open_id_cipher
        account.union_id = credential.union_id
        account.union_id_cipher = credential.union_id_cipher
        account.platform = "windows"
        account.credential_source = "native"
        account.native_instance_id = job.instance_id
        account.native_instance_code = job.instance_code
        account.native_instance_name = job.instance_name
        account.native_agent_name = job.agent_name
        account.credential_refreshed_at = now
        account.credential_refresh_status = "success"
        account.credential_refresh_error = None
        account.status = AccountStatus.NORMAL
        account.last_check_time = now
        db.flush()

        job.result_account_id = account.id
        job.state = "success"
        job.step = "success"
        job.finished_at = now
        job.active_instance_code = None
        job.active_account_id = None
        job.lease_expires_at = None
        db.add(OperationLog(
            user_id=job.requested_by,
            action="native_credential_refresh",
            target_type="account",
            target_id=account.id,
            details=f"Native credential refreshed: account={account.id} instance={job.instance_code}",
        ))
        db.commit()
        return account.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _task_result(payload: dict[str, Any], kind: str) -> Any:
    state = str(payload.get("state") or "")
    if state in {"failed", "cancelled"}:
        error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        raise WxcodeOpenAPIError(
            str(error.get("code") or "CODE_TASK_FAILED"),
            str(error.get("message") or f"{kind} 任务失败"),
        )
    if state != "success":
        return None
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    if kind == "phone":
        phone = result.get("phone") if isinstance(result.get("phone"), dict) else payload.get("phone")
        if not isinstance(phone, dict):
            raise WxcodeOpenAPIError("PHONE_RESULT_MISSING", "手机号任务没有返回 phone 对象")
        return phone
    code = str(result.get("code") or payload.get("code") or "").strip()
    if not code:
        raise WxcodeOpenAPIError("CODE_RESULT_MISSING", "取码任务没有返回小程序 code")
    return code


async def process_native_refresh_job(job_id: str) -> None:
    if not _claim_job(job_id):
        # A process may have restarted while the persisted lease still belongs
        # to its former worker. Give that short lease time to expire, then make
        # one recovery attempt. An actually active worker continuously renews
        # the lease and will keep ownership.
        await asyncio.sleep(31)
        if not _claim_job(job_id):
            return
    client = WxcodeOpenAPIClient()
    try:
        snapshot = _job_snapshot(job_id)
        if not snapshot or snapshot["state"] in TERMINAL_STATES:
            return
        elapsed = max(0.0, (datetime.now() - snapshot["created_at"]).total_seconds())
        remaining = settings.NATIVE_REFRESH_DEADLINE_SECONDS - elapsed
        if remaining <= 0:
            for task_id in (snapshot["phone_task_id"], snapshot["code_task_id"]):
                if task_id:
                    await client.cancel(task_id)
            raise WxcodeOpenAPIError("NATIVE_REFRESH_TIMEOUT", "Native 刷新任务已超过总截止时间", 504)
        _save_job_progress(job_id, state="requesting", step="requesting_phone")
        if not snapshot["phone_task_id"]:
            task_id = await client.submit_task(
                instance_code=snapshot["instance_code"],
                kind="phone",
                request_id=f"mtcoupon:{job_id}:phone",
            )
            _save_job_progress(job_id, phone_task_id=task_id, state="requesting", step="requesting_code")
            snapshot["phone_task_id"] = task_id
        if not snapshot["code_task_id"]:
            task_id = await client.submit_task(
                instance_code=snapshot["instance_code"],
                kind="code",
                request_id=f"mtcoupon:{job_id}:code",
            )
            _save_job_progress(job_id, code_task_id=task_id, state="waiting", step="waiting")
            snapshot["code_task_id"] = task_id

        deadline = time.monotonic() + remaining
        phone_payload = None
        mini_program_code = None
        while time.monotonic() < deadline:
            if phone_payload is None:
                phone_payload = _task_result(await client.task(snapshot["phone_task_id"]), "phone")
            if mini_program_code is None:
                mini_program_code = _task_result(await client.task(snapshot["code_task_id"]), "code")
            if phone_payload is not None and mini_program_code is not None:
                break
            _save_job_progress(job_id, state="waiting", step="waiting")
            await asyncio.sleep(0.75)
        if phone_payload is None or mini_program_code is None:
            for task_id in (snapshot["phone_task_id"], snapshot["code_task_id"]):
                if task_id:
                    await client.cancel(task_id)
            raise WxcodeOpenAPIError("NATIVE_REFRESH_TIMEOUT", "等待节点任务完成超时", 504)

        _save_job_progress(job_id, state="exchanging", step="exchanging")
        login_uuid, fingerprint = _read_identity(snapshot["account_id"])
        credential = await exchange_native_credential(
            mini_program_code=mini_program_code,
            phone_payload=phone_payload,
            wechat_fingerprint=fingerprint,
            login_uuid=login_uuid,
        )
        _apply_success(job_id, credential, login_uuid, fingerprint)
    except WxcodeOpenAPIError as exc:
        _fail_job(job_id, exc.code, exc.message)
    except MeituanNativeLoginError as exc:
        _fail_job(job_id, exc.code, exc.message)
    except Exception as exc:  # keep raw credentials and transport payloads out of persisted errors
        _fail_job(job_id, "NATIVE_REFRESH_FAILED", _safe_message(exc))


def schedule_native_refresh(job_id: str) -> Optional[asyncio.Task]:
    existing = _running_tasks.get(job_id)
    if existing and not existing.done():
        return existing
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    task = loop.create_task(process_native_refresh_job(job_id), name=f"native-refresh:{job_id}")
    _running_tasks[job_id] = task

    def done(completed: asyncio.Task) -> None:
        _running_tasks.pop(job_id, None)
        if not completed.cancelled():
            completed.exception()

    task.add_done_callback(done)
    return task


def recover_native_refresh_jobs() -> int:
    db = SessionLocal()
    try:
        ids = [row[0] for row in db.query(NativeCredentialRefreshJob.id).filter(
            NativeCredentialRefreshJob.state.in_(RUNNING_STATES)
        ).all()]
    finally:
        db.close()
    for job_id in ids:
        schedule_native_refresh(job_id)
    return len(ids)


async def wait_for_native_refresh(job_id: str, timeout: Optional[float] = None) -> bool:
    schedule_native_refresh(job_id)
    deadline = time.monotonic() + (timeout or settings.NATIVE_REFRESH_DEADLINE_SECONDS + 30)
    while time.monotonic() < deadline:
        db = SessionLocal()
        try:
            job = db.query(NativeCredentialRefreshJob).filter(NativeCredentialRefreshJob.id == job_id).first()
            if not job:
                return False
            if job.state in TERMINAL_STATES:
                return job.state == "success"
        finally:
            db.close()
        await asyncio.sleep(0.5)
    return False


def native_credentials_stale(account: MTAccount, now: Optional[datetime] = None) -> bool:
    if account.credential_source != "native":
        return False
    if not account.credential_refreshed_at:
        return True
    return account.credential_refreshed_at <= (now or datetime.now()) - timedelta(
        hours=max(1, settings.NATIVE_CREDENTIAL_MAX_AGE_HOURS)
    )


async def refresh_existing_native_account(account_id: int) -> bool:
    db = SessionLocal()
    closed = False
    try:
        account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
        if not account or account.credential_source != "native" or not account.native_instance_code or not account.user_id:
            return False
        active = db.query(NativeCredentialRefreshJob).filter(
            NativeCredentialRefreshJob.account_id == account.id,
            NativeCredentialRefreshJob.state.in_(RUNNING_STATES),
        ).first()
        if active:
            job_id = active.id
        else:
            instance = {
                "instance_id": account.native_instance_id,
                "instance_code": account.native_instance_code,
                "name": account.native_instance_name,
                "agent_name": account.native_agent_name,
            }
            requested_by = account.user_id
            remark = account.remark or ""
            db.close()
            closed = True
            job = create_native_refresh_job(
                requested_by=requested_by,
                account_id=account_id,
                remark=remark,
                instance=instance,
            )
            job_id = job.id
    finally:
        if not closed:
            db.close()
    return await wait_for_native_refresh(job_id)
