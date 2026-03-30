import React, { useState, useEffect, useRef } from 'react'
import { Key, Shield, CheckCircle, AlertCircle, Loader2, Copy, LogOut, Calendar, Monitor, RefreshCw } from 'lucide-react'

function AuthPage({ onAuthSuccess }) {
  const [licenseKey, setLicenseKey] = useState('')
  const [machineCode, setMachineCode] = useState('')
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [isValidating, setIsValidating] = useState(false)
  const [licenseInfo, setLicenseInfo] = useState(null)
  const hasChecked = useRef(false)

  useEffect(() => {
    if (hasChecked.current) return
    hasChecked.current = true
    getMachineCode()
    checkLocalAuth()
  }, [])

  const getMachineCode = async () => {
    try {
      const result = await window.electronAPI.authGetMachineCode()
      if (result.success) {
        setMachineCode(result.machineCode)
      }
    } catch (error) {
      console.error('获取机器码失败:', error)
    }
  }

  const checkLocalAuth = async () => {
    setIsChecking(true)
    try {
      const result = await window.electronAPI.authCheckLocal()
      
      if (result.hasLicense && result.valid) {
        setStatus({ type: 'success', message: '授权验证成功！' })
        setTimeout(() => {
          onAuthSuccess()
        }, 500)
      } else if (result.hasLicense && !result.valid) {
        const reasonText = getReasonText(result.reason || result.error)
        setStatus({ type: 'error', message: `本地授权无效：${reasonText}，请重新输入授权码` })
      } else {
        setStatus({ type: 'idle', message: '请输入授权码激活软件' })
      }
    } catch (error) {
      setStatus({ type: 'error', message: '检查授权状态失败：' + error.message })
    } finally {
      setIsChecking(false)
    }
  }

  const getReasonText = (reason) => {
    const reasons = {
      'key_invalid': '授权密钥无效',
      'key_expired': '授权密钥已过期',
      'not_activated': '软件未在此机器激活',
      'product_disabled': '产品已禁用',
      'network_error': '网络连接失败',
      'max_devices_reached': '已达到最大设备数限制'
    }
    return reasons[reason] || reason || '未知错误'
  }

  const handleValidate = async () => {
    const key = licenseKey.trim()
    if (!key) {
      setStatus({ type: 'error', message: '请输入授权码！' })
      return
    }

    setIsValidating(true)
    setLicenseInfo(null)
    setStatus({ type: 'loading', message: '正在验证密钥...' })

    try {
      const result = await window.electronAPI.authValidate(key)
      
      if (result.valid) {
        setLicenseInfo(result)
        setStatus({ type: 'success', message: '密钥有效，可以激活' })
      } else {
        const errorMsg = getReasonText(result.reason)
        setStatus({ type: 'error', message: `密钥无效：${errorMsg}` })
      }
    } catch (error) {
      setStatus({ type: 'error', message: '验证失败：' + error.message })
    } finally {
      setIsValidating(false)
    }
  }

  const handleActivate = async () => {
    const key = licenseKey.trim()
    if (!key) {
      setStatus({ type: 'error', message: '请输入授权码！' })
      return
    }

    setIsLoading(true)
    setStatus({ type: 'loading', message: '正在激活授权码...' })

    try {
      const result = await window.electronAPI.authActivate(key)
      
      if (result.success) {
        const fullStatus = await window.electronAPI.authGetFullStatus()
        const expiryText = fullStatus.isPermanent ? '永久有效' : `${fullStatus.expiresAtText} (剩余${fullStatus.remainingDays}天)`
        const switchText = `已使用 ${fullStatus.switchCount}/${fullStatus.maxSwitches} 次设备切换`
        
        setStatus({ 
          type: 'success', 
          message: `激活成功！有效期: ${expiryText}，${switchText}` 
        })
        setTimeout(() => {
          onAuthSuccess()
        }, 2000)
      } else {
        const errorMsg = result.error || getReasonText(result.reason)
        setStatus({ type: 'error', message: `激活失败：${errorMsg}` })
      }
    } catch (error) {
      setStatus({ type: 'error', message: '激活失败：' + error.message })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopyMachineCode = () => {
    if (machineCode) {
      navigator.clipboard.writeText(machineCode)
      setStatus({ type: 'info', message: '机器码已复制到剪贴板' })
    }
  }

  const handleClearAuth = async () => {
    if (window.confirm('确定要清除本地授权信息吗？清除后需要重新输入授权码。')) {
      await window.electronAPI.authClearLocal()
      setLicenseKey('')
      setStatus({ type: 'idle', message: '授权信息已清除，请重新输入授权码' })
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !isLoading) {
      handleActivate()
    }
  }

  if (isChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">正在检查授权状态...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">软件授权</h1>
          <p className="text-gray-500 mt-2">美团CK券码制作工具</p>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
            <Key className="w-4 h-4" />
            本机机器码
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={machineCode}
              readOnly
              className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 text-sm font-mono"
              placeholder="获取中..."
            />
            <button
              onClick={handleCopyMachineCode}
              className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
              title="复制机器码"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">购买授权时请提供此机器码</p>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
            <Key className="w-4 h-4" />
            授权码
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => {
                setLicenseKey(e.target.value)
                setLicenseInfo(null)
              }}
              onKeyPress={handleKeyPress}
              placeholder="请输入授权码"
              className="flex-1 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              disabled={isLoading || isValidating}
            />
            <button
              onClick={handleValidate}
              disabled={isLoading || isValidating || !licenseKey.trim()}
              className={`px-4 py-3 rounded-lg font-medium transition-all flex items-center gap-1 ${
                isLoading || isValidating || !licenseKey.trim()
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              title="验证密钥"
            >
              {isValidating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {licenseInfo && (
          <div className="mb-6 p-4 bg-orange-50 rounded-lg border border-orange-100">
            <h3 className="text-sm font-medium text-orange-800 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              密钥信息
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> 有效期
                </span>
                <span className={`font-medium ${
                  licenseInfo.expiresAt ? 'text-orange-600' : 'text-green-600'
                }`}>
                  {licenseInfo.expiresAt 
                    ? new Date(licenseInfo.expiresAt).toLocaleDateString('zh-CN')
                    : '永久有效'
                  }
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 flex items-center gap-1">
                  <Monitor className="w-3 h-3" /> 激活情况
                </span>
                <span className="text-gray-800 font-medium">
                  {licenseInfo.currentActivations || 0} / {licenseInfo.maxActivations || 3} 台设备
                </span>
              </div>
            </div>
          </div>
        )}

        {status.message && (
          <div className={`mb-6 p-3 rounded-lg flex items-center gap-2 text-sm ${
            status.type === 'success' ? 'bg-green-50 text-green-700' :
            status.type === 'error' ? 'bg-red-50 text-red-700' :
            status.type === 'loading' ? 'bg-orange-50 text-orange-700' :
            status.type === 'info' ? 'bg-blue-50 text-blue-700' :
            'bg-gray-50 text-gray-700'
          }`}>
            {status.type === 'success' && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
            {status.type === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {status.type === 'loading' && <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />}
            {status.type === 'info' && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
            <span>{status.message}</span>
          </div>
        )}

        <button
          onClick={handleActivate}
          disabled={isLoading || !licenseKey.trim()}
          className={`w-full py-3 rounded-lg font-medium text-white transition-all flex items-center justify-center gap-2 ${
            isLoading || !licenseKey.trim()
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg hover:shadow-xl'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              激活中...
            </>
          ) : (
            <>
              <Shield className="w-5 h-5" />
              激活授权
            </>
          )}
        </button>

        <button
          onClick={handleClearAuth}
          className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center justify-center gap-1"
        >
          <LogOut className="w-4 h-4" />
          清除本地授权信息
        </button>

        <div className="mt-6 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            如需购买授权码，请联系管理员
          </p>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
