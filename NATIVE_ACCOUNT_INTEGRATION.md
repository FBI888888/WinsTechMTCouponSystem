# Native 实例账号部署说明

本功能只修改 `WinsTechMTCouponSystem`，不要求变更 `wxcode_service` 或 `txshouyou`。

## 升级步骤

1. 备份 `mt_coupon` 数据库。
2. 对已有数据库执行 `backend/migrations/20260808_native_accounts.sql`；全新安装直接使用 `backend/init_database.sql`。
3. 在后端环境变量中启用凭据加密并保留运行参数：

   ```env
   TOKEN_ENCRYPTION_ENABLED=true
   ENCRYPTION_KEY=<长期稳定的随机密钥或 Fernet key>
   NATIVE_CREDENTIAL_MAX_AGE_HOURS=12
   NATIVE_REFRESH_DEADLINE_SECONDS=420
   ```

   `WXCODE_SERVICE_URL`、`WXCODE_SERVICE_API_KEY`、`NATIVE_ACCOUNT_ENABLED` 仍可作为首次启动的环境回退值，但管理员在前端保存后以数据库配置为准。

4. 重启后端，在 Electron 客户端使用管理员账号打开“系统设置 → 统一调度中心”，填写 HTTPS 服务地址和 API Key，开启 Native 实例账号并保存。
5. 前端保存时调用 `PUT /api/native-integration/config`；API Key 由后端加密入库，接口只返回“是否已配置”，不会返回密钥内容。随后使用“测试连接”确认授权实例数量正确。
6. 先绑定一个测试实例，依次验证刷新凭据、查订单和查券。
7. 分批绑定现有账号。绑定时调度中心返回的美团 `userId` 必须与原账号一致。

## 回退

- 在“系统设置 → 统一调度中心”关闭 Native 实例账号，可停止新的 Native 刷新；最后一次成功凭据仍会保留。
- 单个账号可在账号页“解除 Native 绑定”，切回 Legacy，同时保留当前 token 和身份字段。
- Legacy 账号继续按字段使用自身值，缺失字段才使用 `LEGACY_REQUEST_PROFILE` 的历史默认值。
- 不要变更已经用于加密生产凭据的 `ENCRYPTION_KEY`，否则已有加密 token 与 Fingerprint 将无法解密。

## 安全约束

- API Key 可由管理员在前端录入，但只通过 HTTPS 提交给 FastAPI；它不会写入 Electron 构建产物或浏览器存储。
- FastAPI 使用稳定 `ENCRYPTION_KEY` 加密保存 API Key，读取配置的接口永不返回明文或密文。
- 刷新任务表不保存手机号 payload、小程序 code、token 或 Fingerprint。
- Native token 与 Fingerprint 使用现有凭据加密模块入库；Native URL 字段不镜像明文 token。
- 日志与 API 响应不返回调度中心 task ID、手机号数据、Fingerprint 或 API Key。
