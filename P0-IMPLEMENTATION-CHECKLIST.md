# P0 Implementation Checklist

> 目标：用最小但有效的改造，先移除当前项目中最重的错误数据流和重复调用路径。
> 范围：只覆盖 `PERFORMANCE-OPTIMIZATION.md` 中定义的 P0。

---

## 一、P0 总目标

P0 不追求“架构最终形态”，只追求三件事：

1. 把高成本的全量拉取改成后端控制
2. 把重复的外部 API 调用改成按订单聚合
3. 把关键查库路径从伪批量改成真批量

P0 完成后，应至少达到以下结果：

- 前端不再先拉全量 `order_id` 再做本地去重
- `/api/orders/pending-coupon-query` 不再一次性返回全部待查订单
- `/api/coupons/query-backend` 同一订单只调用一次美团接口
- `batch_find_coupons_by_codes()` 不再循环单条查库

---

## 二、执行顺序

建议顺序如下：

1. T1 先改券码批量查库
2. T2 再改待查订单接口分批返回
3. T3 再改订单同步为后端幂等写入
4. T4 再改券码查询按订单聚合
5. T5 最后补验证、日志和回归

原因：

- T1/T2 改动小、收益直接、风险可控
- T3/T4 会改前后端协同逻辑，适合在基础接口稳定后推进
- T5 用于防止 P0 改完后出现隐性退化

---

## 三、任务清单

### T1. 重写券码批量查库

**目标**

- 将 `batch_find_coupons_by_codes()` 从循环单查改为真正批量查询

**涉及文件**

- `backend/app/services/coupon_change_service.py`
- `backend/app/routers/coupons.py`

**改造内容**

- 一次查询当前券码表：`Coupon.coupon_code in (...)`
- 一次查询历史券码表：`CouponHistory.old_coupon_code in (...)`
- 批量加载关联 `Coupon`
- 在内存中构建：
  - 输入券码 -> 当前券码
  - 输入券码 -> 是否历史旧券码
  - 输入券码 -> 匹配到的 history 记录

**实现要求**

- 保持现有返回结构兼容
- 对重复输入券码、空列表、未命中情况做兼容处理
- 不要在函数内部再次调用 `find_coupon_by_code()`

**验收标准**

- 100 个券码查询时，数据库查询次数显著下降
- `/api/coupons/query` 和 `/api/coupons/query-backend` 行为与当前业务保持一致
- 旧券码命中历史记录时仍能正确返回当前券码信息

**风险提示**

- 历史表可能存在同一旧券码多次变更，必须明确“取最新一条”的规则

---

### T2. 待查订单接口改为后端分批返回

**目标**

- 不再由后端一次性返回全部待查订单

**涉及文件**

- `backend/app/routers/orders.py`
- `frontend/src/api/index.js`
- `frontend/src/pages/OrderListPage.jsx`

**改造内容**

- 为 `/api/orders/pending-coupon-query` 增加 `limit`
- 后端默认限制返回条数，例如 100 或 200
- 保留必要筛选条件：
  - `account_id`
  - `status_filter`
- 返回结果中明确：
  - `items`
  - `returned_count`
  - `has_more`

**实现要求**

- 查询必须在 SQL 层就 `limit`
- 排序规则保持稳定，建议继续按 `order_pay_time desc, id desc`
- 前端扫描逻辑改为依赖后端返回批次，不再自己先拿全量再截前 1000

**验收标准**

- 接口不再出现 `query.order_by(...).all()` 的全量返回模式
- 前端能正常处理分页/批次返回
- 订单扫描功能对用户可用，不出现“待查订单全部消失”或“重复扫同一批”的问题

**风险提示**

- 如果后续需要连续多批扫描，需明确前端是循环调用，还是后端一次返回一个“下一批”

---

### T3. 订单同步改为后端幂等写入

**目标**

- 去掉“前端先拉全量 `order_id` 再本地去重”的模式

**涉及文件**

- `backend/app/routers/orders.py`
- `backend/app/models/order.py`
- `frontend/src/pages/OrderListPage.jsx`
- 如需要迁移脚本：`backend/migrations/*`

**改造内容**

- 删除或废弃前端对 `/api/orders/ids` 的依赖
- 前端同步时直接上传本次抓取的订单列表
- 后端 `save-batch` 接口负责：
  - 幂等判断
  - 已存在订单更新
  - 新订单插入

**实现要求**

- 数据库层应保证 `(account_id, order_id)` 唯一
- 如当前数据库未建唯一约束，需要补迁移
- `save-batch` 的返回值要明确：
  - `new_count`
  - `update_count`
  - `skip_count`

