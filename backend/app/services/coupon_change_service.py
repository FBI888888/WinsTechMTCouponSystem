"""
券码变更检测和处理服务

提供券码匹配、变码检测、历史记录等功能
"""

from typing import List, Dict, Tuple, Optional, Any
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.coupon import Coupon
from app.models.coupon_history import CouponHistory
from app.models.order import Order


def find_coupon_by_code(
    db: Session,
    coupon_code: str
) -> Tuple[Optional[Coupon], bool, Optional[CouponHistory]]:
    """
    通过券码查找，同时匹配当前券码和历史旧券码

    参数:
        db: 数据库会话
        coupon_code: 券码

    返回:
        (coupon对象, 是否来自历史记录, history记录)
        - coupon: 找到的券码对象，如果未找到则为None
        - is_from_history: 如果通过旧券码匹配到则为True
        - history: 历史记录对象，如果不是通过历史匹配则为None
    """
    # 1. 先查当前券码表
    coupon = db.query(Coupon).filter(
        Coupon.coupon_code == coupon_code
    ).first()

    if coupon:
        return coupon, False, None

    # 2. 再查历史表，找旧券码
    # 取最新的变更记录（可能有多次变更）
    history = db.query(CouponHistory).filter(
        CouponHistory.old_coupon_code == coupon_code
    ).order_by(CouponHistory.changed_at.desc()).first()

    if history:
        # 找到旧券码映射，获取当前券码
        current_coupon = db.query(Coupon).filter(
            Coupon.id == history.coupon_id
        ).first()

        if current_coupon:
            return current_coupon, True, history

    return None, False, None


def batch_find_coupons_by_codes(
    db: Session,
    coupon_codes: List[str]
) -> Dict[str, Dict[str, Any]]:
    """
    批量通过券码查找，同时匹配当前券码和历史旧券码

    参数:
        db: 数据库会话
        coupon_codes: 券码列表

    返回:
        {
            coupon_code: {
                'coupon': coupon对象,
                'is_from_history': 是否来自历史,
                'history': history记录,
                'current_code': 当前券码（如果输入的是旧券码）
            }
        }
    """
    if not coupon_codes:
        return {}

    unique_codes = list(dict.fromkeys(code for code in coupon_codes if code))
    result = {
        code: {
            'coupon': None,
            'is_from_history': False,
            'history': None,
            'current_code': code,
        }
        for code in unique_codes
    }

    current_coupons = db.query(Coupon).filter(Coupon.coupon_code.in_(unique_codes)).all()
    current_coupon_map = {coupon.coupon_code: coupon for coupon in current_coupons}

    for code, coupon in current_coupon_map.items():
        result[code] = {
            'coupon': coupon,
            'is_from_history': False,
            'history': None,
            'current_code': coupon.coupon_code,
        }

    unresolved_codes = [code for code in unique_codes if code not in current_coupon_map]
    if not unresolved_codes:
        return result

    histories = db.query(CouponHistory).filter(
        CouponHistory.old_coupon_code.in_(unresolved_codes)
    ).order_by(
        CouponHistory.old_coupon_code.asc(),
        CouponHistory.changed_at.desc(),
        CouponHistory.id.desc(),
    ).all()

    latest_history_map = {}
    for history in histories:
        if history.old_coupon_code not in latest_history_map:
            latest_history_map[history.old_coupon_code] = history

    if not latest_history_map:
        return result

    coupon_ids = list({history.coupon_id for history in latest_history_map.values()})
    coupons_by_id = {
        coupon.id: coupon
        for coupon in db.query(Coupon).filter(Coupon.id.in_(coupon_ids)).all()
    }

    for old_code, history in latest_history_map.items():
        coupon = coupons_by_id.get(history.coupon_id)
        if not coupon:
            continue
        result[old_code] = {
            'coupon': coupon,
            'is_from_history': True,
            'history': history,
            'current_code': history.new_coupon_code,
        }

    return result


