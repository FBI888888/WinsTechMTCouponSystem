const { contextBridge, ipcRenderer } = require('electron')

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 账号管理
  accountsList: () => ipcRenderer.invoke('accounts-list'),
  accountsSave: (accounts) => ipcRenderer.invoke('accounts-save', accounts),
  accountsCheckStatus: (params) => ipcRenderer.invoke('accounts-check-status', params),
  accountsImport: () => ipcRenderer.invoke('accounts-import'),
  accountsExport: (accounts) => ipcRenderer.invoke('accounts-export', accounts),

  // 订单/券码 API
  apiGetOrders: (params) => ipcRenderer.invoke('api-get-orders', params),
  apiGetCoupons: (params) => ipcRenderer.invoke('api-get-coupons', params),
  apiGetLongOrderUrl: (params) => ipcRenderer.invoke('api-get-long-order-url', params),
  apiGetSkuShops: (params) => ipcRenderer.invoke('api-get-sku-shops', params),
  apiReturnGift: (params) => ipcRenderer.invoke('api-return-gift', params),

  // 券码图片生成
  generateQrcodeImage: (params) => ipcRenderer.invoke('generate-qrcode-image', params),

  // Webview Cookie管理
  webviewSetCookies: (params) => ipcRenderer.invoke('webview-set-cookies', params),
  webviewClearCookies: (params) => ipcRenderer.invoke('webview-clear-cookies', params),

  // 礼物监控
  startGiftMonitor: (port) => ipcRenderer.invoke('start-gift-monitor', port),
  stopGiftMonitor: () => ipcRenderer.invoke('stop-gift-monitor'),
  resetCertificates: () => ipcRenderer.invoke('reset-certificates'),
  onGiftDataReceived: (callback) => ipcRenderer.on('gift-data-received', (_, data) => callback(data)),
  onGiftMonitorLog: (callback) => ipcRenderer.on('gift-monitor-log', (_, message) => callback(message)),
  onGiftMonitorError: (callback) => ipcRenderer.on('gift-monitor-error', (_, message) => callback(message)),

  // Token抓取
  startTokenCapture: () => ipcRenderer.invoke('start-token-capture'),
  stopTokenCapture: () => ipcRenderer.invoke('stop-token-capture'),

  // 导出
  exportExcel: (params) => ipcRenderer.invoke('export-excel', params),

  // 设备指纹管理
  resetFingerprint: () => ipcRenderer.invoke('reset-fingerprint'),
  getFingerprintInfo: () => ipcRenderer.invoke('get-fingerprint-info'),

  // 其他
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // 移除事件监听
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // 鉴权相关
  authCheckLocal: () => ipcRenderer.invoke('auth-check-local'),
  authActivate: (licenseKey) => ipcRenderer.invoke('auth-activate', licenseKey),
  authValidate: (licenseKey) => ipcRenderer.invoke('auth-validate', licenseKey),
  authDeactivate: () => ipcRenderer.invoke('auth-deactivate'),
  authGetMachineCode: () => ipcRenderer.invoke('auth-get-machine-code'),
  authClearLocal: () => ipcRenderer.invoke('auth-clear-local'),
  authGetFullStatus: () => ipcRenderer.invoke('auth-get-full-status'),
  onAuthInvalid: (callback) => ipcRenderer.on('auth-invalid', (_, data) => callback(data)),
  onAuthVerified: (callback) => ipcRenderer.on('auth-verified', (_, data) => callback(data))
})