**验收标准**

- 前端同步流程中不再请求 `/api/orders/ids`
- 同一批订单重复同步不会写出重复数据
- 同步接口在已有大量订单的账号下仍可正常工作

**风险提示**

- 如果历史数据已存在重复 `(account_id, order_id)`，加唯一约束前必须先清洗

---

### T4. 券码查询改为按订单聚合调用美团接口

**目标**

- 同一订单只调用一次美团接口

**涉及文件**

- `backend/app/routers/coupons.py`
- `backend/app/services/coupon_change_service.py`
- 视情况可能涉及：
  - `backend/app/services/meituan/meituanBackendApi.cjs`
  - `frontend/src/pages/CouponQueryPage.jsx`

**改造内容**

- 在 `/api/coupons/query-backend` 中：
  - 先把输入券码映射到订单
  - 按 `order_id` 分组
  - 每个订单只请求一次美团接口
  - 把单次响应分发给该订单下的多个输入券码

**实现要求**

- 复用当前批量查到的 `coupon/order/account` 映射
- 去掉当前“每个输入券码都独立调一次 `call_meituan_api`”的模式
- `change_count` 不应在循环内逐条单独 count；优先批量获取或延迟计算
- `order_coupons` 这类分组结构应真正参与主逻辑，不再只是中间变量

**验收标准**

- 同一订单下输入多个券码时，只触发一次美团 API 请求
- 返回结果结构与前端兼容
- 变码检测、历史旧券码显示、当前券码显示都保持正确

**风险提示**

- 一个订单下多个券码时，结果分发逻辑要避免错配
- 若依赖 `encode` 匹配，需保留原有兼容逻辑

---

### T5. 补最小观测与回归验证

**目标**

- 确保 P0 改造可观测、可回归、可验收

**涉及文件**

- `backend/app/routers/orders.py`
- `backend/app/routers/coupons.py`
- `backend/app/main.py`
- 如需脚本，可新增到 `backend/scripts/`

**改造内容**

- 为关键接口补充日志或统计字段：
  - `pending-coupon-query` 返回条数
  - `query-backend` 输入券码数
  - `query-backend` 订单分组数
  - `query-backend` 实际外部 API 调用次数
- 增加最小回归验证清单

**回归验证项**

- 订单同步
  - 空账号同步
  - 重复同步
  - 同一批数据重复上传
- 待查订单接口
  - 无数据
  - 超过 `limit`
  - `has_more=true`
- 券码查询
  - 当前券码命中
  - 历史旧券码命中
  - 同订单多券码输入
  - 不存在券码

**验收标准**

- P0 改动后的关键接口都能观察到批量效果
- 没有明显业务回归

---

## 四、接口变更清单

### 4.1 后端接口变更

#### `/api/orders/pending-coupon-query`

建议新增参数：

- `limit`

建议返回字段：

```json
{
  "returned_count": 100,
  "has_more": true,
  "items": []
}
```

#### `/api/orders/save-batch`

建议补充返回字段：

```json
{
  "success": true,
  "new_count": 120,
  "update_count": 30,
  "skip_count": 0
}
```

#### `/api/coupons/query-backend`

对外返回结构尽量不变，但内部实现改为：

- 输入按订单聚合
- 按订单调用外部接口
- 再分发结果

### 4.2 前端联动点

- `OrderListPage.jsx`
  - 删除同步前获取全量 `order_id` 的逻辑
  - 扫描待查订单时使用后端限制后的批次
- `CouponQueryPage.jsx`
  - 若后端聚合后性能足够，可评估减少前端逐条 fallback

---

## 五、建议的提交拆分

为了降低回归风险，建议不要把 P0 一次性揉成一个大提交。

推荐拆分：

1. `feat: batch coupon lookup without N+1`
2. `feat: limit pending coupon query orders on server side`
3. `feat: make order batch save idempotent on backend`
4. `feat: group coupon backend queries by order`
5. `chore: add p0 metrics and regression checks`

---

## 六、P0 完成定义

当满足以下条件时，可认为 P0 完成：

- 订单同步不再依赖前端全量 `order_id` 去重
- 待查订单接口改为服务端分批返回
- 券码批量查库改为真批量
- 券码后端查询改为按订单聚合外部调用
- 至少有一轮针对真实数据量的接口验证

如果只完成了索引、缓存、连接池调整，而没有完成以上 4 项核心改造，则不能算 P0 完成。

