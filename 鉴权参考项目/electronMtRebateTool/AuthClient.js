/**
 * Wins Tech软件综合鉴权系统 JavaScript/Node.js SDK
 * 用于桌面软件集成授权验证
 * 
 * @description
 * 本 SDK 提供完整的软件授权验证功能，包括：
 * - 密钥验证、激活、取消激活
 * - 机器码自动生成
 * - 30分钟强制心跳验证（防绕过）
 * - 验证失败自动重试和UI提示
 * - 会话Token验证（增强安全）
 * - 操作级别验证（防破解）
 * 
 * @example
 * // 基本用法
 * const client = new AuthClient({
 *     apiBaseUrl: 'http://your-server:3088',
 *     productName: 'my_software'
 * });
 * 
 * // 激活软件
 * const result = await client.activate('LIC-001-XXXXXX-XXXX');
 * if (result.success) {
 *     // 获取会话Token（软件启动时调用）
 *     await client.obtainToken('LIC-001-XXXXXX-XXXX');
 *     // 启动心跳验证
 *     client.startHeartbeat('LIC-001-XXXXXX-XXXX', {
 *         onInvalid: (reason) => {
 *             alert('授权失效: ' + reason);
 *             return 'exit'; // 或 'retry'
 *         }
 *     });
 * }
 * 
 * @version 2.0.0
 * @license MIT
 */

