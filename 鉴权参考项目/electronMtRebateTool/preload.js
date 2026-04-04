const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 账号管理
  accountsList: () => ipcRenderer.invoke('accounts-list'),
  accountsSave: (accounts) => ipcRenderer.invoke('accounts-save', accounts),
  accountsCheckStatus: (params) => ipcRenderer.invoke('accounts-check-status', params),
  accountsImport: () => ipcRenderer.invoke('accounts-import'),
  accountsExport: (accounts) => ipcRenderer.invoke('accounts-export', accounts),

  // Token抓取
  startTokenCapture: () => ipcRenderer.invoke('start-token-capture'),
  stopTokenCapture: () => ipcRenderer.invoke('stop-token-capture'),
  resetCerts: () => ipcRenderer.invoke('reset-certs'),

  // 导出
  exportExcel: (params) => ipcRenderer.invoke('export-excel', params),

  // 返利查询
  rebateQuery: (params) => ipcRenderer.invoke('rebate-query', params),
  rebateQueryOne: (params) => ipcRenderer.invoke('rebate-query-one', params),

  // 鉴权相关
  authCheckLocal: () => ipcRenderer.invoke('auth-check-local'),
  authActivate: (licenseKey) => ipcRenderer.invoke('auth-activate', licenseKey),
  authValidate: (licenseKey) => ipcRenderer.invoke('auth-validate', licenseKey),
  authDeactivate: () => ipcRenderer.invoke('auth-deactivate'),
  authGetMachineCode: () => ipcRenderer.invoke('auth-get-machine-code'),
  authClearLocal: () => ipcRenderer.invoke('auth-clear-local'),
  authGetFullStatus: () => ipcRenderer.invoke('auth-get-full-status'),
  onAuthInvalid: (callback) => ipcRenderer.on('auth-invalid', (_, data) => callback(data)),
  onAuthVerified: (callback) => ipcRenderer.on('auth-verified', (_, data) => callback(data)),

  // 其他
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
