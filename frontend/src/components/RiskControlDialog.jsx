import { useEffect, useState } from 'react'
import { Copy, ExternalLink, ShieldAlert, X } from 'lucide-react'
import { useRiskControlStore } from '../stores/riskControlStore'

function RiskControlDialog() {
  const {
    isOpen,
    message,
    generalPageUrl,
    requestCode,
    riskLevel,
    yodaCode,
    closeRiskControl
  } = useRiskControlStore()
  const [copyLabel, setCopyLabel] = useState('复制地址')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    setCopyLabel('复制地址')
    setActionError('')
  }, [isOpen, generalPageUrl])

  if (!isOpen) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generalPageUrl)
      setCopyLabel('已复制')
    } catch {
      setActionError('复制失败，请手动选择地址复制')
    }
  }

  const handleOpen = async () => {
    setActionError('')
    const result = await window.electronAPI.openYodaVerification(generalPageUrl)
    if (!result?.success) {
      setActionError(result?.error || '打开验证页面失败')
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4">
      <div className="w-[560px] max-w-full rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-amber-100 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">需要完成风控验证</h3>
              <p className="mt-1 text-sm text-gray-600">{message}</p>
            </div>
          </div>
          <button
            onClick={closeRiskControl}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/70 hover:text-gray-600"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1.5 text-xs font-medium text-gray-500">验证地址</div>
            <div className="max-h-28 overflow-auto break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-700 select-text">
              {generalPageUrl}
            </div>
          </div>

          {(requestCode || riskLevel || yodaCode !== null) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
              {requestCode && <span>Request Code：{requestCode}</span>}
              {riskLevel && <span>Risk Level：{riskLevel}</span>}
              {yodaCode !== null && <span>Yoda Code：{yodaCode}</span>}
            </div>
          )}

          {actionError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {actionError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Copy className="h-4 w-4" />
            {copyLabel}
          </button>
          <button
            onClick={handleOpen}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            <ExternalLink className="h-4 w-4" />
            打开验证页面
          </button>
        </div>
      </div>
    </div>
  )
}

export default RiskControlDialog