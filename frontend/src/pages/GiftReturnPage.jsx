import { useEffect, useMemo, useRef, useState } from 'react'
import { accountsApi } from '../api'
import { Play, Trash2, RefreshCw, Gift, AlertCircle, CheckCircle2, XCircle, Clock, ShieldAlert, Square } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { getErrorMessage } from '../utils/requestFeedback'

const RETURN_INTERVAL_MS = 1000

function GiftReturnPage() {
  const {
    accounts,
    accountsLoaded,
    fetchAccounts
  } = useDataStore()
  const toast = useToastStore()

  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [giftIdsText, setGiftIdsText] = useState('')
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const stopRequestedRef = useRef(false)
  const runIdRef = useRef(0)

  useEffect(() => {
    if (!accountsLoaded) {
      fetchAccounts(accountsApi).catch(error => {
        console.error('Failed to load accounts:', error)
        toast.error('账号加载失败: ' + getErrorMessage(error, '未知错误'))
      })
    }
  }, [accountsLoaded, fetchAccounts, toast])

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true
      runIdRef.current += 1
    }
  }, [])

  const selectedAccount = accounts.find(account => account.id === parseInt(selectedAccountId, 10))

  const giftIds = useMemo(() => {
    const normalized = giftIdsText
      .split(/[\n,，\s]+/)
      .map(item => item.trim())
      .filter(Boolean)

    return Array.from(new Set(normalized))
  }, [giftIdsText])

  const summary = useMemo(() => ({
    success: results.filter(item => item.status === 'success').length,
    error: results.filter(item => item.status === 'error').length,
    risk: results.filter(item => item.status === 'risk').length,
    pending: results.filter(item => item.status === 'pending').length,
    skipped: results.filter(item => item.status === 'skipped').length
  }), [results])

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  const getGiftReturnRiskUrl = (payload) => {
    if (!payload) return ''
    return payload?.customData?.generalPageUrl || payload?.data?.customData?.generalPageUrl || ''
  }

  const isGiftReturnRiskControl = (payload, fallbackMessage = '') => {
    const messageText = [payload?.message, payload?.msg, fallbackMessage]
      .filter(Boolean)
      .join(' ')
    return (
      payload?.yodaCode === 406 ||
      Boolean(getGiftReturnRiskUrl(payload)) ||
      payload?.code === 403 ||
      messageText.includes('风控') ||
      messageText.includes('403') ||
      messageText.includes('Forbidden')
    )
  }

  const getGiftReturnErrorMessage = (payload, fallbackMessage = '') => {
    if (!payload && fallbackMessage) return fallbackMessage

    const message =
      payload?.message ||
      payload?.msg ||
      payload?.error ||
      payload?.errorMsg ||
      fallbackMessage

    return message || '退还失�?
  }

  const setResultForGift = (giftId, patch) => {
    setResults(previous => previous.map(item => (
      item.giftId === giftId
        ? { ...item, ...patch, updatedAt: Date.now() }
        : item
    )))
  }

  const validateBeforeRun = () => {
    if (!selectedAccountId || !selectedAccount) {
      toast.warning('请先选择账号')
      return false
    }

    if (!selectedAccount.token) {
      toast.error('当前账号缺少 Token，请先重新抓取并保存')
      return false
    }

    if (!selectedAccount.userid) {
      toast.error('当前账号缺少 UserId，请先重新抓取并保存')
      return false
    }

    if (!giftIds.length) {
      toast.warning('请输入礼物单�?)
      return false
    }

    if (!window.electronAPI?.apiReturnGift) {
      toast.error('当前运行环境不支持礼物退还，请在 Electron 客户端中使用')
      return false
    }

    return true
  }

  const handleReturnGift = async () => {
    if (!validateBeforeRun()) return

    const currentRunId = ++runIdRef.current
    stopRequestedRef.current = false
    setRunning(true)
    setProgress({ current: 0, total: giftIds.length })
    setResults(giftIds.map(giftId => ({
      giftId,
      status: 'waiting',
      message: '等待退�?,
      updatedAt: Date.now()
    })))

    let successCount = 0
    let failCount = 0
    let riskCount = 0
    let skippedCount = 0

    try {
      for (let index = 0; index < giftIds.length; index++) {
        if (stopRequestedRef.current || currentRunId !== runIdRef.current) {
          const remainingGiftIds = giftIds.slice(index)
          skippedCount += remainingGiftIds.length
          setResults(previous => previous.map(item => (
            remainingGiftIds.includes(item.giftId) && ['waiting', 'pending'].includes(item.status)
              ? { ...item, status: 'skipped', message: '已停止，未执�?, updatedAt: Date.now() }
              : item
          )))
          break
        }

        const giftId = giftIds[index]
        setProgress({ current: index + 1, total: giftIds.length })
        setResultForGift(giftId, { status: 'pending', message: '正在退�?..' })

        try {
          const result = await window.electronAPI.apiReturnGift({
            token: selectedAccount.token,
            giftId,
            options: {
              userId: selectedAccount.userid,
              uuid: selectedAccount.csecuuid || '',
              openId: selectedAccount.open_id || '',
              platform: selectedAccount.platform || 'android'
            }
          })

          if (result.success && result.data?.code === 0) {
            const message = result.data?.message || result.data?.msg || '礼物退还成�?
            successCount += 1
            setResultForGift(giftId, { status: 'success', message, raw: result.data })
          } else if (isGiftReturnRiskControl(result?.data, result?.error)) {
            const riskUrl = getGiftReturnRiskUrl(result?.data)
            const message = result?.data?.message || result?.data?.msg || result?.error || '退还礼物时触发风控'
            riskCount += 1
            setResultForGift(giftId, { status: 'risk', message, riskUrl, raw: result?.data })
            if (riskUrl) {
              window.open(riskUrl, '_blank')
            }
          } else {
            const message = getGiftReturnErrorMessage(result?.data, result?.error)
            failCount += 1
            setResultForGift(giftId, { status: 'error', message, raw: result?.data })
          }
        } catch (error) {
          const message = getErrorMessage(error, '未知错误')
          if (isGiftReturnRiskControl(null, message)) {
            riskCount += 1
            setResultForGift(giftId, { status: 'risk', message })
          } else {
            failCount += 1
            setResultForGift(giftId, { status: 'error', message: '退还失�? ' + message })
          }
        }

        if (index < giftIds.length - 1 && !stopRequestedRef.current && currentRunId === runIdRef.current) {
          await delay(RETURN_INTERVAL_MS)
        }
      }

      if (stopRequestedRef.current || currentRunId !== runIdRef.current) {
        toast.warning(`已停�? 成功 ${successCount}，失�?${failCount}，风�?${riskCount}，跳�?${skippedCount}`)
      } else {
        toast.success(`批量退还完�? 成功 ${successCount}，失�?${failCount}，风�?${riskCount}`)
      }
    } finally {
      if (currentRunId === runIdRef.current) {
        setRunning(false)
        stopRequestedRef.current = false
      }
    }
  }

  const handleStop = () => {
    stopRequestedRef.current = true
    runIdRef.current += 1
    setRunning(false)
  }

  const handleClear = () => {
    if (running) return
    setGiftIdsText('')
    setResults([])
    setProgress({ current: 0, total: 0 })
  }

  const getStatusView = (status) => {
    switch (status) {
      case 'success':
        return { text: '成功', className: 'bg-green-100 text-green-800', icon: CheckCircle2 }
      case 'error':
        return { text: '失败', className: 'bg-red-100 text-red-800', icon: XCircle }
      case 'risk':
        return { text: '风控', className: 'bg-amber-100 text-amber-800', icon: ShieldAlert }
      case 'pending':
        return { text: '处理�?, className: 'bg-blue-100 text-blue-800', icon: RefreshCw }
      case 'skipped':
        return { text: '跳过', className: 'bg-gray-100 text-gray-700', icon: Square }
      default:
        return { text: '等待', className: 'bg-gray-100 text-gray-600', icon: Clock }
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="min-w-[220px]">
            <label className="block text-xs text-gray-500 mb-1">选择账号</label>
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={running}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-50"
            >
              <option value="" disabled>{accounts.length === 0 ? '暂无账号' : '请选择账号'}</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.remark || account.userid}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleClear}
            disabled={running}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 flex items-center gap-2 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" /> 清空
          </button>

          <button
            onClick={handleReturnGift}
            disabled={running}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 disabled:opacity-50"
          >
            {running ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                退还中 {progress.current}/{progress.total}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> 一键退还礼�?
              </>
            )}
          </button>

          <button
            onClick={handleStop}
            disabled={!running}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-2 disabled:opacity-50"
          >
            <Square className="w-4 h-4" /> 停止
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-gray-500 mb-1">
            输入礼物单号（每行一个，也支持逗号或空格分隔）
          </label>
          <textarea
            value={giftIdsText}
            onChange={(event) => setGiftIdsText(event.target.value)}
            disabled={running}
            placeholder={`例如：\ngift_xxxxxxxxxxxxxxxxxxxx\nGFT202605090001`}
            className="w-full h-32 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none font-mono text-sm disabled:bg-gray-50"
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
            <span>已识�?{giftIds.length} 个礼物单号，重复单号会自动去重�?/span>
            <span>批量退还间隔：{RETURN_INTERVAL_MS / 1000}s / �?/span>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className="font-medium text-gray-700">处理概览</span>
            <span className="px-2 py-1 rounded-full bg-green-50 text-green-700">成功 {summary.success}</span>
            <span className="px-2 py-1 rounded-full bg-red-50 text-red-700">失败 {summary.error}</span>
            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">风控 {summary.risk}</span>
            <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700">处理�?{summary.pending}</span>
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">跳过 {summary.skipped}</span>
          </div>
          {running && (
            <div className="text-xs text-gray-500">
              当前进度 {progress.current}/{progress.total}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        {results.length > 0 ? (
          <div className="overflow-auto h-full">
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">礼物单号</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状�?/th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">返回信息</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">更新时间</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {results.map(item => {
                  const statusView = getStatusView(item.status)
                  const StatusIcon = statusView.icon
                  return (
                    <tr key={item.giftId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono text-gray-900">{item.giftId}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusView.className}`}>
                          <StatusIcon className={`w-3 h-3 ${item.status === 'pending' ? 'animate-spin' : ''}`} />
                          {statusView.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[520px]">
                        <div className="truncate" title={item.message}>{item.message || '-'}</div>
                        {item.riskUrl && (
                          <button
                            onClick={() => window.open(item.riskUrl, '_blank')}
                            className="mt-1 text-xs text-orange-600 hover:text-orange-700"
                          >
                            打开风控验证页面
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center">
              <Gift className="w-7 h-7 text-orange-500" />
            </div>
            <div className="text-sm">请输入礼物单号并点击“一键退还礼物�?/div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <AlertCircle className="w-3 h-3" />
              退还请求在前端客户端中逐个执行，每个礼物单号间�?1 秒�?
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default GiftReturnPage