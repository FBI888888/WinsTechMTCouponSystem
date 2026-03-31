from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import httpx
from app.database import get_db
from app.models.user import User
from app.models.account import MTAccount, AccountStatus
from app.models.log import OperationLog
from app.schemas.account import (
    AccountCreate, AccountUpdate, AccountResponse,
    AccountCaptureRequest, AccountCheckRequest, AccountCheckResponse
)
from app.deps import get_current_user
from app.utils.encryption import encrypt_token, decrypt_token

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _encrypt_account_token(token: str) -> str:
    """加密账号Token"""
    return encrypt_token(token)


def _decrypt_account_token(encrypted_token: str) -> str:
    """解密账号Token"""
    return decrypt_token(encrypted_token)


@router.get("", response_model=List[AccountResponse])
def get_accounts(
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(MTAccount)
    if user_id:
        query = query.filter(MTAccount.user_id == user_id)
    if status_filter:
        query = query.filter(MTAccount.status == status_filter)

    accounts = query.offset(skip).limit(limit).all()

    # 解密 Token 后返回
    for account in accounts:
        account.token = _decrypt_account_token(account.token)

    return accounts


@router.post("", response_model=AccountResponse)
def create_account(
    account: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Check if userid already exists
    existing = db.query(MTAccount).filter(MTAccount.userid == account.userid).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account with this userid already exists"
        )

    # 加密 Token 后存储
    encrypted_token = _encrypt_account_token(account.token)

    db_account = MTAccount(
        remark=account.remark,
        userid=account.userid,
        token=encrypted_token,
        url=account.url,
        csecuuid=account.csecuuid,
        open_id=account.open_id,
        open_id_cipher=account.open_id_cipher,
        user_id=account.user_id or current_user.id if current_user.role == "admin" else current_user.id,
        status=AccountStatus.UNCHECKED
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="create_account",
        target_type="account",
        target_id=db_account.id,
        details=f"Created account: {account.remark or account.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密 Token
    db_account.token = _decrypt_account_token(db_account.token)
    return db_account


@router.post("/capture", response_model=AccountResponse)
def capture_account(
    request: AccountCaptureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 将前端传入的 status 字符串转换为 AccountStatus 枚举
    def parse_status(status_str: str):
        if status_str == "normal":
            return AccountStatus.NORMAL
        elif status_str == "invalid":
            return AccountStatus.INVALID
        return AccountStatus.UNCHECKED

    # Check if userid already exists
    existing = db.query(MTAccount).filter(MTAccount.userid == request.userid).first()
    if existing:
        # Update existing account
        existing.remark = request.remark
        existing.token = _encrypt_account_token(request.token)  # 加密存储
        existing.url = request.url
        existing.csecuuid = request.csecuuid or existing.csecuuid
        existing.open_id = request.open_id or existing.open_id
        existing.open_id_cipher = request.open_id_cipher or existing.open_id_cipher
        if request.status:
            existing.status = parse_status(request.status)
            from datetime import datetime
            existing.last_check_time = datetime.now()
        db.commit()
        db.refresh(existing)
        # 返回时解密
        existing.token = _decrypt_account_token(existing.token)
        return existing

    # Create new account
    db_account = MTAccount(
        remark=request.remark,
        userid=request.userid,
        token=_encrypt_account_token(request.token),  # 加密存储
        url=request.url,
        csecuuid=request.csecuuid,
        open_id=request.open_id,
        open_id_cipher=request.open_id_cipher,
        status=parse_status(request.status) if request.status else AccountStatus.UNCHECKED
    )
    if request.status:
        from datetime import datetime
        db_account.last_check_time = datetime.now()
    db.add(db_account)
    db.commit()
    db.refresh(db_account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="capture_account",
        target_type="account",
        target_id=db_account.id,
        details=f"Captured account: {request.remark or request.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密
    db_account.token = _decrypt_account_token(db_account.token)
    return db_account


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # 解密 Token 后返回
    account.token = _decrypt_account_token(account.token)
    return account


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    account: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = account.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        # 如果是 token 字段，需要加密
        if field == "token" and value:
            value = _encrypt_account_token(value)
        setattr(db_account, field, value)

    db.commit()
    db.refresh(db_account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="update_account",
        target_type="account",
        target_id=db_account.id,
        details=f"Updated account: {db_account.remark or db_account.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密 Token
    db_account.token = _decrypt_account_token(db_account.token)
    return db_account


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Log before delete
    log = OperationLog(
        user_id=current_user.id,
        action="delete_account",
        target_type="account",
        target_id=account_id,
        details=f"Deleted account: {account.remark or account.userid}"
    )
    db.add(log)

    db.delete(account)
    db.commit()

    return {"message": "Account deleted successfully"}


@router.post("/check", response_model=List[AccountCheckResponse])
async def check_accounts_status(
    check_request: List[AccountCheckRequest],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 批量查询所有账号（避免N+1）
    userids = [req.userid for req in check_request]
    accounts = db.query(MTAccount).filter(MTAccount.userid.in_(userids)).all()
    account_map = {a.userid: a for a in accounts}

    results = []
    for req in check_request:
        result = await check_account_status(req)
        results.append(result)

        # 更新账号状态
        account = account_map.get(req.userid)
        if account:
            account.status = AccountStatus.NORMAL if result.code == 0 else AccountStatus.INVALID
            account.last_check_time = datetime.now()

    # 一次提交所有更新
    db.commit()

    return results


async def check_account_status(request: AccountCheckRequest) -> AccountCheckResponse:
    """Check if account token is valid"""
    url = f"https://ordercenter.meituan.com/ordercenter/user/orders?userid={request.userid}&token={request.token}&offset=0&limit=10&platformid=6&statusFilter=0&version=0&yodaReady=wx&csecappid=wxde8ac0a21135c07d&csecplatform=3&csecversionname=9.25.105&csecversion=1.4.0"

    headers = {
        "Host": "ordercenter.meituan.com",
        "Connection": "keep-alive",
        "User-Agent": "",
        "xweb_xhr": "1",
        "utm_medium": "",
        "clientversion": "3.8.9",
        "Accept": "*/*",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Referer": "https://servicewechat.com/wxde8ac0a21135c07d/1451/page-frame.html",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=10.0)
            code = response.json().get("code") if response.status_code == 200 else -1
            return AccountCheckResponse(
                success=True,
                code=code if code == 0 else (code if code else -1)
            )
    except Exception as e:
        return AccountCheckResponse(
            success=False,
            code=-1,
            message=str(e)
        )


@router.post("/{account_id}/scan")
async def scan_single_account(
    account_id: int,
    status_filter: int = 2,  # 默认待使用
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    扫描单个账号的订单和券码
    status_filter: 0=全部, 2=待使用, 3=已完成, 4=退款/售后
    """
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    if account.status == AccountStatus.INVALID:
        raise HTTPException(status_code=400, detail="账号已失效，请先更新Token")

    # 执行扫描（手动扫描不检查间隔）
    from app.services.meituan.scanner import ScheduledTaskService

    task_service = ScheduledTaskService()
    db.refresh(account)  # 确保获取最新数据

    try:
        result = await task_service.run_scan_for_account(db, account, status_filter)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/{account_id}/toggle-disabled")
async def toggle_account_disabled(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    切换账号的禁用状态
    """
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    # 切换禁用状态
    account.disabled = 1 if account.disabled == 0 else 0
    db.commit()
    db.refresh(account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="toggle_account_disabled",
        target_type="account",
        target_id=account.id,
        details=f"{'禁用' if account.disabled == 1 else '启用'}账号: {account.remark or account.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密 Token
    account.token = _decrypt_account_token(account.token)
    return account


from datetime import datetime
