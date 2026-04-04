const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const AuthClient = require('./AuthClient.cjs')

// Enable logging
const logPath = path.join(app.getPath('userData'), 'logs')
if (!fs.existsSync(logPath)) {
  fs.mkdirSync(logPath, { recursive: true })
}
const logFile = path.join(logPath, `app-${new Date().toISOString().split('T')[0]}.log`)

function log(level, message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] [${level}] ${message}\n`
  fs.appendFileSync(logFile, logMessage)
  console.log(logMessage.trim())
}

// Global exception handler - only crash on critical errors
process.on('uncaughtException', (error) => {
  // Ignore network-related errors that are common in proxy operations
  if (error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' ||
      error.code === 'EPIPE' || error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
    log('WARN', `Network error (ignored): ${error.message}`)
    return
  }
  log('ERROR', `Uncaught Exception: ${error.message}\n${error.stack}`)
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log('ERROR', `Unhandled Rejection: ${reason}`)
})

log('INFO', 'Application starting...')

let mainWindow = null
let proxyServer = null
let heartbeatController = null

// 鉴权配置
const AUTH_CONFIG = {
  apiBaseUrl: 'http://115.190.182.82:3088',
  productName: 'mt_coupon_system',
  enableSignatureVerification: true
}

const authClient = new AuthClient(AUTH_CONFIG)

// 获取许可证文件路径
function getLicenseFilePath() {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'license.json')
}

// 保存授权码
function saveLicenseKey(licenseKey) {
  try {
    const filePath = getLicenseFilePath()
    fs.writeFileSync(filePath, JSON.stringify({ licenseKey, savedAt: Date.now() }))
    return true
  } catch (error) {
    log('ERROR', `保存授权码失败: ${error.message}`)
    return false
  }
}

// 读取授权码
function loadLicenseKey() {
  try {
    const filePath = getLicenseFilePath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return data.licenseKey
    }
  } catch (error) {
    log('ERROR', `读取授权码失败: ${error.message}`)
  }
  return null
}

// 删除授权码
function removeLicenseKey() {
  try {
    const filePath = getLicenseFilePath()
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch (error) {
    log('ERROR', `删除授权码失败: ${error.message}`)
    return false
  }
}

// 记录鉴权状态日志
function setAuthValid(valid) {
  log('INFO', `[Auth] auth state = ${valid}`)
}

// 启动鉴权心跳
function startAuthHeartbeat(licenseKey) {
  if (heartbeatController) {
    heartbeatController.stop()
  }

  heartbeatController = authClient.startHeartbeat(licenseKey, {
    intervalMs: 30 * 60 * 1000, // 30分钟
    maxRetries: 3,
    retryDelayMs: 5000,
    onInvalid: async (reason) => {
      log('WARN', `授权验证失败: ${reason}`)
      // Bug3 修复：先停止心跳，避免弹窗期间继续触发
      stopAuthHeartbeat()
      setAuthValid(false)

      const reasonText = {
        key_invalid: '授权密钥无效',
        key_expired: '授权密钥已过期',
        not_activated: '软件未激活',
        product_disabled: '产品已禁用',
        network_error: '网络连接失败，请检查网络'
      }[reason] || `验证失败: ${reason}`

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '授权验证失败',
        message: reasonText,
        detail: '请检查您的授权状态。您可以重试验证或退出软件重新授权。',
        buttons: ['重试', '退出软件'],
        defaultId: 0,
        cancelId: 1
      })

      if (result.response === 0) {
        // 用户选择重试：通知渲染进程回到鉴权页面重新激活
        if (mainWindow) {
          mainWindow.webContents.send('auth-invalid', { reason })
        }
        return 'retry'
      }

      // 用户选择退出：清除授权并退出应用
      removeLicenseKey()
      app.quit()
      return 'exit'
    },
    onVerified: (result) => {
      log('INFO', `授权验证成功: ${JSON.stringify(result)}`)
      if (mainWindow) {
        mainWindow.webContents.send('auth-verified', result)
      }
    }
  })
}

// 停止鉴权心跳
function stopAuthHeartbeat() {
  if (heartbeatController) {
    heartbeatController.stop()
    heartbeatController = null
  }
}

// Import proxy service
const ProxyService = require('./proxy/proxyService.cjs')

function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'WinsTechMT券码库管理系统',
    icon: path.join(__dirname, '../win.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false,
    backgroundColor: '#f3f4f6'
  })

  // Load the app
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 开发者工具快捷键 (Ctrl/Cmd + Shift + I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'I' && (input.control || input.meta) && input.shift) {
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    log('INFO', 'Main window shown')
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Initialize proxy service
async function initProxy() {
  try {
    proxyServer = new ProxyService()
    await proxyServer.start()
    log('INFO', 'Proxy server started')
  } catch (error) {
    log('ERROR', `Failed to start proxy: ${error.message}`)
  }
}

app.whenReady().then(async () => {
  log('INFO', 'App ready')
  createWindow()
  await initProxy()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopAuthHeartbeat()
  if (proxyServer) {
    proxyServer.stop()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAuthHeartbeat()
  if (proxyServer) {
    proxyServer.stop()
  }
})

// IPC Handlers

// Token capture
ipcMain.handle('start-token-capture', async (event, port) => {
  log('INFO', 'Starting token capture')
  if (!proxyServer) {
    return { success: false, error: 'Proxy not initialized' }
  }
  return proxyServer.startCapture(port || 8898)
})

ipcMain.handle('stop-token-capture', async () => {
  log('INFO', 'Stopping token capture')
  if (proxyServer) {
    return proxyServer.stopCapture()
  }
  return { success: true }
})

// Account management - use API instead of local storage
ipcMain.handle('accounts-get', async () => {
  // This will be handled by React calling API directly
  return { success: true }
})

ipcMain.handle('accounts-save', async (event, accounts) => {
  // This will be handled by React calling API directly
  return { success: true }
})

// Account status check
ipcMain.handle('accounts-check-status', async (event, { userid, token }) => {
  try {
    const MeituanAPI = require('./services/meituanAPI.cjs')
    const result = await MeituanAPI.checkCKStatus(userid, token)
    return { success: result === 0, code: result }
  } catch (error) {
    log('ERROR', `Check status error: ${error.message}`)
    return { success: false, error: error.message }
  }
})

// Rebate query - 使用 MeituanAPI 获取券码信息
ipcMain.handle('rebate-query-one', async (event, { account, orderId }) => {
  try {
    const MeituanAPI = require('./services/meituanAPI.cjs')

    const result = await MeituanAPI.getCouponListByOrderId(account.token, orderId, {
      longitude: account.longitude,
      latitude: account.latitude,
      userId: account.userid,
      openId: account.openId,
      uuid: account.csecuuid || 'c34d9b03-7520-47e3-9d7c-17a3d930c48d'
    })

    return { success: true, data: { orderId, response: { data: result.coupons } } }
  } catch (error) {
    log('ERROR', `Rebate query error: ${error.message}`)
    return { success: false, error: error.message }
  }
})

// Get orders from Meituan API
ipcMain.handle('get-orders', async (event, { account, offset, limit, statusFilter }) => {
  try {
    const axios = require('axios')

    const status = statusFilter !== undefined ? statusFilter : 0
    const url = `https://ordercenter.meituan.com/ordercenter/user/orders?userid=${account.userid}&token=${account.token}&offset=${offset}&limit=${limit}&platformid=6&statusFilter=${status}&version=0&yodaReady=wx&csecappid=wxde8ac0a21135c07d&csecplatform=3&csecversionname=9.25.105&csecversion=1.4.0`

    const headers = {
      'Host': 'ordercenter.meituan.com',
      'Connection': 'keep-alive',
      'User-Agent': '',
      'xweb_xhr': '1',
      'utm_medium': '',
      'clientversion': '3.8.9',
      'Accept': '*/*',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://servicewechat.com/wxde8ac0a21135c07d/1451/page-frame.html',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }

    const response = await axios.get(url, { headers, timeout: 30000 })

    if (response.data?.code === 0) {
      return { success: true, data: response.data }
    } else {
      return { success: false, code: response.data?.code, message: response.data?.msg || 'Failed to get orders' }
    }
  } catch (error) {
    log('ERROR', `Get orders error: ${error.message}`)
    return { success: false, error: error.message }
  }
})