class CouponChangeDetector:
    """券码变更检测器"""

    def __init__(self, db_coupons: List[Coupon], api_coupons: List[Dict]):
        """
        初始化检测器

        参数:
            db_coupons: 数据库中的券码列表
            api_coupons: API返回的券码列表 [{coupon, encode, ...}, ...]
        """
        self.db_coupons = db_coupons
        self.api_coupons = api_coupons

        # 构建映射表
        self.db_code_map = {c.coupon_code: c for c in db_coupons}
        self.api_code_map = {}
        self.api_encode_map = {}

        for api_coupon in api_coupons:
            code = api_coupon.get('coupon') or api_coupon.get('coupon_code')
            encode = api_coupon.get('encode')

            if code:
                self.api_code_map[code] = api_coupon
            if encode:
                self.api_encode_map[encode] = api_coupon

    def detect_changes(self) -> Dict[str, Any]:
        """
        检测券码变更情况

        返回:
            {
                'changes': [
                    {
                        'type': 'changed',
                        'db_coupon': coupon对象,
                        'old_code': 旧券码,
                        'new_code': 新券码,
                        'new_encode': 新encode,
                        'api_data': API返回的原始数据
                    }
                ],
                'unchanged': [未变更的coupon对象列表],
                'is_full_change': 是否全部变更,
                'is_partial_change': 是否部分变更,
                'new_count': API返回的券码数,
                'db_count': 数据库的券码数
            }
        """
        changes = []
        unchanged = []

        db_codes = set(self.db_code_map.keys())
        api_codes = set(self.api_code_map.keys())

        # 1. 找出完全匹配的券码（未变更）
        matched_codes = db_codes & api_codes
        for code in matched_codes:
            unchanged.append(self.db_code_map[code])

        # 2. 找出需要处理的券码
        unmatched_db = db_codes - api_codes  # 数据库中有但API中没有
        unmatched_api = api_codes - db_codes  # API中有但数据库中没有

        # 3. 处理未匹配的券码
        if unmatched_db and unmatched_api:
            # 按照顺序进行匹配（假设API返回的顺序与数据库顺序对应）
            db_list = [c for c in self.db_coupons if c.coupon_code in unmatched_db]
            api_list = [self.api_code_map[c] for c in unmatched_api]

            # 优先通过 encode 进行匹配
            for db_coupon in db_list[:]:
                if db_coupon.encode and db_coupon.encode in self.api_encode_map:
                    # 通过 encode 匹配到新券码
                    api_data = self.api_encode_map[db_coupon.encode]
                    new_code = api_data.get('coupon') or api_data.get('coupon_code')

                    if new_code and new_code != db_coupon.coupon_code:
                        changes.append({
                            'type': 'changed',
                            'db_coupon': db_coupon,
                            'old_code': db_coupon.coupon_code,
                            'new_code': new_code,
                            'new_encode': api_data.get('encode', ''),
                            'api_data': api_data
                        })
                        db_list.remove(db_coupon)
                        # 从api_list中移除匹配项
                        api_list = [a for a in api_list if a != api_data]

            # 4. 剩余未匹配的，按顺序一一对应
            for i, db_coupon in enumerate(db_list):
                if i < len(api_list):
                    api_data = api_list[i]
                    new_code = api_data.get('coupon') or api_data.get('coupon_code')

                    if new_code:
                        changes.append({
                            'type': 'changed',
                            'db_coupon': db_coupon,
                            'old_code': db_coupon.coupon_code,
                            'new_code': new_code,
                            'new_encode': api_data.get('encode', ''),
                            'api_data': api_data
                        })

        # 5. 判断变更类型
        changed_count = len(changes)
        db_count = len(self.db_coupons)
        api_count = len(self.api_coupons)

        # 全部变更：所有数据库券码都变了，且数量一致
        is_full_change = changed_count > 0 and changed_count == db_count and db_count == api_count

        # 部分变更：有变更但不是全部
        is_partial_change = 0 < changed_count < db_count

        return {
            'changes': changes,
            'unchanged': unchanged,
            'is_full_change': is_full_change,
            'is_partial_change': is_partial_change,
            'new_count': api_count,
            'db_count': db_count
        }


def apply_coupon_changes(
    db: Session,
    order_id: int,
    account_id: int,
    changes: List[Dict[str, Any]],
    change_reason: str = 'auto_detect'
) -> List[CouponHistory]:
    """
    应用券码变更到数据库

    参数:
        db: 数据库会话
        order_id: 订单ID
        account_id: 账号ID
        changes: 变更列表（detect_changes返回的changes）
        change_reason: 变更原因

    返回:
        创建的历史记录列表
    """
    histories = []

    for change in changes:
        db_coupon = change['db_coupon']
        old_code = change['old_code']
        new_code = change['new_code']
        new_encode = change['new_encode']
        api_data = change['api_data']

        # 1. 创建历史记录
        history = CouponHistory(
            coupon_id=db_coupon.id,
            order_id=order_id,
            account_id=account_id,
            old_coupon_code=old_code,
            new_coupon_code=new_code,
            changed_at=datetime.now(),
            change_reason=change_reason
        )
        db.add(history)
        histories.append(history)

        # 2. 更新券码
        db_coupon.coupon_code = new_code
        db_coupon.encode = new_encode
        db_coupon.coupon_status = api_data.get('order_status') or api_data.get('coupon_status', '')
        db_coupon.use_status = api_data.get('useStatus') or api_data.get('use_status')
        db_coupon.query_time = datetime.now()

    db.commit()
    return histories


def get_coupon_change_info(
    db: Session,
    coupon_code: str
) -> Optional[Dict[str, Any]]:
    """
    获取券码的变更信息

    参数:
        db: 数据库会话
        coupon_code: 券码

    返回:
        {
            'current_code': 当前券码,
            'current_status': 当前状态,
            'is_changed': 是否发生过变更,
            'change_count': 变更次数,
            'last_change': {
                'old_code': 旧券码,
                'changed_at': 变更时间,
                'reason': 变更原因
            },
            'history': [历史记录列表]
        }
    """
    # 查找当前券码
    coupon, is_from_history, latest_history = find_coupon_by_code(db, coupon_code)

    if not coupon:
        return None

    # 获取所有历史记录
    histories = db.query(CouponHistory).filter(
        CouponHistory.coupon_id == coupon.id
    ).order_by(CouponHistory.changed_at.desc()).all()

    result = {
        'current_code': coupon.coupon_code,
        'current_status': coupon.coupon_status,
        'is_changed': len(histories) > 0,
        'change_count': len(histories),
        'last_change': None,
        'history': []
    }

    if histories:
        latest = histories[0]
        result['last_change'] = {
            'old_code': latest.old_coupon_code,
            'changed_at': latest.changed_at,
            'reason': latest.change_reason
        }
        result['history'] = [
            {
                'old_code': h.old_coupon_code,
                'new_code': h.new_coupon_code,
                'changed_at': h.changed_at,
                'reason': h.change_reason
            }
            for h in histories
        ]

    return result