// 服务器公钥（用于验证响应签名，防止 Hook 伪造）
const SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvDNJpezE+D97sS4ah9uy
ghPciK/3z61CPXcG4owAfJukcPSaCH3Fl//nsaaUc8OCobHdfxDslnSO2SB+NtWA
4QLQjk2YjcCNnG9C7p8K/yuq7fhdWuVGZ500pAyEKT4Zl2QpQVUBqgI799JrlBMa
2n1wTf23m9K1GxULZDTPENk4MxJxorMqK+6yrnIYXTw2Zx/VNLDZluk6hK4BLya2
QTVoRk0ohydSS7oesvulryn4qWLFikCyPxu3IlwAVKCmuwEcmTEOBBQjvhpl+6Ur
zmXqMzW8CIvI1J3yNkz8I9wX5ErP3WpM2YWijtHb5k6TUWpFOaw/1ZR41oatqkDT
mQIDAQAB
-----END PUBLIC KEY-----`;

class AuthClient {
    /**
     * 创建鉴权客户端实例
     * @param {Object} config - 配置对象
     * @param {string} config.apiBaseUrl - API服务器地址
     * @param {string} config.productName - 产品标识符
     * @param {number} [config.timeout=30000] - 请求超时时间(ms)
     * @param {boolean} [config.enableSignatureVerification=false] - 是否启用签名验证
     */
    constructor(config) {
        if (!config.apiBaseUrl) throw new Error('apiBaseUrl is required');
        if (!config.productName) throw new Error('productName is required');
        
        this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, '');
        this.productName = config.productName;
        this.timeout = config.timeout || 30000;
        this.enableSignatureVerification = config.enableSignatureVerification || false;
        
        // Token相关属性
        this._sessionToken = null;
        this._refreshToken = null;
        this._tokenExpiresAt = null;
        this._refreshExpiresAt = null;
        this._tokenTTLMinutes = 30;
        this._licenseKey = null;
        this._tokenRefreshInterval = null;
        
        // 密钥有效期相关属性
        this._licenseExpiresAt = null;  // 毫秒时间戳
        this._isPermanent = true;
        
        // 设备切换次数相关属性
        this._switchCount = 0;
        this._maxSwitches = 3;
        this._remainingSwitches = 3;
    }
    
    /**
     * 已使用的设备切换次数
     * @returns {number}
     */
    get switchCount() {
        return this._switchCount;
    }
    
    /**
     * 最大允许切换次数
     * @returns {number}
     */
    get maxSwitches() {
        return this._maxSwitches;
    }
    
    /**
     * 剩余可切换次数
     * @returns {number}
     */
    get remainingSwitches() {
        return this._remainingSwitches;
    }
    
    /**
     * 从响应中更新设备切换信息
     * @private
     * @param {Object} result - API响应结果
     */
    _updateSwitchInfo(result) {
        if (result.switchCount !== undefined) {
            this._switchCount = result.switchCount;
        }
        if (result.maxSwitches !== undefined) {
            this._maxSwitches = result.maxSwitches;
        }
        if (result.remainingSwitches !== undefined) {
            this._remainingSwitches = result.remainingSwitches;
        }
    }
    
    /**
     * 获取当前会话Token
     * @returns {string|null}
     */
    get sessionToken() {
        return this._sessionToken;
    }
    
    /**
     * 检查是否有有效的Token
     * @returns {boolean}
     */
    get hasValidToken() {
        if (!this._sessionToken || !this._tokenExpiresAt) return false;
        return Date.now() < this._tokenExpiresAt;
    }
    
    /**
     * 密钥有效期（毫秒时间戳），null 表示永久有效
     * @returns {number|null}
     */
    get licenseExpiresAt() {
        return this._licenseExpiresAt;
    }
    
    /**
     * 密钥是否永久有效
     * @returns {boolean}
     */
    get isPermanent() {
        return this._isPermanent;
    }
    
    /**
     * 密钥剩余天数（-1表示永久，0表示已过期）
     * @returns {number}
     */
    get remainingDays() {
        if (this._isPermanent || !this._licenseExpiresAt) return -1;
        const remainingMs = this._licenseExpiresAt - Date.now();
        const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
        return days > 0 ? days : 0;
    }
    
    /**
     * 获取密钥有效期显示文本
     * @returns {string}
     */
    get licenseExpiresAtText() {
        if (this._isPermanent || !this._licenseExpiresAt) return '永久有效';
        const date = new Date(this._licenseExpiresAt);
        return date.toISOString().split('T')[0];  // YYYY-MM-DD 格式
    }
    
    /**
     * 从响应中更新密钥有效期信息
     * @private
     * @param {Object} result - API响应结果
     */
    _updateLicenseExpiry(result) {
        const expiresAt = result.expiresAt;
        if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
            try {
                const timestamp = new Date(expiresAt).getTime();
                if (!isNaN(timestamp)) {
                    this._licenseExpiresAt = timestamp;
                    this._isPermanent = false;
                }
            } catch (e) {
                // 解析失败，保持原状态
            }
        } else {
            // expiresAt 为 null 表示永久有效
            this._licenseExpiresAt = null;
            this._isPermanent = true;
        }
    }

    /**
     * 发送HTTP请求
     * @private
     * @param {string} endpoint - API端点
     * @param {Object} data - 请求数据
     * @param {Object} [options] - 请求选项
     * @param {boolean} [options.includeToken=false] - 是否包含会话Token
     * @param {boolean} [options.signRequest=false] - 是否对请求签名
     */
    async _request(endpoint, data, options = {}) {
        const { includeToken = false, signRequest = false } = options;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // 添加会话Token
        if (includeToken && this._sessionToken) {
            headers['X-Session-Token'] = this._sessionToken;
        }
        
        const payload = {
            productName: this.productName,
            ...data
        };
        
        // 添加请求签名
        if (signRequest && this._sessionToken) {
            const sigInfo = this._generateRequestSignature(JSON.stringify(payload));
            headers['X-Request-Timestamp'] = sigInfo.timestamp;
            headers['X-Request-Nonce'] = sigInfo.nonce;
            headers['X-Request-Signature'] = sigInfo.signature;
        }

        try {
            const url = `${this.apiBaseUrl}/api/client${endpoint}`;
            const requestBody = JSON.stringify(payload);

            if (endpoint === '/activate') {
                console.log('[AuthClient][activate] request url:', url);
                console.log('[AuthClient][activate] request headers:', headers);
                console.log('[AuthClient][activate] request body:', requestBody);
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: requestBody,
                signal: controller.signal
            });

            const rawText = await response.text();
            let result;
            try {
                result = rawText ? JSON.parse(rawText) : {};
            } catch (e) {
                result = { error: 'invalid_json', message: '服务器返回非JSON', rawText };
            }

            if (endpoint === '/activate') {
                console.log('[AuthClient][activate] response status:', response.status);
                console.log('[AuthClient][activate] response ok:', response.ok);
                console.log('[AuthClient][activate] response raw:', rawText);
                console.log('[AuthClient][activate] response json:', result);
            }
            
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            
            // 验证响应签名（防止 Hook 伪造）
            if (this.enableSignatureVerification) {
                if (!await this._verifySignature(result)) {
                    throw new Error('invalid_signature: 响应签名验证失败，可能存在中间人攻击');
                }
            }
            
            return result;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * 验证响应签名
     * @private
     * @param {Object} result - 响应数据
     * @returns {Promise<boolean>} 签名是否有效
     */
    async _verifySignature(result) {
        try {
            // 检查签名字段
            if (!result._signature || !result._timestamp || !result._nonce) {
                return false;
            }

            const signature = result._signature;
            const timestamp = parseInt(result._timestamp);
            const nonce = result._nonce;

            // 检查时间戳（5分钟有效）
            const now = Date.now();
            if (Math.abs(now - timestamp) > 300000) {
                return false;
            }

            // 重建签名内容
            const dataWithoutSig = { ...result };
            delete dataWithoutSig._signature;
            delete dataWithoutSig._timestamp;
            delete dataWithoutSig._nonce;
            const payload = `${timestamp}|${nonce}|${JSON.stringify(dataWithoutSig)}`;

            // Node.js 环境使用 crypto 模块验证
            if (typeof require !== 'undefined') {
                const crypto = require('crypto');
                const verify = crypto.createVerify('RSA-SHA256');
                verify.update(payload);
                return verify.verify(SERVER_PUBLIC_KEY, signature, 'base64');
            }

            // 浏览器环境使用 SubtleCrypto API
            const pemHeader = '-----BEGIN PUBLIC KEY-----';
            const pemFooter = '-----END PUBLIC KEY-----';
            const pemContents = SERVER_PUBLIC_KEY
                .replace(pemHeader, '')
                .replace(pemFooter, '')
                .replace(/\s/g, '');
            const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

            const publicKey = await crypto.subtle.importKey(
                'spki',
                binaryDer,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify']
            );

            const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
            const payloadBytes = new TextEncoder().encode(payload);

            return await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                publicKey,
                signatureBytes,
                payloadBytes
            );
        } catch (error) {
            console.error('签名验证失败:', error);
            return false;
        }
    }

    /**
     * 获取机器码
     * 在Electron/Node.js环境中使用
     * @returns {Promise<string>} 机器码
     */
    async getMachineCode() {
        // Node.js 环境
        if (typeof require !== 'undefined') {
            const os = require('os');
            const crypto = require('crypto');
            
            const networkInterfaces = os.networkInterfaces();
            let macAddress = '';
            
            for (const interfaces of Object.values(networkInterfaces)) {
                for (const iface of interfaces) {
                    if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
                        macAddress = iface.mac;
                        break;
                    }
                }
                if (macAddress) break;
            }
            
            const cpus = os.cpus();
            const cpuInfo = cpus.length > 0 ? cpus[0].model : '';
            
            const raw = `${macAddress}-${cpuInfo}-${os.hostname()}`;
            return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
        }
        
        // 浏览器环境 (仅用于测试)
        const raw = `${navigator.userAgent}-${screen.width}x${screen.height}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(raw);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
    }

    /**
     * 获取操作系统信息
     * @returns {string} 操作系统信息
     */
    getOsInfo() {
        if (typeof require !== 'undefined') {
            const os = require('os');
            return `${os.platform()} ${os.release()} ${os.arch()}`;
        }
        return navigator.userAgent;
    }

    /**
     * 获取主机名
     * @returns {string} 主机名
     */
    getHostname() {
        if (typeof require !== 'undefined') {
            const os = require('os');
            return os.hostname();
        }
        return 'browser';
    }

    /**
     * 验证密钥有效性（不检查机器码）
     * 仅验证密钥本身是否有效，不判断当前机器是否已激活
     * 
     * @param {string} licenseKey - 授权密钥
     * @returns {Promise<Object>} 验证结果
     * 
     * @example
     * const result = await client.validate('LIC-001-XXXXXX-XXXX');
     * console.log(result);
     * 
     * // 成功响应示例:
     * // {
     * //   valid: true,
     * //   keyType: 'single',           // 'single' | 'aggregate'
     * //   productName: 'my_software',
     * //   productDisplayName: '我的软件',
     * //   expiresAt: '2025-12-31T23:59:59.000Z',  // 可能为 null（永久有效）
     * //   maxActivations: 3,
     * //   currentActivations: 1
     * // }
     * 
     * // 失败响应示例:
     * // {
     * //   valid: false,
     * //   reason: 'key_invalid'  // 可能的值: 'key_invalid', 'key_expired', 'key_disabled', 'product_disabled'
     * // }
     */
    async validate(licenseKey) {
        return this._request('/validate', { licenseKey });
    }

    /**
     * 检查当前机器的激活状态
     * 用于软件启动时检查当前机器是否已激活
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {string} [machineCode] - 机器码（可选，默认自动获取）
     * @returns {Promise<Object>} 检查结果
     * 
     * @example
     * const result = await client.check('LIC-001-XXXXXX-XXXX');
     * console.log(result);
     * 
     * // 已激活响应示例:
     * // {
     * //   activated: true,
     * //   status: 'active',
     * //   activationId: 123,
     * //   activatedAt: '2025-01-01T10:00:00.000Z',
     * //   lastHeartbeat: '2025-01-01T12:00:00.000Z',
     * //   expiresAt: '2025-12-31T23:59:59.000Z',  // 可能为 null
     * //   productName: 'my_software',
     * //   productDisplayName: '我的软件'
     * // }
     * 
     * // 未激活响应示例:
     * // {
     * //   activated: false,
     * //   reason: 'not_activated'  // 可能的值: 'not_activated', 'key_invalid', 'key_expired', 'different_machine'
     * // }
     */
    async check(licenseKey, machineCode) {
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        const result = await this._request('/check', { licenseKey, machineCode });
        
        // 更新有效期信息
        if (result.activated || result.valid) {
            this._updateLicenseExpiry(result);
            this._updateSwitchInfo(result);
        }
        
        return result;
    }

    /**
     * 激活产品
     * 将当前机器码与授权密钥绑定，完成激活
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {string} [machineCode] - 机器码（可选，默认自动获取）
     * @returns {Promise<Object>} 激活结果
     * 
     * @description
     * 激活规则:
     * - 每个密钥最多可激活 3 台机器
     * - 同一机器重复激活会返回已激活状态
     * - 超出激活限制时会自动替换最早的激活记录
     * 
     * @example
     * const result = await client.activate('LIC-001-XXXXXX-XXXX');
     * console.log(result);
     * 
     * // 激活成功响应:
     * // {
     * //   success: true,
     * //   message: '激活成功',
     * //   activationId: 123,
     * //   activatedAt: '2025-01-01T10:00:00.000Z',
     * //   expiresAt: '2025-12-31T23:59:59.000Z',  // 可能为 null
     * //   productName: 'my_software',
     * //   productDisplayName: '我的软件',
     * //   machineCode: 'a1b2c3d4e5f6...',
     * //   replacedActivation: null  // 如果替换了旧激活，这里会有被替换的信息
     * // }
     * 
     * // 已激活响应（同一机器再次激活）:
     * // {
     * //   success: true,
     * //   message: '已激活',
     * //   alreadyActivated: true,
     * //   activationId: 123,
     * //   activatedAt: '2025-01-01T10:00:00.000Z'
     * // }
     * 
     * // 替换激活响应（超出3台限制）:
     * // {
     * //   success: true,
     * //   message: '激活成功，已替换旧设备',
     * //   activationId: 126,
     * //   replacedActivation: {
     * //     machineCode: 'old_machine_code...',
     * //     hostname: 'OLD-PC',
     * //     activatedAt: '2024-12-01T10:00:00.000Z'
     * //   }
     * // }
     * 
     * // 激活失败响应:
     * // {
     * //   success: false,
     * //   error: 'key_invalid'  // 可能的值: 'key_invalid', 'key_expired', 'key_disabled', 'product_disabled'
     * // }
     */
    async activate(licenseKey, machineCode) {
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        
        const result = await this._request('/activate', {
            licenseKey,
            machineCode,
            osInfo: this.getOsInfo(),
            hostname: this.getHostname()
        });
        
        // 激活成功后更新密钥有效期和设备切换信息
        if (result.success) {
            this._updateLicenseExpiry(result);
            this._updateSwitchInfo(result);
        }
        
        return result;
    }

    /**
     * 取消激活
     * 解除当前机器的授权绑定，释放激活名额
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {string} [machineCode] - 机器码（可选，默认自动获取）
     * @returns {Promise<Object>} 取消结果
     * 
     * @example
     * const result = await client.deactivate('LIC-001-XXXXXX-XXXX');
     * console.log(result);
     * 
     * // 成功响应:
     * // {
     * //   success: true,
     * //   message: '已取消激活'
     * // }
     * 
     * // 失败响应:
     * // {
     * //   success: false,
     * //   error: 'not_activated'  // 可能的值: 'not_activated', 'key_invalid'
     * // }
     */
    async deactivate(licenseKey, machineCode) {
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        return this._request('/deactivate', { licenseKey, machineCode });
    }

    /**
     * 心跳检测（定期检查授权状态）
     * 用于定期验证授权是否仍然有效，并更新最后活跃时间
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {string} [machineCode] - 机器码（可选，默认自动获取）
     * @returns {Promise<Object>} 心跳结果
     * 
     * @description
     * 软件应每30分钟调用一次，防止仅启动时验证被绕过。
     * 建议使用 startHeartbeat() 方法自动管理心跳。
     * 
     * @example
     * const result = await client.heartbeat('LIC-001-XXXXXX-XXXX');
     * console.log(result);
     * 
     * // 有效响应:
     * // {
     * //   valid: true,
     * //   status: 'active',
     * //   lastHeartbeat: '2025-01-01T12:30:00.000Z',
     * //   expiresAt: '2025-12-31T23:59:59.000Z',
     * //   serverTime: '2025-01-01T12:30:00.000Z'
     * // }
     * 
     * // 无效响应:
     * // {
     * //   valid: false,
     * //   reason: 'not_activated',  // 可能的值: 'not_activated', 'key_expired', 'key_disabled', 'replaced'
     * //   serverTime: '2025-01-01T12:30:00.000Z'
     * // }
     */
    async heartbeat(licenseKey, machineCode) {
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        const result = await this._request('/heartbeat', { licenseKey, machineCode });
        
        // 更新密钥有效期和设备切换信息
        if (result.valid) {
            this._updateLicenseExpiry(result);
            this._updateSwitchInfo(result);
        }
        
        return result;
    }

    /**
     * 启动定期心跳检测（强制验证）
     * 软件必须每30分钟进行一次验证，防止启动时单次验证被绕过
     * @param {string} licenseKey - 授权密钥
     * @param {Object} [options] - 配置选项
     * @param {number} [options.intervalMs=1800000] - 检测间隔(ms)，默认30分钟
     * @param {number} [options.maxRetries=3] - 失败时最大重试次数
     * @param {number} [options.retryDelayMs=5000] - 重试间隔(ms)
     * @param {Function} [options.onInvalid] - 授权失效时的回调，需返回 'retry' 或 'exit'
     * @param {Function} [options.onVerified] - 验证成功时的回调
     * @returns {Object} 包含 stop() 方法的控制对象
     */
    startHeartbeat(licenseKey, options = {}) {
        const {
            intervalMs = 1800000,  // 默认30分钟
            maxRetries = 3,
            retryDelayMs = 5000,
            onInvalid,
            onVerified
        } = options;

        let machineCode = null;
        let intervalId = null;
        let isRunning = true;
        let consecutiveFailures = 0;
        
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        const verify = async (isRetry = false) => {
            if (!isRunning) return { valid: false, reason: 'stopped' };
            
            try {
                if (!machineCode) {
                    machineCode = await this.getMachineCode();
                }
                const result = await this.heartbeat(licenseKey, machineCode);
                
                if (result.valid) {
                    consecutiveFailures = 0;
                    if (onVerified) {
                        onVerified(result);
                    }
                    return { valid: true, result };
                } else {
                    return { valid: false, reason: result.reason };
                }
            } catch (error) {
                console.error('Heartbeat error:', error);
                return { valid: false, reason: 'network_error', error: error.message };
            }
        };

        const handleFailure = async (reason) => {
            consecutiveFailures++;
            
            // 自动重试
            if (consecutiveFailures <= maxRetries) {
                console.log(`验证失败，${retryDelayMs/1000}秒后重试 (${consecutiveFailures}/${maxRetries})...`);
                await sleep(retryDelayMs);
                const retryResult = await verify(true);
                if (retryResult.valid) {
                    return true; // 重试成功
                }
            }
            
            // 重试用尽，调用失败回调
            if (onInvalid) {
                const action = await Promise.resolve(onInvalid(reason, consecutiveFailures));
                
                if (action === 'retry') {
                    consecutiveFailures = 0; // 重置计数
                    const retryResult = await verify(true);
                    return retryResult.valid;
                } else if (action === 'exit') {
                    stop();
                    return false;
                }
            }
            
            return false;
        };
        
        const check = async () => {
            const result = await verify();
            if (!result.valid) {
                await handleFailure(result.reason);
            }
        };

        const stop = () => {
            isRunning = false;
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        // 立即执行一次验证
        check();
        
        // 定期执行（默认30分钟）
        intervalId = setInterval(check, intervalMs);
        
        // 返回控制对象
        return {
            stop,
            isRunning: () => isRunning,
            forceVerify: verify,
            getFailureCount: () => consecutiveFailures
        };
    }

    /**
     * 创建带UI提示的心跳检测（适用于Electron应用）
     * @param {string} licenseKey - 授权密钥
     * @param {Object} [options] - 配置选项
     * @returns {Object} 控制对象
     */
    startHeartbeatWithDialog(licenseKey, options = {}) {
        // 需要在Electron环境中使用
        const showDialog = async (reason) => {
            if (typeof require !== 'undefined') {
                try {
                    const { dialog, app } = require('electron').remote || require('@electron/remote');
                    
                    const reasonText = {
                        'key_invalid': '授权密钥无效',
                        'key_expired': '授权密钥已过期',
                        'not_activated': '软件未激活',
                        'product_disabled': '产品已禁用',
                        'network_error': '网络连接失败',
                    }[reason] || `验证失败: ${reason}`;
                    
                    const result = await dialog.showMessageBox({
                        type: 'warning',
                        title: '授权验证失败',
                        message: reasonText,
                        detail: '请检查您的授权状态。您可以重试验证或退出软件。',
                        buttons: ['重试', '退出软件'],
                        defaultId: 0,
                        cancelId: 1
                    });
                    
                    return result.response === 0 ? 'retry' : 'exit';
                } catch (e) {
                    console.error('Dialog error:', e);
                    return 'exit';
                }
            }
            
            // 非Electron环境，使用console
            console.error(`授权验证失败: ${reason}`);
            return 'exit';
        };

        return this.startHeartbeat(licenseKey, {
            ...options,
            onInvalid: options.onInvalid || showDialog
        });
    }
    
    // =====================================================
    // Token管理方法
    // =====================================================
    
    /**
     * 生成请求签名
     * @private
     * @param {string} payload - 请求内容JSON字符串
     * @returns {Object} 包含 timestamp, nonce, signature 的对象
     */
    _generateRequestSignature(payload) {
        const timestamp = Date.now().toString();
        const nonce = this._generateNonce();
        const raw = `${this._sessionToken}|${timestamp}|${nonce}|${payload}`;
        
        // Node.js 环境
        if (typeof require !== 'undefined') {
            const crypto = require('crypto');
            const signature = crypto.createHash('sha256').update(raw).digest('hex');
            return { timestamp, nonce, signature };
        }
        
        // 浏览器环境 - 使用简化的哈希
        const signature = this._simpleHash(raw);
        return { timestamp, nonce, signature };
    }
    
    /**
     * 生成随机数
     * @private
     */
    _generateNonce() {
        if (typeof require !== 'undefined') {
            const crypto = require('crypto');
            return crypto.randomBytes(8).toString('hex');
        }
        // 浏览器环境
        return Array.from(crypto.getRandomValues(new Uint8Array(8)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    /**
     * 简化的哈希函数（浏览器环境）
     * @private
     */
    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(64, '0');
    }
    
    /**
     * 获取会话Token
     * 软件启动时必须调用此方法获取Token，后续所有操作都需要携带此Token。
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {string} [machineCode] - 机器码（可选，默认自动获取）
     * @returns {Promise<Object>} Token信息
     * 
     * @example
     * const result = await client.obtainToken('LIC-001-XXXXXX-XXXX');
     * console.log(result);
     * 
     * // 成功响应:
     * // {
     * //   success: true,
     * //   sessionToken: 'abc123...',
     * //   refreshToken: 'xyz789...',
     * //   expiresAt: '2025-01-01T12:30:00.000Z',
     * //   tokenTTLMinutes: 30
     * // }
     */
    async obtainToken(licenseKey, machineCode) {
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        
        const result = await this._request('/token', {
            licenseKey,
            machineCode,
            osInfo: this.getOsInfo(),
            hostname: this.getHostname()
        });
        
        if (result.success) {
            this._sessionToken = result.sessionToken;
            this._refreshToken = result.refreshToken;
            this._licenseKey = licenseKey;
            this._tokenTTLMinutes = result.tokenTTLMinutes || 30;
            
            // 解析过期时间
            if (result.expiresAt) {
                this._tokenExpiresAt = new Date(result.expiresAt).getTime();
            }
            if (result.refreshExpiresAt) {
                this._refreshExpiresAt = new Date(result.refreshExpiresAt).getTime();
            }
        }
        
        return result;
    }
    
    /**
     * 刷新会话Token
     * 在Token即将过期时调用此方法刷新Token。
     * 
     * @param {string} [machineCode] - 机器码（可选）
     * @returns {Promise<Object>} 刷新结果
     */
    async refreshToken(machineCode) {
        if (!this._refreshToken) {
            return { success: false, error: 'no_refresh_token', message: '没有刷新Token' };
        }
        
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        
        const result = await this._request('/token/refresh', {
            refreshToken: this._refreshToken,
            machineCode
        });
        
        if (result.success) {
            this._sessionToken = result.sessionToken;
            this._tokenTTLMinutes = result.tokenTTLMinutes || 30;
            
            if (result.expiresAt) {
                this._tokenExpiresAt = new Date(result.expiresAt).getTime();
            }
        }
        
        return result;
    }
    
    /**
     * 撤销会话Token
     * 软件退出时应调用此方法撤销Token。
     * 
     * @returns {Promise<Object>} 撤销结果
     */
    async revokeToken() {
        if (!this._sessionToken) {
            return { success: false, error: 'no_token', message: '没有活动的会话' };
        }
        
        const result = await this._request('/token/revoke', {}, { includeToken: true });
        
        if (result.success) {
            this._sessionToken = null;
            this._refreshToken = null;
            this._tokenExpiresAt = null;
            this._refreshExpiresAt = null;
        }
        
        return result;
    }
    
    /**
     * 获取会话状态
     * 查询当前会话的详细状态信息。
     * 
     * @returns {Promise<Object>} 状态信息
     */
    async getTokenStatus() {
        if (!this._sessionToken) {
            return { success: false, error: 'no_token', message: '没有活动的会话' };
        }
        
        return this._request('/token/status', {}, { includeToken: true });
    }
    
    /**
     * 验证操作
     * 在执行关键操作前调用此方法验证Token和签名。
     * 如果验证失败，软件应拒绝执行该操作。
     * 
     * @param {string} operationName - 操作名称（如 'export_data', 'save_file' 等）
     * @param {Object} [operationData] - 操作相关数据（可选）
     * @returns {Promise<Object>} 验证结果
     * 
     * @example
     * // 在执行导出操作前验证
     * const result = await client.verifyOperation('export_data', { format: 'csv' });
     * if (result.valid) {
     *     // 执行导出
     *     doExport();
     * } else {
     *     console.log('操作验证失败:', result.message);
     * }
     */
    async verifyOperation(operationName, operationData = null) {
        if (!this._sessionToken) {
            return {
                success: false,
                valid: false,
                error: 'no_token',
                message: '没有活动的会话，请先获取Token'
            };
        }
        
        // 检查Token是否即将过期，如果是则先刷新
        if (this._tokenExpiresAt) {
            const timeRemaining = this._tokenExpiresAt - Date.now();
            if (timeRemaining < 60000) { // 小于1分钟
                const refreshResult = await this.refreshToken();
                if (!refreshResult.success) {
                    return {
                        success: false,
                        valid: false,
                        error: 'token_refresh_failed',
                        message: 'Token刷新失败'
                    };
                }
            }
        }
        
        const data = {
            operationName,
            machineCode: await this.getMachineCode()
        };
        if (operationData) {
            data.operationData = operationData;
        }
        
        return this._request('/verify-operation', data, { includeToken: true, signRequest: true });
    }
    
    /**
     * 启动自动Token刷新
     * 在后台自动刷新Token，确保Token不会过期。
     * 
     * @param {number} [refreshMarginMinutes=5] - 提前刷新的时间（分钟）
     */
    startTokenRefresh(refreshMarginMinutes = 5) {
        this.stopTokenRefresh();
        
        const checkAndRefresh = async () => {
            if (this._tokenExpiresAt) {
                const timeRemaining = this._tokenExpiresAt - Date.now();
                const refreshThreshold = refreshMarginMinutes * 60 * 1000;
                
                if (timeRemaining <= refreshThreshold) {
                    try {
                        const result = await this.refreshToken();
                        if (!result.success) {
                            console.error('自动刷新Token失败:', result.error);
                        }
                    } catch (e) {
                        console.error('自动刷新Token异常:', e);
                    }
                }
            }
        };
        
        // 每分钟检查一次
        this._tokenRefreshInterval = setInterval(checkAndRefresh, 60000);
    }
    
    /**
     * 停止自动Token刷新
     */
    stopTokenRefresh() {
        if (this._tokenRefreshInterval) {
            clearInterval(this._tokenRefreshInterval);
            this._tokenRefreshInterval = null;
        }
    }
    
    /**
     * 带Token的心跳检测
     * 在心跳检测时同时验证Token，提供更强的安全性。
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {string} [machineCode] - 机器码（可选）
     * @returns {Promise<Object>} 心跳结果
     */
    async heartbeatWithToken(licenseKey, machineCode) {
        if (!machineCode) {
            machineCode = await this.getMachineCode();
        }
        
        return this._request('/heartbeat', {
            licenseKey,
            machineCode
        }, { includeToken: true });
    }
    
    /**
     * 初始化会话（推荐的启动方法）
     * 这是软件启动时推荐调用的方法，会自动：
     * 1. 获取会话Token
     * 2. 启动自动Token刷新
     * 
     * @param {string} licenseKey - 授权密钥
     * @param {Object} [options] - 选项
     * @param {boolean} [options.autoRefresh=true] - 是否自动刷新Token
     * @returns {Promise<Object>} 初始化结果
     * 
     * @example
     * const result = await client.initializeSession('LIC-001-XXXXXX-XXXX');
     * if (result.success) {
     *     console.log('会话初始化成功');
     *     // 软件正常运行...
     * } else {
     *     console.log('初始化失败:', result.message);
     * }
     */
    async initializeSession(licenseKey, options = {}) {
        const { autoRefresh = true } = options;
        
        // 获取Token
        const tokenResult = await this.obtainToken(licenseKey);
        if (!tokenResult.success) {
            return tokenResult;
        }
        
        // 启动自动刷新
        if (autoRefresh) {
            this.startTokenRefresh();
        }
        
        return {
            success: true,
            message: '会话初始化成功',
            sessionToken: this._sessionToken,
            expiresAt: tokenResult.expiresAt,
            tokenTTLMinutes: this._tokenTTLMinutes
        };
    }
    
    /**
     * 清理资源
     * 软件退出时调用，会：
     * 1. 停止心跳检测
     * 2. 停止Token刷新
     * 3. 撤销会话Token
     */
    async cleanup() {
        this.stopTokenRefresh();
        try {
            await this.revokeToken();
        } catch (e) {
            // 忽略撤销错误
        }
    }
}

// CommonJS 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthClient;
}

// ES Module 导出
if (typeof window !== 'undefined') {
    window.AuthClient = AuthClient;
}
