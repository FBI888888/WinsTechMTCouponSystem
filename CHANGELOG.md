# 更新日志

所有重要的更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-04-01

### 新增功能

#### 券码变码检测与历史追溯
- **变码自动检测**：查询券码时自动检测美团券码是否发生变更
- **旧券码记录**：券码变更时自动记录旧券码到历史表，支持完整追溯
- **旧券码匹配查询**：用户输入旧券码时，系统自动匹配到当前券码
- **多种变码场景支持**：
  - 单个券码变码（1对1订单）
  - 部分变码（1对多订单中部分券码变更）
  - 全部变码（1对多订单中所有券码都变更）

#### 券码详情弹窗
- **一键查看详情**：点击"详情"按钮查看券码完整信息
- **信息聚合展示**：一次请求获取券码、订单、账号、变更历史
- **分类清晰**：券码信息、订单信息、账号信息、变更历史分区块展示

#### UI优化
- **变更状态标签**：直观显示"旧券码"、"部分变更"、"全部变更"状态
- **旧券码提示**：用户输入旧券码时，显示箭头指向当前券码
- **变更次数显示**：显示历史变更次数
- **详情/复制按钮**：操作列新增详情和复制功能

### 数据库变更
- 新增 `coupon_history` 表，用于记录券码变更历史
- 字段：`old_coupon_code`、`new_coupon_code`、`changed_at`、`change_reason` 等

### API变更
- `POST /api/coupons/query` - 支持旧券码匹配，返回变更信息
- `POST /api/coupons/query-backend` - 支持变码检测和处理
- `GET /api/coupons/detail/by-code/{coupon_code}` - 新增券码详情接口
- `GET /api/coupons/history/{coupon_id}` - 获取券码变更历史

### 文件变更

#### 新增文件
- `backend/app/models/coupon_history.py` - 券码历史记录模型
- `backend/app/services/coupon_change_service.py` - 变码检测核心服务
- `backend/migrations/add_coupon_history.sql` - 数据库迁移脚本
- `backend/scripts/verify_changes.py` - 功能验证脚本

#### 修改文件
- `backend/app/models/__init__.py` - 导出新模型
- `backend/app/models/coupon.py` - 添加history关系
- `backend/app/models/order.py` - 添加coupon_history关系
- `backend/app/models/account.py` - 添加coupon_history关系
- `backend/app/schemas/coupon.py` - 新增变更相关Schema
- `backend/app/routers/coupons.py` - 重写查询接口，支持变码处理
- `frontend/src/pages/CouponQueryPage.jsx` - UI优化，新增详情弹窗
- `frontend/src/api/index.js` - 新增详情接口

### 升级说明

1. **数据库迁移**
```bash
mysql -u root -p mt_coupon < backend/migrations/add_coupon_history_simple.sql
```

2. **验证安装**
```bash
cd backend
python scripts/verify_changes.py
```

3. **重启服务**
```bash
# 后端
cd backend && python -m uvicorn app.main:app --reload

# 前端
cd frontend && npm run dev
```

---

## [1.0.0] - 2026-03-29

### 初始版本
- 美团账号管理
- 订单同步与管理
- 券码查询与管理
- 用户权限管理
- 系统配置
- 操作日志