// 当前订单同步操作ID
let currentOrdersOperationId = null

// API: Get orders list with status filter
ipcMain.handle('api-get-orders', async (event, { userid, token, days, statusFilter, maxPages }) => {
  try {
    const MeituanAPI = require('./services/meituanAPI.cjs')
    
    // 生成新的操作ID
    currentOrdersOperationId = MeituanAPI.generateOperationId()
    log('INFO', `开始订单同步, operationId: ${currentOrdersOperationId}`)
    
    const result = await MeituanAPI.getOrdersListWithStatus(
      userid, 
      token, 
      days || 7, 
      statusFilter || 0, 
      maxPages || 200,
      currentOrdersOperationId
    )
    
    currentOrdersOperationId = null
    
    if (result.cancelled) {
      log('INFO', '订单同步已取消')
      return { success: true, data: result.orders, cancelled: true }
    }
    
    return { success: true, data: result.orders }
  } catch (error) {
    currentOrdersOperationId = null
    log('ERROR', `API get orders error: ${error.message}`)
    return { success: false, error: error.message }
  }
})

// API: Cancel orders sync
ipcMain.handle('cancel-orders-sync', async () => {
  const MeituanAPI = require('./services/meituanAPI.cjs')
  if (currentOrdersOperationId) {
    log('INFO', `取消订单同步, operationId: ${currentOrdersOperationId}`)
    MeituanAPI.setCancelFlag(currentOrdersOperationId, true)
    return { success: true }
  }
  return { success: false, message: 'No active sync operation' }
})

