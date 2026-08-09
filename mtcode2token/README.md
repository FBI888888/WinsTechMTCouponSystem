# 美团小程序 code → token 逆向

目标接口：`POST https://open.meituan.com/user/v2/weappgetmobilelogin`

## 协作流程

1. 本目录存放抓包、脚本、断点笔记与算法还原产物。
2. WMPFDebugger 就绪后，由用户启动美团小程序并触发微信 code 登录。
3. 用 wmpf-reverse 抓取 `weappgetmobilelogin` 请求，定位参数生成脚本并还原本地算法。

## 参数清单（来自样本 curl）

### Query

| 参数 | 样本值 | 初步判断 |
|------|--------|----------|
| sdkVersion | 4.1.12.24 | 登录 SDK 版本，偏静态 |
| utm_medium | windows | 运行环境 |
| joinkey | 100279_-937826947 | 会话/渠道拼接，待逆向 |
| sdkType | wxmp | 固定：微信小程序 |
| login_sdk_version | 6.19.1 | 登录 SDK 版本 |
| appName | group | 美团 App 名 |
| risk_app / risk_partner / risk_platform / risk_* | 214 / 0 / 13 / 0 | 风控常量 |
| version_name | 10.31.200 | 小程序版本 |
| token_id | HC3-vUFvZKJtclV_m8PODw | 设备/风控 token，待逆向 |
| uuid | 19fb19e949ac8-... | 设备 uuid，待逆向 |

### Body (x-www-form-urlencoded)

| 参数 | 说明 |
|------|------|
| code | 微信 `wx.login` 临时 code |
| iv / encryptedData | 微信手机号/用户信息加密包（前端拿微信接口返回） |
| wechatFingerprint | 设备指纹串 `WX__ver1.2.0_...`，**已完成纯本地逆向**（见 notes/WECHATFINGERPRINT.md） |
| device_type | microsoft |
| device_os | 微信小程序 |

### Header

| 参数 | 说明 |
|------|------|
| mtgsig | JSON 签名头（a1~a7, x0, d1），重点逆向 |
| Referer | servicewechat.com/`wxde8ac0a21135c07d`/... |

## 产出物

- `captures/` 抓包与解码结果（含成功 token 响应）
- `notes/PARAM_ANALYSIS.md` 参数来源结论（**跳过 mtgsig**）
- `scripts/build_login_params.py` 本地拼装 query/body（常量 + lxcuid）

### wechatFingerprint 纯本地逆向（已完成 ✔）

- `notes/WECHATFINGERPRINT.md` 完整算法与推导
- `notes/jsguard_constants.json` 解出的 PREFIX / KEY / IV
- `notes/finger_verification.json` 校验：解密真实指纹 + 重加密逐字节比对
- `scripts/decode_constants.py` 解 jsguard 混淆字符串表，还原 PREFIX/KEY/IV
- `scripts/finger_local.py` 本地 `encode_fingerprint` / `decode_fingerprint`（AES-128-CBC）
- `scripts/build_finger.py` 离线生成全新指纹（含 `localid` An() 生成）
- `scripts/verify_finger.py` 对比运行时真实指纹（roundtrip 逐字节一致）

一句话公式：

```
wechatFingerprint = "WX__ver1.2.0_CCCC_" + base64( AES-128-CBC-PKCS7(
    key = "z7Jut6Ywr2Pe5Nhx", iv = "0807060504030201",
    plaintext = JSON.stringify(deviceData) ) )
```
