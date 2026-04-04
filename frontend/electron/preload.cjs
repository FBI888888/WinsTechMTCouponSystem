const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Token capture
  startTokenCapture: () => ipcRenderer.invoke('start-token-capture'),
  stopTokenCapture: () => ipcRenderer.invoke('stop-token-capture'),

  // Account operations
  accountsSave: (accounts) => ipcRenderer.invoke('accounts-save', accounts),
  accountsImport: () => ipcRenderer.invoke('accounts-import'),
  accountsExport: (accounts) => ipcRenderer.invoke('accounts-export', accounts),
  accountsCheckStatus: (params) => ipcRenderer.invoke('accounts-check-status', params),

  // Rebate query (券码查询)
  rebateQueryOne: (params) => ipcRenderer.invoke('rebate-query-one', params),
  // 别名，与功能参考项目保持一致
  apiGetCoupons: (params) => ipcRenderer.invoke('rebate-query-one', { account: { token: params.token }, orderId: params.orderid }),

  // Orders
  getOrders: (params) => ipcRenderer.invoke('get-orders', params),
  // 别名，与功能参考项目保持一致
  apiGetOrders: async (params) => {
    const result = await ipcRenderer.invoke('api-get-orders', params)
    return result
  },
  // Cancel orders sync
  cancelOrdersSync: () => ipcRenderer.invoke('cancel-orders-sync'),

  // Export
  exportExcel: (params) => ipcRenderer.invoke('export-excel', params),

  // Certificates
  resetCerts: () => ipcRenderer.invoke('reset-certs'),

  // Platform info
  platform: process.platform,

  // App version
  getVersion: () => ipcRenderer.invoke('get-version'),

  // 风控检测
  checkRiskControl: (params) => ipcRenderer.invoke('check-risk-control', params),

  // =====================================================
  // 软件鉴权相关 API
  // =====================================================
  authCheckLocal: () => ipcRenderer.invoke('auth-check-local'),
  authActivate: (licenseKey) => ipcRenderer.invoke('auth-activate', licenseKey),
  authValidate: (licenseKey) => ipcRenderer.invoke('auth-validate', licenseKey),
  authDeactivate: () => ipcRenderer.invoke('auth-deactivate'),
  authGetMachineCode: () => ipcRenderer.invoke('auth-get-machine-code'),
  authClearLocal: () => ipcRenderer.invoke('auth-clear-local'),
  authGetFullStatus: () => ipcRenderer.invoke('auth-get-full-status'),

  // 鉴权事件监听（保持回调引用，支持精确移除）
  onAuthInvalid: (callback) => ipcRenderer.on('auth-invalid', callback),
  onAuthVerified: (callback) => ipcRenderer.on('auth-verified', callback),

  // 精确移除单个监听器
  offAuthInvalid: (callback) => ipcRenderer.removeListener('auth-invalid', callback),
  offAuthVerified: (callback) => ipcRenderer.removeListener('auth-verified', callback),

  // 移除某频道全部监听器（保留兼容）
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