ipcMain.handle('api-return-gift', async (event, { token, giftId, options }) => {
  try {
    const MeituanAPI = require('./services/meituanAPI.cjs')
    const result = await MeituanAPI.returnGift(token, giftId, options)
    return { success: true, data: result }
  } catch (error) {
    log('ERROR', `Return gift error: ${error.message}`)
    return { success: false, error: error.message }
  }
})

// Export excel
ipcMain.handle('export-excel', async (event, { data, filename, headers }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })

    if (result.canceled) {
      return { cancelled: true }
    }

    // Simple export - just save as CSV for now
    const csvContent = [
      headers.join(','),
      ...data.map(row => row.join(','))
    ].join('\n')

    fs.writeFileSync(result.filePath, '\ufeff' + csvContent, 'utf8')
    return { success: true, path: result.filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Import accounts
ipcMain.handle('accounts-import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled) {
      return { cancelled: true }
    }

    const content = fs.readFileSync(result.filePaths[0], 'utf8')
    const accounts = JSON.parse(content)
    return { success: true, data: accounts }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Export accounts
ipcMain.handle('accounts-export', async (event, accounts) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `accounts-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled) {
      return { cancelled: true }
    }

    fs.writeFileSync(result.filePath, JSON.stringify(accounts, null, 2), 'utf8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Reset certificates
ipcMain.handle('reset-certs', async () => {
  log('INFO', 'Resetting certificates')
  if (proxyServer) {
    await proxyServer.resetCertificates()
    return { success: true }
  }
  return { success: false, error: 'Proxy not initialized' }
})

// 风控检测
ipcMain.handle('check-risk-control', async (event, { token, giftId, userId, openId, uuid }) => {
  try {
    const MeituanAPI = require('./services/meituanAPI.cjs')

    log('INFO', `风控检测 - giftId: ${giftId}, userId: ${userId}`)

    const result = await MeituanAPI.getGiftCouponList(token, giftId, {
      userId: userId || '',
      openId: openId || '',
      uuid: uuid || ''
    })

    return { success: true, data: result }
  } catch (error) {
    log('ERROR', `风控检测失败: ${error.message}`)
    return { success: false, error: error.message }
  }
})

// =====================================================
// 软件鉴权相关 IPC 处理
// =====================================================

// 检查本地授权状态
ipcMain.handle('auth-check-local', async () => {
  const licenseKey = loadLicenseKey()

  if (!licenseKey) {
    return { hasLicense: false }
  }

  try {
    const result = await authClient.check(licenseKey)
    // check() 返回的是 activated 字段（不是 valid/success）
    const isValid = result.activated === true

    if (isValid) {
      setAuthValid(true)
      try {
        await authClient.initializeSession(licenseKey)
      } catch (e) {
        log('WARN', `初始化会话失败: ${e.message}`)
      }
      startAuthHeartbeat(licenseKey)

      return {
        hasLicense: true,
        valid: true,
        licenseKey,
        info: result,
        isPermanent: authClient.isPermanent,
        expiresAt: authClient.licenseExpiresAt,
        expiresAtText: authClient.licenseExpiresAtText,
        remainingDays: authClient.remainingDays,
        switchCount: authClient.switchCount,
        maxSwitches: authClient.maxSwitches,
        remainingSwitches: authClient.remainingSwitches
      }
    }

    return { hasLicense: true, valid: false, reason: result.reason || result.message }
  } catch (error) {
    return { hasLicense: true, valid: false, reason: 'network_error', error: error.message }
  }
})

// 激活授权
ipcMain.handle('auth-activate', async (event, licenseKey) => {
  try {
    const result = await authClient.activate(licenseKey)
    if (result.success) {
      setAuthValid(true)
      saveLicenseKey(licenseKey)
      // Bug5/7 修复：先完成 initializeSession 再延迟启动心跳，避免竞态
      try {
        await authClient.initializeSession(licenseKey)
      } catch (e) {
        log('WARN', `初始化会话失败: ${e.message}`)
      }
      setTimeout(() => startAuthHeartbeat(licenseKey), 2000)

      return {
        success: true,
        info: result,
        isPermanent: authClient.isPermanent,
        expiresAt: authClient.licenseExpiresAt,
        expiresAtText: authClient.licenseExpiresAtText,
        remainingDays: authClient.remainingDays,
        switchCount: authClient.switchCount,
        maxSwitches: authClient.maxSwitches,
        remainingSwitches: authClient.remainingSwitches
      }
    }
    return { success: false, reason: result.reason || '激活失败' }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 验证密钥
ipcMain.handle('auth-validate', async (event, licenseKey) => {
  try {
    const result = await authClient.validate(licenseKey)
    return result
  } catch (error) {
    return { valid: false, error: error.message }
  }
})

// 取消激活
ipcMain.handle('auth-deactivate', async () => {
  const licenseKey = loadLicenseKey()
  if (!licenseKey) {
    return { success: false, reason: '未找到授权码' }
  }

  try {
    const result = await authClient.deactivate(licenseKey)
    if (result.success) {
      setAuthValid(false)
      stopAuthHeartbeat()
      removeLicenseKey()
      return { success: true }
    }
    return { success: false, reason: result.error || result.reason || '取消激活失败' }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取机器码
ipcMain.handle('auth-get-machine-code', async () => {
  try {
    const machineCode = await authClient.getMachineCode()
    return { success: true, machineCode }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 清除本地授权
ipcMain.handle('auth-clear-local', async () => {
  setAuthValid(false)
  stopAuthHeartbeat()
  try {
    await authClient.cleanup()
  } catch (e) {
    log('WARN', `清理授权失败: ${e.message}`)
  }
  removeLicenseKey()
  return { success: true }
})

// 获取完整授权状态
ipcMain.handle('auth-get-full-status', async () => {
  const licenseKey = loadLicenseKey()
  return {
    success: true,
    hasLicense: !!licenseKey,
    hasValidToken: authClient.hasValidToken,
    isPermanent: authClient.isPermanent,
    expiresAt: authClient.licenseExpiresAt,
    expiresAtText: authClient.licenseExpiresAtText,
    remainingDays: authClient.remainingDays,
    switchCount: authClient.switchCount,
    maxSwitches: authClient.maxSwitches,
    remainingSwitches: authClient.remainingSwitches
  }
})
