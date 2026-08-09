import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gift,
  ListChecks,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
  XCircle
} from 'lucide-react'
import { accountsApi, giftClaimsApi } from '../api'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { confirm } from '../stores/confirmStore'
import { getErrorMessage, getResultErrorMessage } from '../utils/requestFeedback'
import {
  MEITUAN_PLATFORMS,
  accountToCredential,
  parseMeituanTokenLink
} from '../utils/meituanCredential'
import { runSequentialGiftBatch } from '../utils/giftClaimBatch'
import { filterGiftOrders } from '../utils/giftOrderList'

const CLAIM_INTERVAL_MS = 1000

function CredentialPanel({
  title,
  accounts,
  mode,
  onModeChange,
  accountId,
  onAccountIdChange,
  tokenLink,
  onTokenLinkChange,
  platform,
  onPlatformChange,
  disabled
}) {
  const account = accounts.find((item) => item.id === Number(accountId))

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium text-gray-900">{title}</h2>
        <div className="flex rounded-lg bg-gray-100 p-1 text-xs">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onModeChange('saved')}
            className={`rounded-md px-3 py-1.5 ${mode === 'saved' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
          >
            已保存账号
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onModeChange('temporary')}
            className={`rounded-md px-3 py-1.5 ${mode === 'temporary' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
          >
            临时 Token 链接
          </button>
        </div>
      </div>

      {mode === 'saved' ? (
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <div>
            <label className="mb-1 block text-xs text-gray-500">账号</label>
            <select
              value={accountId}
              onChange={(event) => onAccountIdChange(event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50"
            >
              <option value="">请选择账号</option>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.remark || item.userid}（{item.userid}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">账号平台</label>
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {MEITUAN_PLATFORMS.find((item) => item.value === account?.platform)?.label || '未选择'}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <div>
            <label className="mb-1 block text-xs text-gray-500">美团 Token 链接（仅保留在当前页面内存）</label>
            <textarea
              value={tokenLink}
              onChange={(event) => onTokenLinkChange(event.target.value)}
              disabled={disabled}
              rows={2}
              autoComplete="off"
              spellCheck={false}
              placeholder="粘贴包含 userId 和 token 的完整链接"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">平台（必选）</label>
            <select
              value={platform}
              onChange={(event) => onPlatformChange(event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50"
            >
              <option value="">请选择平台</option>
              {MEITUAN_PLATFORMS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </section>
  )
}

function statusView(status) {
  switch (status) {
    case 'success':
      return { label: '成功', classes: 'bg-green-100 text-green-700', Icon: CheckCircle2 }
    case 'failed':
      return { label: '失败', classes: 'bg-red-100 text-red-700', Icon: XCircle }
    case 'unknown':
      return { label: '结果未知', classes: 'bg-purple-100 text-purple-700', Icon: AlertTriangle }
    case 'paused':
      return { label: '已暂停', classes: 'bg-amber-100 text-amber-700', Icon: PauseCircle }
    case 'processing':
      return { label: '领取中', classes: 'bg-blue-100 text-blue-700', Icon: Loader2 }
    case 'skipped':
      return { label: '已跳过', classes: 'bg-gray-100 text-gray-600', Icon: Square }
    default:
      return { label: '等待', classes: 'bg-gray-100 text-gray-600', Icon: Clock3 }
  }
}

function formatOrderTime(value) {
  if (!value) return '-'
  const timestamp = Number(value) < 10_000_000_000 ? Number(value) * 1000 : Number(value)
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN')
}

function GiftClaimPage() {
  const { accounts, accountsLoaded, fetchAccounts } = useDataStore()
  const toast = useToastStore()

  const [queryMode, setQueryMode] = useState('saved')
  const [queryAccountId, setQueryAccountId] = useState('')
  const [queryTokenLink, setQueryTokenLink] = useState('')
  const [queryPlatform, setQueryPlatform] = useState('')
  const [recipientMode, setRecipientMode] = useState('saved')
  const [recipientAccountId, setRecipientAccountId] = useState('')
  const [recipientTokenLink, setRecipientTokenLink] = useState('')
  const [recipientPlatform, setRecipientPlatform] = useState('')

  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [orderKeyword, setOrderKeyword] = useState('')
  const [orderPage, setOrderPage] = useState(1)
  const [orderPageSize, setOrderPageSize] = useState(20)
  const [orderHasMore, setOrderHasMore] = useState(false)
  const [orderTotal, setOrderTotal] = useState(null)
  const [giftDialog, setGiftDialog] = useState({ open: false, order: null, loading: false, gifts: [] })
  const [selectedGiftIds, setSelectedGiftIds] = useState(new Set())
  const [queue, setQueue] = useState([])
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [lastBatchSummary, setLastBatchSummary] = useState(null)
  const stopRequestedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    // 空列表可能是后端历史账号回填前缓存的结果，页面挂载时重新取一次。
    fetchAccounts(accountsApi, accountsLoaded && accounts.length === 0).catch((error) => {
      toast.error(`账号加载失败：${getErrorMessage(error)}`)
    })
  }, [])

  useEffect(() => {
    if (!accounts.length) return
    const effectiveQueryId = queryAccountId || String(accounts[0].id)
    if (!queryAccountId) setQueryAccountId(effectiveQueryId)
    if (!recipientAccountId) {
      const differentAccount = accounts.find((item) => String(item.id) !== effectiveQueryId)
      if (differentAccount) setRecipientAccountId(String(differentAccount.id))
    }
  }, [accounts, queryAccountId, recipientAccountId])

  useEffect(() => () => {
    mountedRef.current = false
    stopRequestedRef.current = true
  }, [])

  const queueSummary = useMemo(() => ({
    success: queue.filter((item) => item.status === 'success').length,
    failed: queue.filter((item) => item.status === 'failed').length,
    unknown: queue.filter((item) => item.status === 'unknown').length,
    paused: queue.filter((item) => item.status === 'paused').length,
    waiting: queue.filter((item) => item.status === 'waiting').length,
    skipped: queue.filter((item) => item.status === 'skipped').length,
    processing: queue.filter((item) => item.status === 'processing').length
  }), [queue])

  const filteredOrders = useMemo(
    () => filterGiftOrders(orders, orderKeyword),
    [orders, orderKeyword]
  )

  const resolveCredential = (kind) => {
    const isQuery = kind === 'query'
    const mode = isQuery ? queryMode : recipientMode
    if (mode === 'saved') {
      const id = Number(isQuery ? queryAccountId : recipientAccountId)
      return accountToCredential(accounts.find((item) => item.id === id))
    }
    return parseMeituanTokenLink(
      isQuery ? queryTokenLink : recipientTokenLink,
      isQuery ? queryPlatform : recipientPlatform
    )
  }

  const updateQueueItem = (giftId, patch) => {
    if (!mountedRef.current) return
    setQueue((previous) => previous.map((item) => (
      item.gift_id === giftId
        ? { ...item, ...patch, updated_at: Date.now() }
        : item
    )))
  }

  const handleGetOrders = async (requestedPage = 1, requestedPageSize = orderPageSize) => {
    if (!window.electronAPI?.apiGetGiftOrdersPage) {
      toast.error('当前运行环境不支持礼物领取，请在 Electron 客户端中使用')
      return
    }
    let credential
    try {
      credential = resolveCredential('query')
    } catch (error) {
      toast.warning(error.message)
      return
    }

    setOrdersLoading(true)
    try {
      const result = await window.electronAPI.apiGetGiftOrdersPage({
        credential,
        page: requestedPage,
        pageSize: requestedPageSize
      })
      if (!result?.success) throw new Error(getResultErrorMessage(result, '获取订单失败'))
      const pageOrders = Array.isArray(result.data?.orders) ? result.data.orders : []
      if (requestedPage > 1 && pageOrders.length === 0) {
        setOrderHasMore(false)
        toast.info('已经是最后一页')
        return
      }
      setOrders(pageOrders)
      setOrdersLoaded(true)
      setOrderPage(Number(result.data?.page) || requestedPage)
      setOrderPageSize(Number(result.data?.pageSize) || requestedPageSize)
      setOrderHasMore(Boolean(result.data?.hasMore))
      setOrderTotal(Number.isFinite(result.data?.total) ? result.data.total : null)
      toast.success(`已获取第 ${Number(result.data?.page) || requestedPage} 页，共 ${pageOrders.length} 条订单`)
    } catch (error) {
      toast.error(`获取订单失败：${getErrorMessage(error)}`)
    } finally {
      setOrdersLoading(false)
    }
  }

  const loadOrderGifts = async (order, refresh = false) => {
    let credential
    try {
      credential = resolveCredential('query')
    } catch (error) {
      toast.warning(error.message)
      return
    }
    if (!window.electronAPI?.apiGetOrderGifts) {
      toast.error('当前运行环境不支持礼物查询')
      return
    }

    setGiftDialog((previous) => ({
      open: true,
      order,
      loading: true,
      gifts: refresh ? previous.gifts : []
    }))
    setSelectedGiftIds(new Set())
    try {
      const result = await window.electronAPI.apiGetOrderGifts({
        credential,
        orderId: order.orderid || order.stringOrderId
      })
      if (!result?.success) throw new Error(getResultErrorMessage(result, '获取礼物列表失败'))
      const gifts = Array.isArray(result.data?.gifts) ? result.data.gifts : []
      setGiftDialog({ open: true, order, loading: false, gifts })
      toast.success(`找到 ${gifts.length} 个礼物`)
    } catch (error) {
      setGiftDialog((previous) => ({ ...previous, loading: false }))
      toast.error(`获取礼物列表失败：${getErrorMessage(error)}`)
    }
  }

  const toggleGiftSelection = (giftId) => {
    setSelectedGiftIds((previous) => {
      const next = new Set(previous)
      if (next.has(giftId)) next.delete(giftId)
      else next.add(giftId)
      return next
    })
  }

  const selectAllClaimable = () => {
    const ids = giftDialog.gifts.filter((item) => item.claimable).map((item) => item.gift_id)
    const allSelected = ids.length > 0 && ids.every((id) => selectedGiftIds.has(id))
    setSelectedGiftIds(new Set(allSelected ? [] : ids))
  }

  const addSelectedToQueue = () => {
    const selected = giftDialog.gifts.filter(
      (item) => item.claimable && selectedGiftIds.has(item.gift_id)
    )
    if (!selected.length) {
      toast.warning('请选择至少一个待领取礼物')
      return
    }
    setQueue((previous) => {
      const existing = new Set(previous.map((item) => item.gift_id))
      return [
        ...previous,
        ...selected
          .filter((item) => !existing.has(item.gift_id))
          .map((item) => ({ ...item, status: 'waiting', message: '等待领取' }))
      ]
    })
    setGiftDialog({ open: false, order: null, loading: false, gifts: [] })
    setSelectedGiftIds(new Set())
    toast.success(`已加入 ${selected.length} 个礼物到领取队列`)
  }

  const persistResult = async (credential, item, result) => {
    const warnings = []
    if (credential.kind === 'saved' && result.success) {
      try {
        await giftClaimsApi.save({
          account_id: credential.accountId,
          gift_id: item.gift_id,
          order_id: item.source_order_id || null,
          coupon_code: item.coupon_code || null,
          title: item.share_title || null,
          raw_data: { receive: result.raw },
          data_source: 'electron_gift_claim',
          gift_type: 'meituan'
        })
      } catch (error) {
        warnings.push(`领取已成功，但入库失败：${getErrorMessage(error)}`)
      }
    }

    const status = result.success
      ? 'success'
      : result.category === 'risk'
        ? 'risk'
        : result.category === 'unknown'
          ? 'unknown'
          : 'failed'
    try {
      await giftClaimsApi.logEvent({
        gift_id: item.gift_id,
        order_id: item.source_order_id || null,
        platform: credential.platform,
        status,
        result_code: result.code,
        attempts: result.attempts || 1,
        message: result.message,
        recipient_kind: credential.kind,
        account_id: credential.kind === 'saved' ? credential.accountId : null
      })
    } catch (error) {
      warnings.push(`领取结果已产生，但事件日志写入失败：${getErrorMessage(error)}`)
    }
    return warnings.join('；')
  }

  const pauseRemaining = (items, startIndex, message) => {
    const remainingIds = new Set(items.slice(startIndex).map((item) => item.gift_id))
    setQueue((previous) => previous.map((item) => (
      remainingIds.has(item.gift_id) && ['waiting', 'processing', 'paused', 'skipped'].includes(item.status)
        ? { ...item, status: 'paused', message: item.message === '正在领取...' ? message : item.message || message }
        : item
    )))
  }

  const handleStartClaim = async () => {
    if (running) return
    if (!window.electronAPI?.apiReceivePlainGift) {
      toast.error('当前运行环境不支持礼物领取，请在 Electron 客户端中使用')
      return
    }

    let credential
    try {
      credential = resolveCredential('recipient')
    } catch (error) {
      toast.warning(error.message)
      return
    }
    try {
      const queryCredential = resolveCredential('query')
      if (String(queryCredential.userid) === String(credential.userid)) {
        toast.warning('查询账号与领取账号是同一个美团用户，无法领取自己送出的礼物，请更换领取账号')
        return
      }
    } catch (error) {
      toast.warning(`无法校验查询账号：${error.message}`)
      return
    }

    const candidates = queue.filter((item) => ['waiting', 'paused', 'skipped'].includes(item.status))
    if (!candidates.length) {
      toast.warning('领取队列中没有可执行的礼物')
      return
    }
    const accountLabel = credential.kind === 'saved'
      ? (accounts.find((item) => item.id === credential.accountId)?.remark || credential.userid)
      : `临时账号 ${credential.userid}`
    const platformLabel = MEITUAN_PLATFORMS.find((item) => item.value === credential.platform)?.label
    const accepted = await confirm(
      `将使用“${accountLabel}”（${platformLabel}）顺序领取 ${candidates.length} 个礼物，每项间隔 1 秒。确定继续吗？`,
      '确认批量领取'
    )
    if (!accepted) return

    stopRequestedRef.current = false
    setStopping(false)
    setRunning(true)
    setProgress({ current: 0, total: candidates.length })
    setLastBatchSummary(null)
    const runStats = { success: 0, failed: 0, unknown: 0, paused: 0 }

    try {
      const outcome = await runSequentialGiftBatch({
        items: candidates,
        intervalMs: CLAIM_INTERVAL_MS,
        shouldStop: () => stopRequestedRef.current,
        onStart: (item, index) => {
          setProgress({ current: index + 1, total: candidates.length })
          updateQueueItem(item.gift_id, { status: 'processing', message: '正在领取...' })
        },
        onStop: (nextIndex) => {
          pauseRemaining(candidates, nextIndex, '手动停止，尚未发出请求')
        },
        onPause: (nextIndex, decision) => {
          pauseRemaining(candidates, nextIndex, decision.pauseMessage)
        },
        execute: async (item) => {
          if (stopRequestedRef.current) {
            return { stop: true }
          }

          let ipcResult
          try {
            ipcResult = await window.electronAPI.apiReceivePlainGift({
              credential,
              giftId: item.gift_id
            })
          } catch (error) {
            ipcResult = {
              success: true,
              data: {
                success: false,
                category: 'unknown',
                code: null,
                message: `通信异常，领取结果未知：${getErrorMessage(error)}`,
                raw: null
              }
            }
          }

          const result = ipcResult?.success && ipcResult?.data
            ? ipcResult.data
            : {
              success: false,
              category: 'unknown',
              code: null,
              message: getResultErrorMessage(ipcResult, '通信异常，领取结果未知'),
              raw: null
            }
          const persistenceWarning = await persistResult(credential, item, result)
          if (persistenceWarning) toast.warning(persistenceWarning)

          if (result.success) {
            updateQueueItem(item.gift_id, {
              status: 'success',
              message: result.message || '礼物领取成功',
              attempts: result.attempts,
              result_code: result.code,
              persistence_warning: persistenceWarning
            })
            runStats.success += 1
          } else if (result.category === 'unknown') {
            updateQueueItem(item.gift_id, {
              status: 'unknown',
              message: result.message,
              attempts: result.attempts,
              result_code: result.code,
              persistence_warning: persistenceWarning
            })
            runStats.unknown += 1
          } else if (result.category === 'unavailable') {
            updateQueueItem(item.gift_id, {
              status: 'failed',
              message: result.message || '礼物已无法领取',
              attempts: result.attempts,
              result_code: result.code,
              persistence_warning: persistenceWarning
            })
            runStats.failed += 1
          } else if (['limit', 'self_gift', 'risk'].includes(result.category)) {
            const pauseMessage = result.category === 'limit'
              ? '当前账号领取受限，请更换领取账号后继续'
              : result.category === 'self_gift'
                ? '不能领取自己送出的礼物，请更换领取账号后继续'
                : '触发风控，完成验证或更换账号后继续'
            updateQueueItem(item.gift_id, {
              status: 'paused',
              message: result.message || pauseMessage,
              attempts: result.attempts,
              result_code: result.code,
              persistence_warning: persistenceWarning
            })
            if (result.category === 'limit' && credential.kind === 'saved') {
              accountsApi.markCooldown(credential.accountId, {
                hours: 12,
                reason: '1011',
                gift_type: 'meituan'
              }).catch(() => {})
            }
            toast.warning(pauseMessage)
            return { pause: true, pauseMessage, category: result.category }
          } else {
            updateQueueItem(item.gift_id, {
              status: 'failed',
              message: result.message || '领取失败',
              attempts: result.attempts,
              result_code: result.code,
              persistence_warning: persistenceWarning
            })
            runStats.failed += 1
          }
          return { pause: false }
        }
      })

      if (outcome.reason !== 'completed') {
        runStats.paused = Math.max(
          candidates.length - runStats.success - runStats.failed - runStats.unknown,
          0
        )
      }
      setLastBatchSummary({
        ...runStats,
        total: candidates.length,
        reason: outcome.reason
      })

      const summaryText = `成功 ${runStats.success}，失败 ${runStats.failed}，结果未知 ${runStats.unknown}，暂停 ${runStats.paused}`
      if (outcome.reason === 'completed') {
        toast.success(`领取执行完成：${summaryText}`)
      } else if (outcome.reason === 'stopped') {
        toast.warning(`已停止：${summaryText}`)
      }
    } finally {
      if (mountedRef.current) {
        setRunning(false)
        setStopping(false)
        stopRequestedRef.current = false
      }
    }
  }

  const handleStop = () => {
    stopRequestedRef.current = true
    setStopping(true)
  }

  const removeQueueItem = (giftId) => {
    if (running) return
    setQueue((previous) => previous.filter((item) => item.gift_id !== giftId))
  }

  return (
    <div className="h-full space-y-4 overflow-auto p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">礼物领取</h1>
        <p className="mt-1 text-sm text-gray-500">查询账号与领取账号相互独立；临时凭证离开页面后立即丢弃。</p>
      </div>

      <CredentialPanel
        title="1. 查询凭证"
        accounts={accounts}
        mode={queryMode}
        onModeChange={setQueryMode}
        accountId={queryAccountId}
        onAccountIdChange={setQueryAccountId}
        tokenLink={queryTokenLink}
        onTokenLinkChange={setQueryTokenLink}
        platform={queryPlatform}
        onPlatformChange={setQueryPlatform}
        disabled={ordersLoading}
      />

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-gray-900">2. 全部订单</h2>
            <p className="text-xs text-gray-500">固定 statusFilter=0；首次只请求第 1 页，翻页时才请求下一页，结果不写入订单库。</p>
          </div>
          <button
            type="button"
            onClick={() => handleGetOrders(1, orderPageSize)}
            disabled={ordersLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {ordersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            获取全部订单
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={orderKeyword}
              onChange={(event) => {
                setOrderKeyword(event.target.value)
                setOrderPage(1)
              }}
              placeholder="查询当前页的订单号、名称、状态或分类"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <span className="text-xs text-gray-500">
            {orderTotal !== null ? `全部共 ${orderTotal} 条，` : ''}
            当前页 {orders.length} 条，查询结果 {filteredOrders.length} 条
          </span>
          <select
            value={orderPageSize}
            onChange={(event) => {
              const nextPageSize = Number(event.target.value)
              setOrderPageSize(nextPageSize)
              if (ordersLoaded) handleGetOrders(1, nextPageSize)
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 outline-none"
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>每页 {size} 条</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">下单时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredOrders.map((order) => (
                <tr key={order.orderid || order.stringOrderId}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{order.orderid || order.stringOrderId}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-gray-700">{order.title || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{order.showstatus || '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatOrderTime(order.ordertime)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => loadOrderGifts(order)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 px-3 py-1.5 text-xs text-orange-600 hover:bg-orange-50"
                    >
                      <Gift className="h-3.5 w-3.5" />
                      获取礼物列表
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredOrders.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                    {orders.length
                      ? '没有符合查询条件的订单'
                      : ordersLoaded
                        ? '当前页没有订单'
                        : '暂无订单，请先选择查询凭证并点击“获取全部订单”'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-gray-500">
            第 {orderPage} 页
            {orderTotal !== null ? ` / ${Math.max(Math.ceil(orderTotal / orderPageSize), 1)} 页` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={ordersLoading || orderPage <= 1}
              onClick={() => handleGetOrders(1, orderPageSize)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              首页
            </button>
            <button
              type="button"
              disabled={ordersLoading || orderPage <= 1}
              onClick={() => handleGetOrders(orderPage - 1, orderPageSize)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={ordersLoading || !orderHasMore}
              onClick={() => handleGetOrders(orderPage + 1, orderPageSize)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <CredentialPanel
        title="3. 领取凭证"
        accounts={accounts}
        mode={recipientMode}
        onModeChange={setRecipientMode}
        accountId={recipientAccountId}
        onAccountIdChange={setRecipientAccountId}
        tokenLink={recipientTokenLink}
        onTokenLinkChange={setRecipientTokenLink}
        platform={recipientPlatform}
        onPlatformChange={setRecipientPlatform}
        disabled={running}
      />

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-medium text-gray-900">
              <ListChecks className="h-4 w-4 text-orange-500" />
              4. 领取队列与执行结果
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              成功 {queueSummary.success} · 失败 {queueSummary.failed} · 未知 {queueSummary.unknown} · 暂停 {queueSummary.paused} · 等待 {queueSummary.waiting}
              {queueSummary.processing ? ` · 处理中 ${queueSummary.processing}` : ''}
              {queueSummary.skipped ? ` · 待重新执行 ${queueSummary.skipped}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                {stopping ? '正在停止...' : '停止'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartClaim}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
              >
                <Play className="h-4 w-4" />
                {queueSummary.paused
                  ? '更换账号后继续'
                  : queueSummary.skipped
                    ? '重新执行'
                    : '开始领取'}
              </button>
            )}
          </div>
        </div>

        {running && (
          <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            正在执行第 {progress.current} / {progress.total} 项
            {queue.find((item) => item.status === 'processing')?.gift_id
              ? `：${queue.find((item) => item.status === 'processing').gift_id}`
              : ''}
            。每项真实结果会显示在下方，停止只影响尚未发出的请求。
          </div>
        )}

        {!running && lastBatchSummary && (
          <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${
            lastBatchSummary.failed || lastBatchSummary.unknown || lastBatchSummary.paused
              ? 'bg-amber-50 text-amber-800'
              : 'bg-green-50 text-green-800'
          }`}>
            <div className="font-medium">
              本批次已结束：共 {lastBatchSummary.total} 项
            </div>
            <div className="mt-1">
              成功 {lastBatchSummary.success}，失败 {lastBatchSummary.failed}，
              结果未知 {lastBatchSummary.unknown}，暂停 {lastBatchSummary.paused}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {queue.map((item) => {
            const view = statusView(item.status)
            const StatusIcon = view.Icon
            return (
              <div key={item.gift_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-800">{item.gift_id}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${view.classes}`}>
                      <StatusIcon className={`h-3 w-3 ${item.status === 'processing' ? 'animate-spin' : ''}`} />
                      {view.label}
                    </span>
                    {item.attempts > 1 && <span className="text-xs text-gray-400">请求 {item.attempts} 次</span>}
                    {item.result_code !== undefined && item.result_code !== null && (
                      <span className="text-xs text-gray-400">结果码 {item.result_code}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{item.message || '等待领取'}</p>
                  {item.persistence_warning && <p className="mt-1 text-xs text-amber-600">{item.persistence_warning}</p>}
                  <p className="mt-1 text-[11px] text-gray-400">来源订单：{item.source_order_id || '-'}</p>
                </div>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => removeQueueItem(item.gift_id)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                  aria-label="移除礼物"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })}
          {!queue.length && (
            <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
              从订单中获取礼物并选择加入领取队列
            </div>
          )}
        </div>
      </section>

      {giftDialog.open && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-[760px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-gray-900">礼物列表</h3>
                <p className="mt-1 font-mono text-xs text-gray-500">
                  订单 {giftDialog.order?.orderid || giftDialog.order?.stringOrderId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGiftDialog({ open: false, order: null, loading: false, gifts: [] })}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <button
                type="button"
                onClick={selectAllClaimable}
                disabled={giftDialog.loading}
                className="text-sm text-orange-600 hover:text-orange-700"
              >
                全选待领取礼物
              </button>
              <button
                type="button"
                onClick={() => loadOrderGifts(giftDialog.order, true)}
                disabled={giftDialog.loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${giftDialog.loading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-auto p-5">
              {giftDialog.loading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在查询礼物...
                </div>
              )}
              {!giftDialog.loading && giftDialog.gifts.map((item) => (
                <label
                  key={item.gift_id}
                  className={`flex gap-3 rounded-lg border p-3 ${
                    item.claimable ? 'cursor-pointer border-gray-200 hover:border-orange-200' : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-65'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!item.claimable}
                    checked={selectedGiftIds.has(item.gift_id)}
                    onChange={() => toggleGiftSelection(item.gift_id)}
                    className="mt-1 h-4 w-4 accent-orange-500"
                  />
                  {item.card_url ? (
                    <img
                      src={item.card_url}
                      alt="礼物卡"
                      className="h-12 w-12 shrink-0 rounded-lg border border-gray-100 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
                      <Gift className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-800">{item.gift_id}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${item.claimable ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {item.status_text || (item.claimable ? '待领取' : `状态 ${item.gift_status}`)}
                      </span>
                    </div>
                    {item.share_title && <p className="mt-1 text-sm text-gray-700">{item.share_title}</p>}
                    {item.wish && <p className="mt-1 text-xs text-gray-500">祝福语：{item.wish}</p>}
                    <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-gray-400">
                      <span>券码：{item.coupon_code || '-'}</span>
                      <span>发放时间：{formatOrderTime(item.deliver_time)}</span>
                    </div>
                  </div>
                </label>
              ))}
              {!giftDialog.loading && !giftDialog.gifts.length && (
                <div className="py-12 text-center text-sm text-gray-400">该订单未解析到 giftExtra.giftId</div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
              <span className="text-xs text-gray-500">已选择 {selectedGiftIds.size} 个</span>
              <button
                type="button"
                onClick={addSelectedToQueue}
                disabled={!selectedGiftIds.size || giftDialog.loading}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                <Gift className="h-4 w-4" />
                加入领取队列
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GiftClaimPage
