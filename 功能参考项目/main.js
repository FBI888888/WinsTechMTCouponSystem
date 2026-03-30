const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const AuthClient = require('./AuthClient')

// 全局错误处理 - 避免ECONNRESET等网络错误弹窗
process.on('uncaughtException', (error) => {
  if (error.code === 'ECONNRESET' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'EPIPE' ||
    error.code === 'ETIMEDOUT') {
    console.error('网络错误(已忽略):', error.code)
    return
  }
  console.error('未捕获的异常:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason)
})

// 服务模块
const MeituanAPI = require('./services/meituanAPI')
const ProxyService = require('./services/proxyService')
const QrcodeGenerator = require('./services/qrcodeGenerator')

let mainWindow = null
let proxyService = null
let heartbeatController = null

// ==================== 鉴权配置 ====================
const AUTH_CONFIG = {
  apiBaseUrl: 'http://115.190.182.82:3088',
  productName: 'mt_qrcode_tools',
  enableSignatureVerification: true
}

const authClient = new AuthClient(AUTH_CONFIG)

// 获取应用数据存储目录（根据环境）
function getAppDataPath() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  if (isDev) {
    // 开发环境：当前目录下的 data 文件夹
    const devPath = path.join(__dirname, 'data')
    if (!fs.existsSync(devPath)) {
      fs.mkdirSync(devPath, { recursive: true })
    }
    return devPath
  } else {
    // 生产环境：可执行文件所在目录下的 data 文件夹
    const exePath = path.dirname(app.getPath('exe'))
    const prodPath = path.join(exePath, 'data')
    if (!fs.existsSync(prodPath)) {
      fs.mkdirSync(prodPath, { recursive: true })
    }
    return prodPath
  }
}

// 确保在app ready之前设置路径
const appDataPath = getAppDataPath()
app.setPath('userData', path.join(appDataPath, 'userData'))
app.setPath('sessionData', path.join(appDataPath, 'sessionData'))
app.setPath('temp', path.join(appDataPath, 'temp'))
app.setPath('cache', path.join(appDataPath, 'cache'))
app.setPath('logs', path.join(appDataPath, 'logs'))
app.setPath('crashDumps', path.join(appDataPath, 'crashDumps'))

// 获取授权码存储路径
function getLicenseFilePath() {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'license.json')
}

// 保存授权码到本地
function saveLicenseKey(licenseKey) {
  try {
    const filePath = getLicenseFilePath()
    fs.writeFileSync(filePath, JSON.stringify({ licenseKey, savedAt: Date.now() }))
    return true
  } catch (error) {
    console.error('保存授权码失败:', error)
    return false
  }
}

// 从本地读取授权码
function loadLicenseKey() {
  try {
    const filePath = getLicenseFilePath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return data.licenseKey
    }
  } catch (error) {
    console.error('读取授权码失败:', error)
  }
  return null
}

// 删除本地授权码
function removeLicenseKey() {
  try {
    const filePath = getLicenseFilePath()
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch (error) {
    console.error('删除授权码失败:', error)
    return false
  }
}

// 启动心跳检测
function startAuthHeartbeat(licenseKey) {
  if (heartbeatController) {
    heartbeatController.stop()
  }

  heartbeatController = authClient.startHeartbeat(licenseKey, {
    intervalMs: 30 * 60 * 1000,
    maxRetries: 3,
    retryDelayMs: 5000,
    onInvalid: async (reason) => {
      console.log('授权验证失败:', reason)
      if (mainWindow) {
        mainWindow.webContents.send('auth-invalid', { reason })
      }

      const reasonText = {
        'key_invalid': '授权密钥无效',
        'key_expired': '授权密钥已过期',
        'not_activated': '软件未激活',
        'product_disabled': '产品已禁用',
        'network_error': '网络连接失败，请检查网络'
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
        return 'retry'
      } else {
        removeLicenseKey()
        return 'exit'
      }
    },
    onVerified: (result) => {
      console.log('授权验证成功:', result)
      if (mainWindow) {
        mainWindow.webContents.send('auth-verified', result)
      }
    }
  })
}

// 停止心跳检测
function stopAuthHeartbeat() {
  if (heartbeatController) {
    heartbeatController.stop()
    heartbeatController = null
  }
}

function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,  // 启用 webview 标签
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: '美团CK券码制作工具 v2.6',
    show: false
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:3001')
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  proxyService = new ProxyService()

  // 应用启动时清理可能残留的代理设置（防止上次异常退出导致网络问题）
  proxyService.ensureProxyDisabled()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopAuthHeartbeat()
  if (proxyService) {
    proxyService.stop()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAuthHeartbeat()
  if (proxyService) {
    proxyService.stop()
  }
})

