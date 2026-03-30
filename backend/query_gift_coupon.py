#!/usr/bin/env python3
"""
独立查询礼物号券码脚本

使用方式：
1) 直接改下面变量：TOKEN / USERID / GIFT_ID / OPEN_ID
2) 在 backend 目录执行：python query_gift_coupon.py

说明：
- 脚本复用项目里的 Node 查询逻辑（meituanBackendApi.cjs），自动区分礼物号。
- 需要提供完整的用户信息（userId, openId）用于签名验证。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# ====== 你自己填写 ======
TOKEN = "AgGMIpCvfG6arDOSSxHcohIDwJp4cYsBFfJo4pAwzwvl5lJTnovoL5MWjIdSSDjKUJtTrcB2jCHq-gAAAAAnMwAACGc66h5MSr04TmJQYohXMgHKxm2O4YxX1XVNTIvB9sUDDRLcseCxxbKUa112xOvv"
USERID = "4497823282"
GIFT_ID = "20062802110981774775739"
OPEN_ID = "oJVP50DRAdtKlPFyi66xw2Uw03Is"  # 需要填写正确的openId
# ======================

NODE_BIN = "node"
TIMEOUT_SECONDS = 30


def find_backend_api_script() -> Path:
    """定位 meituanBackendApi.cjs"""
    current_dir = Path(__file__).resolve().parent
    script_path = current_dir / "app" / "services" / "meituan" / "meituanBackendApi.cjs"
    if not script_path.exists():
        raise FileNotFoundError(f"未找到脚本: {script_path}")
    return script_path


def query_gift_coupons(token: str, gift_id: str, userid: str, open_id: str) -> dict:
    """调用 Node 脚本查询券码"""
    script_path = find_backend_api_script()

    args = json.dumps(
        {
            "token": token,
            "orderId": str(gift_id),  # Node 侧会自动识别为礼物号
            "options": {
                "userId": userid,
                "openId": open_id,
            },
        },
        ensure_ascii=False,
    )

    result = subprocess.run(
        [NODE_BIN, str(script_path), "getCouponList", args],
        capture_output=True,
        timeout=TIMEOUT_SECONDS,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode != 0:
        raise RuntimeError(f"Node 执行失败: {result.stderr.strip() or '未知错误'}")

    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()

    # 打印 Node 脚本的调试输出（包含美团原始响应信息）
    if stderr:
        print("\n====== Node stderr (含美团原始响应信息) ======")
        print(stderr)
        print("=============================================\n")

    if not stdout:
        raise RuntimeError("Node 无输出")

    print("\n====== Node stdout (完整输出) ======")
    print(stdout)
    print("====================================\n")

    # 按项目现有约定：最后一行是 JSON
    json_line = stdout.splitlines()[-1]
    try:
        return json.loads(json_line)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"返回解析失败: {exc}; 原始输出末行: {json_line[:300]}") from exc


def print_result(data: dict) -> None:
    # 先打印完整返回
    print("\n====== 接口完整返回 ======")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print("===========================\n")

    if not data.get("success"):
        print("查询失败:", data.get("error", "未知错误"))
        return

    coupons = data.get("coupons") or []
    print(f"查询成功，返回券码数量: {len(coupons)}")

    if not coupons:
        return

    for idx, item in enumerate(coupons, start=1):
        coupon_code = item.get("coupon") or item.get("encode") or "-"
        status = item.get("order_status") or "-"
        verify_time = item.get("verifyTime") or "-"
        verify_poi_name = item.get("verifyPoiName") or "-"

        print(f"\n[{idx}]")
        print(f"  券码: {coupon_code}")
        print(f"  状态: {status}")
        print(f"  核销时间: {verify_time}")
        print(f"  核销门店: {verify_poi_name}")


if __name__ == "__main__":
    if not TOKEN or not USERID or not GIFT_ID:
        print("请先填写 TOKEN / USERID / GIFT_ID 后再运行。")
        sys.exit(1)

    if not OPEN_ID:
        print("警告: OPEN_ID 未填写，可能导致查询失败")

    print(f"开始查询，USERID={USERID}，礼物号={GIFT_ID}，OPEN_ID={OPEN_ID}")

    try:
        resp = query_gift_coupons(TOKEN, GIFT_ID, USERID, OPEN_ID)
        print_result(resp)
    except Exception as e:
        print(f"执行失败: {e}")
        sys.exit(1)
