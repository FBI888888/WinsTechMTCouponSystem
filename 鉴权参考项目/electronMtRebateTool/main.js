const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const AuthClient = require('./AuthClient')

const MeituanAPI = require('./services/meituanAPI')
const ProxyService = require('./services/proxyService')
const MtGsigClient = require('./services/mtgsigClient')

process.on('uncaughtException', (error) => {
  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE' || error.code === 'ETIMEDOUT') {
    console.error('网络错误(已忽略):', error.code)
    return
  }
  console.error('未捕获的异常:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('未处理的Promise拒绝:', reason)
})

let mainWindow = null
let proxyService = null
let heartbeatController = null
let isAuthValid = false

const AUTH_CONFIG = {
  apiBaseUrl: 'http://115.190.182.82:3088',
  productName: 'mt_rebate_tools',
  enableSignatureVerification: true
}

const authClient = new AuthClient(AUTH_CONFIG)

const defaultUserDataPath = app.getPath('userData')

function isPortableBuild() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

function getAppDataPath() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  if (isDev) {
    const devPath = path.join(__dirname, 'data')
    if (!fs.existsSync(devPath)) {
      fs.mkdirSync(devPath, { recursive: true })
    }
    return devPath
  }

  if (isPortableBuild()) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    const prodPath = path.join(portableDir, 'data')
    if (!fs.existsSync(prodPath)) {
      fs.mkdirSync(prodPath, { recursive: true })
    }
    return prodPath
  }

  const prodPath = path.join(defaultUserDataPath, 'data')
  if (!fs.existsSync(prodPath)) {
    fs.mkdirSync(prodPath, { recursive: true })
  }
  return prodPath
}

const appDataPath = getAppDataPath()

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  } catch (e) {
    console.error('创建目录失败:', dirPath, e)
  }
}

function migrateLegacyUserDataIfNeeded(nextUserDataPath) {
  try {
    if (!app.isPackaged || isPortableBuild()) return

    const exePath = path.dirname(app.getPath('exe'))
    const legacyUserDataPath = path.join(exePath, 'data', 'userData')
    if (!fs.existsSync(legacyUserDataPath)) return

    ensureDir(nextUserDataPath)

    const legacyFiles = ['mt_accounts.json', 'license.json']
    legacyFiles.forEach((filename) => {
      const from = path.join(legacyUserDataPath, filename)
      const to = path.join(nextUserDataPath, filename)
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.copyFileSync(from, to)
      }
    })
  } catch (e) {
    console.error('迁移旧版用户数据失败:', e)
  }
}

const nextUserDataPath = app.isPackaged && !isPortableBuild()
  ? defaultUserDataPath
  : path.join(appDataPath, 'userData')

migrateLegacyUserDataIfNeeded(nextUserDataPath)

app.setPath('userData', nextUserDataPath)
app.setPath('sessionData', path.join(appDataPath, 'sessionData'))
app.setPath('temp', path.join(appDataPath, 'temp'))
app.setPath('cache', path.join(appDataPath, 'cache'))
app.setPath('logs', path.join(appDataPath, 'logs'))
app.setPath('crashDumps', path.join(appDataPath, 'crashDumps'))

ensureDir(appDataPath)
ensureDir(app.getPath('userData'))
ensureDir(app.getPath('sessionData'))
ensureDir(app.getPath('temp'))
ensureDir(app.getPath('cache'))
ensureDir(app.getPath('logs'))
ensureDir(app.getPath('crashDumps'))

function getLicenseFilePath() {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'license.json')
}

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

function setAuthValid(valid) {
  isAuthValid = valid
  console.log('[Auth] isAuthValid =', valid)
}

function ensureAuthorized() {
  if (!isAuthValid) {
    throw new Error('未授权，请先激活软件')
  }
}

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
      setAuthValid(false)
      if (mainWindow) {
        mainWindow.webContents.send('auth-invalid', { reason })
      }

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
        return 'retry'
      }

      removeLicenseKey()
      return 'exit'
    },
    onVerified: (result) => {
      console.log('授权验证成功:', result)
      if (mainWindow) {
        mainWindow.webContents.send('auth-verified', result)
      }
    }
  })
}

function stopAuthHeartbeat() {
  if (heartbeatController) {
    heartbeatController.stop()
    heartbeatController = null
  }
}

function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '美团联盟个人版查询返利工具',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:3002')
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
  try {
    ensureAuthorized()
    return loadAccounts()
  } catch (error) {
    return { success: false, error: error.message, unauthorized: true }
  }
})

ipcMain.handle('accounts-save', async (event, accounts) => {
  try {
    ensureAuthorized()
    return saveAccounts(accounts)
  } catch (error) {
    return { success: false, error: error.message, unauthorized: true }
  }
})

ipcMain.handle('accounts-check-status', async (event, { userid, token }) => {
  try {
    ensureAuthorized()
    const result = await MeituanAPI.checkCKStatus(userid, token)
    return { success: true, code: result }
  } catch (error) {
    return { success: false, error: error.message, unauthorized: !isAuthValid }
  }
})

