import { useState, useEffect } from 'react'
import { Key, Shield, Loader2, Copy, LogOut, Calendar, Monitor, RefreshCw } from 'lucide-react'
import { useSoftwareAuthStore } from '../stores/softwareAuthStore'

function AuthPage({ onAuthSuccess }) {
  const [licenseKey, setLicenseKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [licenseInfo, setLicenseInfo] = useState(null)
  const [statusMsg, setStatusMsg] = useState({ type: 'idle', message: '' })

  const machineCode = useSoftwareAuthStore((state) => state.machineCode)
  const authError = useSoftwareAuthStore((state) => state.authError)
  const isCheckingAuth = useSoftwareAuthStore((state) => state.isCheckingAuth)
  const activate = useSoftwareAuthStore((state) => state.activate)
  const clearLocalAuth = useSoftwareAuthStore((state) => state.clearLocalAuth)

  // 将 store 里的 authError 同步到状态提示（本地授权无效时）
  useEffect(() => {
    if (authError) {
      setStatusMsg({ type: 'error', message: `本地授权无效：${getReasonText(authError)}，请重新输入授权码` })
    }
  }, [authError])

  const getReasonText = (reason) => {
    const reasons = {
      key_invalid: '授权密钥无效',
      key_expired: '授权密钥已过期',
      not_activated: '软件未在此机器激活',
      product_disabled: '产品已禁用',
      network_error: '网络连接失败',
      max_devices_reached: '已达到最大设备数限制'
    }
    return reasons[reason] || reason || '未知错误'
  }

  const handleCopyMachineCode = () => {
    if (machineCode) {
      navigator.clipboard.writeText(machineCode)
      setStatusMsg({ type: 'info', message: '机器码已复制到剪贴板' })
    }
  }

  const handleValidate = async () => {
    const key = licenseKey.trim()
    if (!key) {
      setStatusMsg({ type: 'error', message: '请输入授权码！' })
      return
    }

    setIsValidating(true)
    setLicenseInfo(null)
    setStatusMsg({ type: 'loading', message: '正在验证密钥...' })

    try {
      const result = await window.electronAPI.authValidate(key)
      if (result.valid) {
        setLicenseInfo(result)
        setStatusMsg({ type: 'success', message: '密钥有效，点击"激活授权"继续' })
      } else {
        setStatusMsg({ type: 'error', message: `密钥无效：${getReasonText(result.reason)}` })
      }
    } catch (error) {
      setStatusMsg({ type: 'error', message: '验证失败：' + error.message })
    } finally {
      setIsValidating(false)
    }
  }

  const handleActivate = async () => {
    const key = licenseKey.trim()
    if (!key) {
      setStatusMsg({ type: 'error', message: '请输入授权码！' })
      return
    }

    setStatusMsg({ type: 'loading', message: '正在激活授权码...' })

    const result = await activate(key)

    if (result.success) {
      setStatusMsg({ type: 'success', message: '激活成功！正在进入系统...' })
      setTimeout(() => onAuthSuccess(), 800)
    } else {
      setStatusMsg({ type: 'error', message: `激活失败：${getReasonText(result.error)}` })
    }
  }

  const handleClearAuth = async () => {
    if (window.confirm('确定要清除本地授权信息吗？清除后需要重新输入授权码。')) {
      await clearLocalAuth()
      setLicenseKey('')
      setLicenseInfo(null)
      setStatusMsg({ type: 'idle', message: '' })
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isCheckingAuth) {
      handleActivate()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">软件授权验证</h1>
          <p className="text-gray-500 mt-2">WinsTechMT券码库管理系统</p>
        </div>

        {/* 机器码 */}
        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
            <Monitor className="w-4 h-4" />
            本机机器码
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={machineCode}
              readOnly
              className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 text-sm font-mono select-all"
              placeholder="获取中..."
            />
            <button
              onClick={handleCopyMachineCode}
              disabled={!machineCode}
              className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors disabled:opacity-40"
              title="复制机器码"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">购买授权时请提供此机器码</p>
        </div>

        {/* 授权码输入 */}
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
                if (statusMsg.type !== 'idle') setStatusMsg({ type: 'idle', message: '' })
              }}
              onKeyDown={handleKeyDown}
              placeholder="请输入授权码，如 LIC-001-XXXXXX-XXXX"
              className="flex-1 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              disabled={isCheckingAuth}
            />
            <button
              onClick={handleValidate}
              disabled={isCheckingAuth || isValidating || !licenseKey.trim()}
              className="px-3 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="验证密钥有效性"
            >
              {isValidating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />
              }
            </button>
          </div>
        </div>

        {/* 密钥信息预览（验证通过后显示） */}
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
                <span className={`font-medium ${licenseInfo.expiresAt ? 'text-orange-600' : 'text-green-600'}`}>
                  {licenseInfo.expiresAt
                    ? new Date(licenseInfo.expiresAt).toLocaleDateString('zh-CN')
                    : '永久有效'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 flex items-center gap-1">
                  <Monitor className="w-3 h-3" /> 激活情况
                </span>
                <span className="text-gray-800 font-medium">
                  {licenseInfo.currentActivations ?? 0} / {licenseInfo.maxActivations ?? 3} 台设备
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 状态提示 */}
        {statusMsg.message && (
          <div className={`mb-4 p-3 rounded-lg text-sm flex items-start gap-2 ${
            statusMsg.type === 'success' ? 'bg-green-50 text-green-700' :
            statusMsg.type === 'error'   ? 'bg-red-50 text-red-600' :
            statusMsg.type === 'loading' ? 'bg-blue-50 text-blue-600' :
            'bg-gray-50 text-gray-600'
          }`}>
            {statusMsg.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />}
            <span>{statusMsg.message}</span>
          </div>
        )}

        {/* 激活按钮 */}
        <button
          onClick={handleActivate}
          disabled={isCheckingAuth || !licenseKey.trim()}
          className={`w-full py-3 rounded-lg font-medium text-white transition-all flex items-center justify-center gap-2 ${
            isCheckingAuth || !licenseKey.trim()
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg hover:shadow-xl active:scale-[0.98]'
          }`}
        >
          {isCheckingAuth && statusMsg.type === 'loading'
            ? <><Loader2 className="w-5 h-5 animate-spin" />激活中...</>
            : <><Shield className="w-5 h-5" />激活授权</>
          }
        </button>

        {/* 清除授权 */}
        <button
          onClick={handleClearAuth}
          className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-1"
        >
          <LogOut className="w-4 h-4" />
          清除本地授权信息
        </button>

        <div className="mt-6 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">如需购买授权码，请联系管理员</p>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