// ==================== 账号管理 IPC ====================
function getAccountsFilePath() {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'mt_accounts.json')
}

function loadAccounts() {
  try {
    const filePath = getAccountsFilePath()
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (error) {
    console.error('读取账号失败:', error)
  }
  return []
}

function saveAccounts(accounts) {
  try {
    const filePath = getAccountsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('保存账号失败:', error)
    return false
  }
}

ipcMain.handle('accounts-list', async () => {
  return loadAccounts()
})

ipcMain.handle('accounts-save', async (event, accounts) => {
  return saveAccounts(accounts)
})

ipcMain.handle('accounts-check-status', async (event, { userid, token }) => {
  try {
    const result = await MeituanAPI.checkCKStatus(userid, token)
    return { success: true, code: result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('accounts-import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入账号JSON',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) {
      return { success: false, cancelled: true }
    }
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'))
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('accounts-export', async (event, accounts) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出账号JSON',
      defaultPath: 'mt_accounts.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { success: false, cancelled: true }
    }
    fs.writeFileSync(result.filePath, JSON.stringify(accounts, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 订单/券码 API IPC ====================
ipcMain.handle('api-get-orders', async (event, { userid, token, days, statusFilter }) => {
  try {
    const orders = await MeituanAPI.getOrdersListWithStatus(userid, token, days, statusFilter)
    return { success: true, data: orders }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('api-get-coupons', async (event, { token, orderid, longitude, latitude }) => {
  try {
    const result = await MeituanAPI.getCouponListByOrderId(token, orderid, { longitude, latitude })
    // result 现在是 { coupons: [...], shopLocation: { lat, lng } | null }
    return { success: true, data: result.coupons, shopLocation: result.shopLocation }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('api-get-long-order-url', async (event, { token, orderid }) => {
  try {
    const result = await MeituanAPI.getLongMtOrderUrl(token, orderid)
    return result
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('api-get-sku-shops', async (event, { token, sku, limit, offset }) => {
  try {
    const data = await MeituanAPI.getSkuShops({ token, sku, limit, offset })
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('api-return-gift', async (event, { token, giftId, options }) => {
  try {
    const result = await MeituanAPI.returnGift(token, giftId, options)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 券码图片生成 IPC ====================
ipcMain.handle('generate-qrcode-image', async (event, { title, couponCode, notes, dateText }) => {
  try {
    const result = await QrcodeGenerator.generateCouponImage(title, couponCode, notes, dateText)
    // 结果已包含 success 和 imageBase64 字段
    return result
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== Webview Cookie管理 IPC ====================
ipcMain.handle('webview-set-cookies', async (event, { partition, cookies }) => {
  try {
    const { session } = require('electron')
    const ses = session.fromPartition(partition || 'persist:webview')

    for (const cookie of cookies) {
      await ses.cookies.set(cookie)
    }

    return { success: true }
  } catch (error) {
    console.error('设置cookies失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('webview-clear-cookies', async (event, { partition }) => {
  try {
    const { session } = require('electron')
    const ses = session.fromPartition(partition || 'persist:webview')
    await ses.clearStorageData({ storages: ['cookies'] })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 礼物监控抓包 IPC ====================
ipcMain.handle('start-gift-monitor', async (event, port) => {
  try {
    if (!proxyService) {
      proxyService = new ProxyService()
    }

    await proxyService.startGiftMonitor(port || 8899, (result) => {
      if (!mainWindow) return
      if (result.type === 'gift') {
        mainWindow.webContents.send('gift-data-received', result.data)
      } else if (result.type === 'log') {
        mainWindow.webContents.send('gift-monitor-log', result.message)
      } else if (result.type === 'error') {
        mainWindow.webContents.send('gift-monitor-error', result.message)
      }
    })

    return { success: true }
  } catch (error) {
    console.error('启动监控失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('stop-gift-monitor', async () => {
  try {
    if (proxyService) {
      proxyService.stopGiftMonitor()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('reset-certificates', async () => {
  try {
    if (!proxyService) {
      proxyService = new ProxyService()
    }
    const result = proxyService.resetCertificates()
    return result
  } catch (error) {
    console.error('重置证书失败:', error)
    return { success: false, error: error.message }
  }
})

// ==================== Token抓取 IPC ====================
ipcMain.handle('start-token-capture', async () => {
  try {
    if (!proxyService) {
      proxyService = new ProxyService()
    }
    const result = await proxyService.startTokenCapture(8898)
    return result
  } catch (error) {
    console.error('启动Token抓取失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('stop-token-capture', async () => {
  try {
    if (proxyService) {
      proxyService.stopTokenCapture()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 导出 Excel IPC ====================
ipcMain.handle('export-excel', async (event, { data, filename, headers }) => {
  try {
    const ExcelJS = require('exceljs')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出Excel',
      defaultPath: filename || 'data.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, cancelled: true }
    }

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('数据')

    if (headers && headers.length) {
      worksheet.addRow(headers)
    }

    data.forEach(row => {
      worksheet.addRow(row)
    })

    await workbook.xlsx.writeFile(result.filePath)
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 鉴权 IPC ====================
ipcMain.handle('auth-check-local', async () => {
  const licenseKey = loadLicenseKey()

  if (!licenseKey) {
    return { hasLicense: false }
  }

  try {
    const result = await authClient.check(licenseKey)
    const isValid = result.valid || (result.success && result.status === 'active')

    if (isValid) {
      startAuthHeartbeat(licenseKey)
      try {
        await authClient.initializeSession(licenseKey)
      } catch (e) { }

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
    } else {
      return { hasLicense: true, valid: false, reason: result.reason || result.message }
    }
  } catch (error) {
    return { hasLicense: true, valid: false, reason: 'network_error', error: error.message }
  }
})

ipcMain.handle('auth-activate', async (event, licenseKey) => {
  try {
    const result = await authClient.activate(licenseKey)
    if (result.success) {
      saveLicenseKey(licenseKey)
      startAuthHeartbeat(licenseKey)
      try {
        await authClient.initializeSession(licenseKey)
      } catch (e) { }

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
    } else {
      return { success: false, reason: result.reason || '激活失败' }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('auth-validate', async (event, licenseKey) => {
  try {
    const result = await authClient.validate(licenseKey)
    return result
  } catch (error) {
    return { valid: false, error: error.message }
  }
})

ipcMain.handle('auth-deactivate', async () => {
  const licenseKey = loadLicenseKey()
  if (!licenseKey) {
    return { success: false, reason: '未找到授权码' }
  }

  try {
    const result = await authClient.deactivate(licenseKey)
    if (result.success) {
      stopAuthHeartbeat()
      removeLicenseKey()
      return { success: true }
    } else {
      return { success: false, reason: result.reason }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('auth-get-machine-code', async () => {
  try {
    const machineCode = await authClient.getMachineCode()
    return { success: true, machineCode }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('auth-clear-local', async () => {
  stopAuthHeartbeat()
  try {
    await authClient.cleanup()
  } catch (e) { }
  removeLicenseKey()
  return { success: true }
})

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

// ==================== 设备指纹管理 IPC ====================
ipcMain.handle('reset-fingerprint', async () => {
  try {
    const success = MeituanAPI.resetH5guard()
    return { success, message: success ? '设备指纹已重置' : '重置失败' }
  } catch (error) {
    console.error('重置指纹失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-fingerprint-info', async () => {
  try {
    const info = MeituanAPI.getFingerprintInfo()
    return { success: true, data: info }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 其他 ====================
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url)
  return { success: true }
})

ipcMain.handle('get-app-info', async () => {
  return {
    version: app.getVersion(),
    name: app.getName()
  }
})