ipcMain.handle('accounts-import', async () => {
  try {
    ensureAuthorized()
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
    ensureAuthorized()
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

ipcMain.handle('start-token-capture', async () => {
  try {
    ensureAuthorized()
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
    ensureAuthorized()
    if (proxyService) {
      proxyService.stopTokenCapture()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('reset-certs', async () => {
  try {
    ensureAuthorized()
    if (!proxyService) {
      proxyService = new ProxyService()
    }
    return proxyService.resetCerts()
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('export-excel', async (event, { data, filename, headers, rowStyles }) => {
  try {
    ensureAuthorized()
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

    data.forEach((row) => {
      worksheet.addRow(row)
    })

    if (Array.isArray(rowStyles) && rowStyles.length) {
      const headerOffset = headers && headers.length ? 1 : 0
      const fillMap = {
        red: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } },
        yellow: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }
      }

      for (let i = 0; i < rowStyles.length; i++) {
        const styleKey = rowStyles[i]
        if (!styleKey) continue
        const fill = fillMap[styleKey]
        if (!fill) continue

        const excelRowIndex = headerOffset + 1 + i
        const excelRow = worksheet.getRow(excelRowIndex)
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = fill
        })
      }
    }

    await workbook.xlsx.writeFile(result.filePath)
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('rebate-query', async (event, { account, orderIds }) => {
  try {
    ensureAuthorized()
    const client = MtGsigClient.getInstance(path.join(__dirname, 'mtgsig.js'))
    const results = []

    const shouldRetry = (res) => {
      if (!res || typeof res !== 'object') return false
      if (res.yodaCode === 406) return true
      if (res.error) return true
      return false
    }

    const queryOnce = async (orderId) => {
      return client.getOrderRebateInfo({
        orderViewId: orderId,
        token: account.token,
        userid: account.userid,
        csecuuid: account.csecuuid,
        openId: account.openId,
        openIdCipher: account.openIdCipher
      })
    }

    for (let i = 0; i < orderIds.length; i++) {
      const orderId = String(orderIds[i]).trim()
      if (!orderId) continue

      let res
      try {
        res = await queryOnce(orderId)
        if (shouldRetry(res)) {
          await new Promise(r => setTimeout(r, 500))
          res = await queryOnce(orderId)
        }
      } catch (e) {
        try {
          await new Promise(r => setTimeout(r, 500))
          res = await queryOnce(orderId)
        } catch (e2) {
          res = { error: true, message: e2.message || e.message || '查询失败' }
        }
      }

      console.log('[rebate-query] orderId:', orderId)
      console.log('[rebate-query] response:', res)

      results.push({ orderId, response: res })

      if (i !== orderIds.length - 1) {
        await new Promise(r => setTimeout(r, 350))
      }
    }

    return { success: true, data: results }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('rebate-query-one', async (event, { account, orderId }) => {
  try {
    ensureAuthorized()
    const client = MtGsigClient.getInstance(path.join(__dirname, 'mtgsig.js'))

    const shouldRetry = (res) => {
      if (!res || typeof res !== 'object') return false
      if (res.yodaCode === 406) return true
      if (res.error) return true
      return false
    }

    const queryOnce = async () => {
      return client.getOrderRebateInfo({
        orderViewId: orderId,
        token: account.token,
        userid: account.userid,
        csecuuid: account.csecuuid,
        openId: account.openId,
        openIdCipher: account.openIdCipher
      })
    }

    let res
    try {
      res = await queryOnce()
      if (shouldRetry(res)) {
        await new Promise(r => setTimeout(r, 500))
        res = await queryOnce()
      }
    } catch (e) {
      try {
        await new Promise(r => setTimeout(r, 500))
        res = await queryOnce()
      } catch (e2) {
        res = { error: true, message: e2.message || e.message || '查询失败' }
      }
    }

    console.log('[rebate-query-one] orderId:', orderId)
    console.log('[rebate-query-one] response:', res)
    return { success: true, data: { orderId, response: res } }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('auth-check-local', async () => {
  const licenseKey = loadLicenseKey()

  if (!licenseKey) {
    return { hasLicense: false }
  }

  try {
    const result = await authClient.check(licenseKey)
    const isValid = result.valid || (result.success && result.status === 'active')

    if (isValid) {
      setAuthValid(true)
      startAuthHeartbeat(licenseKey)
      try {
        await authClient.initializeSession(licenseKey)
      } catch (e) {}

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

ipcMain.handle('auth-activate', async (event, licenseKey) => {
  try {
    const result = await authClient.activate(licenseKey)
    if (result.success) {
      setAuthValid(true)
      saveLicenseKey(licenseKey)
      startAuthHeartbeat(licenseKey)
      try {
        await authClient.initializeSession(licenseKey)
      } catch (e) {}

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
      setAuthValid(false)
      stopAuthHeartbeat()
      removeLicenseKey()
      return { success: true }
    }
    return { success: false, reason: result.reason }
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
  setAuthValid(false)
  stopAuthHeartbeat()
  try {
    await authClient.cleanup()
  } catch (e) {}
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
