import { create } from 'zustand'

export const useSoftwareAuthStore = create((set, get) => ({
  // 软件授权状态
  isSoftwareAuthenticated: false,
  isCheckingAuth: true,

  // 授权信息
  licenseInfo: null,
  machineCode: '',

  // 错误信息
  authError: null,

  // 设置授权状态
  setSoftwareAuthenticated: (authenticated) => {
    set({
      isSoftwareAuthenticated: authenticated,
      isCheckingAuth: false
    })
  },

  // 设置检查中状态
  setCheckingAuth: (checking) => {
    set({ isCheckingAuth: checking })
  },

  // 设置授权信息
  setLicenseInfo: (info) => {
    set({ licenseInfo: info })
  },

  // 设置机器码
  setMachineCode: (code) => {
    set({ machineCode: code })
  },

  // 设置错误
  setAuthError: (error) => {
    set({ authError: error })
  },

  // 清除授权
  clearAuth: () => {
    set({
      isSoftwareAuthenticated: false,
      licenseInfo: null,
      authError: null
    })
  },

  // 初始化检查授权状态
  initAuth: async () => {
    set({ isCheckingAuth: true, authError: null })

    try {
      // 获取机器码
      const machineCodeResult = await window.electronAPI.authGetMachineCode()
      if (machineCodeResult.success) {
        set({ machineCode: machineCodeResult.machineCode })
      }

      // 检查本地授权
      const result = await window.electronAPI.authCheckLocal()

      if (result.hasLicense && result.valid) {
        set({
          isSoftwareAuthenticated: true,
          isCheckingAuth: false,
          licenseInfo: {
            isPermanent: result.isPermanent,
            expiresAt: result.expiresAt,
            expiresAtText: result.expiresAtText,
            remainingDays: result.remainingDays,
            switchCount: result.switchCount,
            maxSwitches: result.maxSwitches,
            remainingSwitches: result.remainingSwitches
          }
        })
        return true
      } else if (result.hasLicense && !result.valid) {
        set({
          isSoftwareAuthenticated: false,
          isCheckingAuth: false,
          authError: result.reason || result.error || '授权无效'
        })
      } else {
        set({
          isSoftwareAuthenticated: false,
          isCheckingAuth: false
        })
      }
      return false
    } catch (error) {
      set({
        isSoftwareAuthenticated: false,
        isCheckingAuth: false,
        authError: error.message
      })
      return false
    }
  },

  // 激活授权
  activate: async (licenseKey) => {
    set({ isCheckingAuth: true, authError: null })

    try {
      const result = await window.electronAPI.authActivate(licenseKey)

      if (result.success) {
        const fullStatus = await window.electronAPI.authGetFullStatus()
        set({
          isSoftwareAuthenticated: true,
          isCheckingAuth: false,
          licenseInfo: {
            isPermanent: fullStatus.isPermanent,
            expiresAt: fullStatus.expiresAt,
            expiresAtText: fullStatus.expiresAtText,
            remainingDays: fullStatus.remainingDays,
            switchCount: fullStatus.switchCount,
            maxSwitches: fullStatus.maxSwitches,
            remainingSwitches: fullStatus.remainingSwitches
          }
        })
        return { success: true }
      }

      set({ isCheckingAuth: false })
      return { success: false, error: result.error || result.reason || '激活失败' }
    } catch (error) {
      set({ isCheckingAuth: false })
      return { success: false, error: error.message }
    }
  },

  // 清除本地授权
  clearLocalAuth: async () => {
    try {
      await window.electronAPI.authClearLocal()
      set({
        isSoftwareAuthenticated: false,
        licenseInfo: null,
        authError: null
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}))
