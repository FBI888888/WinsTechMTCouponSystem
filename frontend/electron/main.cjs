const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

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

// Import proxy service
const ProxyService = require('./proxy/proxyService.cjs')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
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
  if (proxyServer) {
    proxyServer.stop()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC Handlers

// Token capture
ipcMain.handle('start-token-capture', async () => {
  log('INFO', 'Starting token capture')
  if (!proxyServer) {
    return { success: false, error: 'Proxy not initialized' }
  }
  return proxyServer.startCapture()
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
      uuid: account.csecuuid
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

// API: Get orders list with status filter
ipcMain.handle('api-get-orders', async (event, { userid, token, days, statusFilter, maxPages }) => {
  try {
    const MeituanAPI = require('./services/meituanAPI.cjs')
    const orders = await MeituanAPI.getOrdersListWithStatus(userid, token, days || 7, statusFilter || 0, maxPages || 200)
    return { success: true, data: orders }
  } catch (error) {
    log('ERROR', `API get orders error: ${error.message}`)
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
