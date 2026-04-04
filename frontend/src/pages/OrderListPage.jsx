import { useState, useEffect, useRef } from 'react'
import { ordersApi, accountsApi } from '../api'
import { Download, Search, Database, ChevronLeft, ChevronRight, Gift } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { confirm } from '../stores/confirmStore'
import { formatCountSummary, getErrorMessage, getResultErrorMessage, isAbortError } from '../utils/requestFeedback'
import { createErrorQueryResult, createSuccessQueryResult, QUERY_RESULT_STATUS } from '../utils/queryResult'

// 时间范围选项
const TIME_RANGE_OPTIONS = [
  { value: 7, label: '近一周' },
  { value: 30, label: '近一个月' },
  { value: 90, label: '近三个月' },
  { value: 180, label: '近半年' },
  { value: 365, label: '近一年' },
  { value: 730, label: '近两年' },
  { value: 1095, label: '近三年' }
]

const ORDER_SYNC_SAVE_BATCH_SIZE = 500

function OrderListPage() {
  // 全局缓存
  const {
    accounts, accountsLoaded, fetchAccounts,
    orders, ordersTotal, ordersPage, ordersPageSize, ordersLoaded, ordersFilters,
    setOrders, updateOrdersPage,
    // 筛选条件（持久化）
    orderSelectedAccountId, orderStatusFilter, setOrderSelectedAccountId, setOrderStatusFilter,
    // 同步和查询状态（持久化）
    orderSyncing, orderSyncProgress, setOrderSyncing, setOrderSyncProgress,
    orderSyncRunId, incrementSyncRunId,
    orderQuerying, orderQueryProgress, setOrderQuerying, setOrderQueryProgress,
    orderQueryRunId, incrementQueryRunId
  } = useDataStore()
  const toast = useToastStore()

  // 本地状态
  const [loading, setLoading] = useState(false)
  const [maxPages, setMaxPages] = useState(200)
  const [timeRange, setTimeRange] = useState(30) // 默认近一个月

  // 筛选条件（从全局状态读取）
  const selectedAccountId = orderSelectedAccountId
  const setSelectedAccountId = setOrderSelectedAccountId
  const statusFilter = orderStatusFilter
  const setStatusFilter = setOrderStatusFilter
  const [pageSize, setPageSize] = useState(ordersPageSize)
  const [orderSearchKeyword, setOrderSearchKeyword] = useState('')
  const [titleSearchKeyword, setTitleSearchKeyword] = useState('')
  const [orderSearchMode, setOrderSearchMode] = useState('exact')
  const [debouncedOrderSearchKeyword, setDebouncedOrderSearchKeyword] = useState('')
  const [debouncedTitleSearchKeyword, setDebouncedTitleSearchKeyword] = useState('')

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, order: null })
  // 查询券码弹窗状态
  const [couponQueryDialogOpen, setCouponQueryDialogOpen] = useState(false)
  const [queryingOrder, setQueryingOrder] = useState(null)
  const [couponQueryResult, setCouponQueryResult] = useState(null)
  const [couponQueryMeta, setCouponQueryMeta] = useState(null)
  const [couponQueryLoading, setCouponQueryLoading] = useState(false)
  const [giftReturnStatusMap, setGiftReturnStatusMap] = useState({})
  const orderPageCursorRef = useRef({})
  const couponQueryCacheRef = useRef({})
  const couponQueryInFlightRef = useRef({})
  const orderListRequestIdRef = useRef(0)
  const orderListAbortControllerRef = useRef(null)

  const resetOrderPaginationState = () => {
    orderPageCursorRef.current = {}
  }

  const isExactOrderSearchMode =
    orderSearchMode === 'exact' &&
    debouncedOrderSearchKeyword.trim().length > 0 &&
    debouncedTitleSearchKeyword.trim().length === 0
  const singleExactOrder = isExactOrderSearchMode && orders.length === 1 ? orders[0] : null

  const clearExactOrderSearch = () => {
    setOrderSearchKeyword('')
    setOrderSearchMode('exact')
  }

  const getCouponQueryCacheKey = (order) => {
    if (!order) return ''
    return `${selectedAccountId}:${order.id}:${order.order_view_id || order.order_id || ''}`
  }

  const getGiftOrderId = (order) => {
    if (!order) return ''
    const rawId = order.order_view_id || order.order_id || ''
    return String(rawId).trim()
  }

  const getGiftReturnStatusKey = (order) => {
    if (!order) return ''
    return `${selectedAccountId}:${order.id}:${getGiftOrderId(order)}`
  }

  const isGiftOrder = (order) => {
    const orderIdStr = getGiftOrderId(order)
    if (!orderIdStr) return false
    return Boolean(order?.is_gift) || /^[a-zA-Z]/.test(orderIdStr) || orderIdStr.length > 20
  }

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

    if (!message) return '退还失败'
    if (message.includes('参数') || message.includes('缺失')) return `退还失败: ${message}`
    if (message.includes('token') || message.includes('Token')) return `退还失败: ${message}`
    return message
  }

  const updateGiftReturnStatus = (order, status, message = '') => {
    const key = getGiftReturnStatusKey(order)
    if (!key) return
    setGiftReturnStatusMap(prev => ({
      ...prev,
      [key]: {
        status,
        message,
        updatedAt: Date.now()
      }
    }))
  }

  const getGiftReturnStatus = (order) => {
    const key = getGiftReturnStatusKey(order)
    const localStatus = key ? giftReturnStatusMap[key] : null
    if (localStatus) return localStatus

    switch (order?.gift_return_status) {
      case 1:
        return {
          status: 'success',
          message: order?.gift_return_message || '礼物已退还',
          updatedAt: order?.gift_return_updated_at ? new Date(order.gift_return_updated_at).getTime() : 0
        }
      case 2:
        return {
          status: 'risk',
          message: order?.gift_return_message || '触发风控，请完成验证后重试',
          updatedAt: order?.gift_return_updated_at ? new Date(order.gift_return_updated_at).getTime() : 0
        }
      case 3:
        return {
          status: 'error',
          message: order?.gift_return_message || '礼物退还失败',
          updatedAt: order?.gift_return_updated_at ? new Date(order.gift_return_updated_at).getTime() : 0
        }
      case 4:
        return {
          status: 'pending',
          message: order?.gift_return_message || '正在退还礼物...',
          updatedAt: order?.gift_return_updated_at ? new Date(order.gift_return_updated_at).getTime() : 0
        }
      default:
        return null
    }
  }

  const getGiftReturnStatusView = (order) => {
    if (!isGiftOrder(order)) {
      return { text: '-', className: 'text-gray-300', title: '' }
    }

    const statusEntry = getGiftReturnStatus(order)
    switch (statusEntry?.status) {
      case 'pending':
        return { text: '处理中', className: 'bg-blue-50 text-blue-700 animate-pulse', title: statusEntry.message || '正在退还礼物' }
      case 'success':
        return { text: '已退还', className: 'bg-green-50 text-green-700', title: statusEntry.message || '礼物已退还' }
      case 'risk':
        return { text: '风控', className: 'bg-amber-50 text-amber-700', title: statusEntry.message || '触发风控，请完成验证后重试' }
      case 'error':
        return { text: '失败', className: 'bg-red-50 text-red-700', title: statusEntry.message || '礼物退还失败' }
      default:
        return { text: '可退还', className: 'bg-gray-100 text-gray-600', title: '礼物订单，可通过右键菜单退还' }
    }
  }

  const persistGiftReturnStatus = async (order, status, message = '') => {
    const statusCodeMap = {
      success: 1,
      risk: 2,
      error: 3,
      pending: 4
    }
    const statusCode = statusCodeMap[status] || 0
    if (!order?.id || !statusCode) return

    await ordersApi.updateGiftReturnStatus({
      order_ids: [order.id],
      status: statusCode,
      message
    })
  }

  const persistGiftReturnStatusSafely = async (order, status, message = '') => {
    try {
      await persistGiftReturnStatus(order, status, message)
    } catch (error) {
      console.error(`Persist gift return ${status} status error:`, error)
    }
  }

  const invalidateCouponQueryCache = ({ closeDialog = false } = {}) => {
    couponQueryCacheRef.current = {}
    couponQueryInFlightRef.current = {}
    if (closeDialog) {
      setCouponQueryDialogOpen(false)
      setQueryingOrder(null)
      setCouponQueryResult(null)
      setCouponQueryMeta(null)
      setCouponQueryLoading(false)
    }
  }

  const buildOrderQueryParams = (pSize) => {
    const params = { limit: pSize }
    if (selectedAccountId) params.account_id = selectedAccountId
    if (statusFilter && statusFilter !== '0') params.status_filter = parseInt(statusFilter)
    if (debouncedOrderSearchKeyword.trim()) {
      params.order_search = debouncedOrderSearchKeyword.trim()
      params.order_search_mode = orderSearchMode
    }
    if (debouncedTitleSearchKeyword.trim()) params.title_search = debouncedTitleSearchKeyword.trim()
    return params
  }

  const storeOrderPageCursor = (page, response) => {
    orderPageCursorRef.current[page] = {
      nextCursorOrderPayTime: response.data?.next_cursor_order_pay_time || null,
      nextCursorId: response.data?.next_cursor_id || null,
      prevCursorOrderPayTime: response.data?.prev_cursor_order_pay_time || null,
      prevCursorId: response.data?.prev_cursor_id || null,
      hasMore: Boolean(response.data?.has_more)
    }
  }

  const loadAccounts = async () => {
    // 如果已加载，直接返回
    if (accountsLoaded) return

    try {
      const data = await fetchAccounts(accountsApi)
      // 只有在没有选择任何账号时，才设置默认账号为第一个
      if (data && data.length > 0 && !orderSelectedAccountId) {
        setOrderSelectedAccountId(String(data[0].id))
      }
    } catch (error) {
      console.error('Failed to load accounts:', error)
    }
  }

  const loadOrders = async (page = ordersPage, pSize = pageSize, forceRefresh = false, navigation = 'jump') => {
    // 如果已加载且不强制刷新，直接返回
    if (ordersLoaded && !forceRefresh) return

    const requestId = ++orderListRequestIdRef.current
    orderListAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    orderListAbortControllerRef.current = abortController
    setLoading(true)
    try {
      const currentPage = ordersPage
      const currentCursorInfo = orderPageCursorRef.current[currentPage]
      const pageGap = Math.abs(page - currentPage)

      const fetchOrderPage = async (targetPage, direction = null, cursorInfo = null) => {
        const params = buildOrderQueryParams(pSize)
        let useCursor = false

        if (isExactOrderSearchMode) {
          params.include_total = false
        }

        if (direction === 'next' && cursorInfo?.nextCursorOrderPayTime && cursorInfo?.nextCursorId) {
          params.cursor_order_pay_time = cursorInfo.nextCursorOrderPayTime
          params.cursor_id = cursorInfo.nextCursorId
          params.cursor_direction = 'next'
          useCursor = true
        } else if (direction === 'prev' && cursorInfo?.prevCursorOrderPayTime && cursorInfo?.prevCursorId) {
          params.cursor_order_pay_time = cursorInfo.prevCursorOrderPayTime
          params.cursor_id = cursorInfo.prevCursorId
          params.cursor_direction = 'prev'
          useCursor = true
        }

        if (!useCursor && !isExactOrderSearchMode) {
          params.skip = (targetPage - 1) * pSize
        } else if (useCursor) {
          params.include_total = false
          if (typeof ordersTotal === 'number' && ordersTotal >= 0) {
            params.known_total = ordersTotal
          }
        }

        const response = await ordersApi.getAll(params, { signal: abortController.signal })
        storeOrderPageCursor(targetPage, response)
        return { response, useCursor }
      }

      let response

      if (isExactOrderSearchMode) {
        resetOrderPaginationState()
        response = (await fetchOrderPage(1)).response
      } else if (page === 1) {
        resetOrderPaginationState()
        response = (await fetchOrderPage(1)).response
      } else if (
        currentCursorInfo &&
        page !== currentPage &&
        pageGap <= 5 &&
        navigation !== 'reset'
      ) {
        let workingPage = currentPage
        let workingCursorInfo = currentCursorInfo
        let walkedToTarget = true

        while (workingPage !== page) {
          const direction = page > workingPage ? 'next' : 'prev'
          const targetPage = direction === 'next' ? workingPage + 1 : workingPage - 1
          const stepResult = await fetchOrderPage(targetPage, direction, workingCursorInfo)
          response = stepResult.response

          if (!stepResult.useCursor) {
            walkedToTarget = false
            break
          }

          workingPage = targetPage
          workingCursorInfo = orderPageCursorRef.current[workingPage]
        }

        if (!walkedToTarget || workingPage !== page) {
          response = (await fetchOrderPage(page)).response
        }
      } else {
        response = (await fetchOrderPage(page, navigation, currentCursorInfo)).response
      }

      if (requestId !== orderListRequestIdRef.current) return

      setOrders(
        response.data.items || [],
        response.data.total || 0,
        isExactOrderSearchMode ? 1 : page,
        pSize,
        {
          account_id: selectedAccountId,
          status_filter: statusFilter,
          order_search: debouncedOrderSearchKeyword,
          title_search: debouncedTitleSearchKeyword,
          order_search_mode: orderSearchMode
        }
      )
    } catch (error) {
      if (isAbortError(error)) return
      if (requestId !== orderListRequestIdRef.current) return
      console.error('Failed to load orders:', error)
    } finally {
      if (orderListAbortControllerRef.current === abortController) {
        orderListAbortControllerRef.current = null
      }
      if (requestId === orderListRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  useEffect(() => {
    return () => {
      orderListAbortControllerRef.current?.abort()
      orderListRequestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedOrderSearchKeyword(orderSearchKeyword)
    }, 300)

    return () => clearTimeout(timer)
  }, [orderSearchKeyword])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTitleSearchKeyword(titleSearchKeyword)
    }, 300)

    return () => clearTimeout(timer)
  }, [titleSearchKeyword])

  // 账号加载完成后设置默认值（仅当没有选择任何账号时）
  useEffect(() => {
    if (accounts && accounts.length > 0 && !orderSelectedAccountId) {
      setOrderSelectedAccountId(String(accounts[0].id))
    }
  }, [accounts])

  // 监听账号或状态筛选变化，自动重新加载订单
  useEffect(() => {
    if (orderSelectedAccountId) {
      invalidateCouponQueryCache({ closeDialog: true })
      setGiftReturnStatusMap({})
      resetOrderPaginationState()
      loadOrders(1, pageSize, true, 'reset')
    }
  }, [orderSelectedAccountId, orderStatusFilter, debouncedOrderSearchKeyword, debouncedTitleSearchKeyword, orderSearchMode])

  // 分页控制
  const totalPages = Math.ceil(ordersTotal / ordersPageSize)

  const handlePageChange = (newPage) => {
    if (isExactOrderSearchMode) return
    if (newPage < 1 || newPage > totalPages) return
    const navigation =
      newPage === ordersPage + 1 ? 'next' :
      newPage === ordersPage - 1 ? 'prev' :
      'jump'
    updateOrdersPage(newPage)
    loadOrders(newPage, ordersPageSize, true, navigation)
  }

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize)
    updateOrdersPage(1)
    resetOrderPaginationState()
    loadOrders(1, newSize, true, 'reset')
  }

  // 从接口获取最新订单列表（优化版：前端预去重）
  const handleSyncOrders = async () => {
    if (!selectedAccountId) {
      toast.warning('Please select an account first')
      return
    }

    const account = accounts.find(a => a.id === parseInt(selectedAccountId))
    if (!account) {
      toast.error('Account not found')
      return
    }

    incrementSyncRunId()
    const myRunId = orderSyncRunId + 1
    setOrderSyncing(true)
    setOrderSyncProgress({ current: 0, total: 0, message: 'Fetching remote orders...' })

    try {
      const result = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days: timeRange,
        statusFilter: parseInt(statusFilter) || 0,
        maxPages: parseInt(maxPages) || 200
      })

      if (myRunId !== useDataStore.getState().orderSyncRunId) return

      if (!result.success) {
        toast.error(`同步失败: ${getResultErrorMessage(result, '未知错误')}`)
        setOrderSyncProgress({ current: 0, total: 0, message: '' })
        return
      }

      const ordersData = result.data || []

      const parseOrderInfo = (orderInfo, ordertime) => {
        let amount = 0
        let payTime = null

        if (Array.isArray(orderInfo)) {
          for (const info of orderInfo) {
            // 优先匹配带 ￥/¥ 符号的金额（如 "￥39.90" 或 "¥39.90"）
            const currencyMatch = info.match(/[￥¥]([0-9]+(?:\.[0-9]+)?)/)
            if (currencyMatch) {
              amount = parseFloat(currencyMatch[1]) || 0
            }
            // 其次匹配小数格式的数字（更可能是金额，如 "39.90"）
            if (!amount) {
              const decimalMatch = info.match(/([0-9]+\.[0-9]+)/)
              if (decimalMatch) {
                amount = parseFloat(decimalMatch[1]) || 0
              }
            }
            // 时间匹配
            const timeMatch = info.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/)
            if (timeMatch) {
              payTime = timeMatch[1]
            }
          }
        }

        if (!payTime && ordertime) {
          const date = new Date(ordertime * 1000)
          const year = date.getFullYear()
          const month = String(date.getMonth() + 1).padStart(2, '0')
          const day = String(date.getDate()).padStart(2, '0')
          const hour = String(date.getHours()).padStart(2, '0')
          const minute = String(date.getMinutes()).padStart(2, '0')
          payTime = `${year}-${month}-${day} ${hour}:${minute}`
        }

        return { amount, payTime }
      }

      const formattedOrders = ordersData.map(order => {
        const { amount, payTime } = parseOrderInfo(order.orderinfo, order.ordertime)
        return {
          orderId: String(order.orderid || ''),
          orderViewId: String(order.stringOrderId || order.orderid || ''),
          orderAmount: amount,
          commissionFee: 0,
          totalCouponNum: 1,
          orderStatus: order.tousestatus || 0,
          orderPayTime: payTime,
          cityName: '',
          consumeCityName: '',
          title: order.title || '',
          showstatus: order.showstatus || '',
          catename: order.catename || '',
          isGift: false,
          tousestatus: order.tousestatus || 0
        }
      })

      if (formattedOrders.length === 0) {
        toast.info('No orders available to sync')
        setOrderSyncProgress({ current: 0, total: 0, message: '' })
        return
      }

      // ── 前端本地预去重 ──────────────────────────────────────────
      // 从 DB 取所有已有 order_id 及状态，在本地比对，
      // 只把"新增"和"状态变化"的订单发给后端，大幅减少传输量和后端压力
      setOrderSyncProgress({
        current: 0,
        total: formattedOrders.length,
        message: `已抓取 ${formattedOrders.length} 条，正在获取本地已有订单ID...`
      })

      let existingMap = {}
      try {
        const existingRes = await ordersApi.getExistingIds(parseInt(selectedAccountId))
        existingMap = existingRes.data || {}
      } catch (e) {
        // 获取失败时降级为全量发送（不影响正确性，只影响性能）
        console.warn('获取已有订单ID失败，降级为全量同步:', e)
      }

      const ordersToSend = []
      let clientSkipCount = 0

      for (const order of formattedOrders) {
        if (existingMap[order.orderId]) {
          // 已存在，直接跳过，不更新
          clientSkipCount++
        } else {
          // 新订单，需要入库
          ordersToSend.push(order)
        }
      }

      if (myRunId !== useDataStore.getState().orderSyncRunId) return

      if (ordersToSend.length === 0) {
        setOrderSyncProgress({
          current: formattedOrders.length,
          total: formattedOrders.length,
          message: `同步完成: 全部 ${formattedOrders.length} 条均已是最新，无需更新`
        })
        toast.success(`订单同步完成: 全部 ${clientSkipCount} 条均已是最新`)
        await loadOrders(1, pageSize, true, 'reset')
        setTimeout(() => setOrderSyncProgress({ current: 0, total: 0, message: '' }), 3000)
        return
      }
      // ────────────────────────────────────────────────────────────

      setOrderSyncProgress({
        current: 0,
        total: ordersToSend.length,
        message: `本地去重后剩余 ${ordersToSend.length} 条（跳过 ${clientSkipCount} 条），开始落库...`
      })

      let aggregatedNewCount = 0
      let aggregatedUpdateCount = 0
      let aggregatedSkipCount = clientSkipCount

      for (let start = 0; start < ordersToSend.length; start += ORDER_SYNC_SAVE_BATCH_SIZE) {
        if (myRunId !== useDataStore.getState().orderSyncRunId) return

        const batchOrders = ordersToSend.slice(start, start + ORDER_SYNC_SAVE_BATCH_SIZE)
        const batchNumber = Math.floor(start / ORDER_SYNC_SAVE_BATCH_SIZE) + 1
        const totalBatches = Math.ceil(ordersToSend.length / ORDER_SYNC_SAVE_BATCH_SIZE)

        setOrderSyncProgress({
          current: start,
          total: ordersToSend.length,
          message: `正在保存批次 ${batchNumber}/${totalBatches}（${start + 1}-${start + batchOrders.length} / ${ordersToSend.length}）...`
        })

        const saveResponse = await ordersApi.saveBatch({
          account_id: parseInt(selectedAccountId),
          orders: batchOrders
        })

        if (myRunId !== useDataStore.getState().orderSyncRunId) return

        if (!saveResponse.data?.success) {
          toast.error('保存失败: ' + getErrorMessage({ response: { data: saveResponse.data } }, '未知错误'))
          setOrderSyncProgress({ current: 0, total: 0, message: '' })
          return
        }

        aggregatedNewCount += saveResponse.data?.new_count || 0
        aggregatedUpdateCount += saveResponse.data?.update_count || 0
        aggregatedSkipCount += saveResponse.data?.skip_count || 0
      }

      if (myRunId !== useDataStore.getState().orderSyncRunId) return

      {
        const newCount = aggregatedNewCount
        const updateCount = aggregatedUpdateCount
        const skipCount = aggregatedSkipCount
        const summary = formatCountSummary([
          { label: '新增', count: newCount },
          { label: '更新', count: updateCount },
          { label: '跳过', count: skipCount }
        ])

        invalidateCouponQueryCache({ closeDialog: true })
        setOrderSyncProgress({
          current: ordersToSend.length,
          total: ordersToSend.length,
          message: `同步完成: ${summary}`
        })
        toast.success(`订单同步完成: ${summary}`)
        await loadOrders(1, pageSize, true, 'reset')
        setTimeout(() => setOrderSyncProgress({ current: 0, total: 0, message: '' }), 3000)
      }
    } catch (error) {
      console.error('Sync orders error:', error)
      toast.error('同步失败: ' + getErrorMessage(error, '未知错误'))
      setOrderSyncProgress({ current: 0, total: 0, message: '' })
    } finally {
      setOrderSyncing(false)
    }
  }

  const handleStopSync = async () => {
    incrementSyncRunId()
    // 调用 Electron API 取消同步
    try {
      await window.electronAPI.cancelOrdersSync()
      toast.info('正在停止同步...')
    } catch (error) {
      console.error('Cancel sync error:', error)
    }
    setOrderSyncing(false)
    setOrderSyncProgress({ current: 0, total: 0, message: '' })
  }

  // 券码查询并落库（优化版：使用后端API一次性获取待查询订单）
  const handleQueryCoupons = async () => {
    if (!selectedAccountId) {
      toast.warning('Please select an account first')
      return
    }

    const account = accounts.find(a => a.id === parseInt(selectedAccountId))
    if (!account) {
      toast.error('Account not found')
      return
    }

    if (!account.open_id || !account.open_id_cipher) {
      toast.warning('This account is missing openId/openIdCipher. Please recapture and save it first.')
      return
    }

    incrementQueryRunId()
    const myRunId = orderQueryRunId + 1
    setOrderQuerying(true)
    setOrderQueryProgress({ current: 0, total: 0, message: 'Fetching pending orders...' })

    let successCount = 0
    let failCount = 0
    const successOrderIds = []
    const failOrderIds = []

    try {
      const MAX_SCAN_COUNT = 1000
      const response = await ordersApi.getPendingCouponQuery({
        account_id: selectedAccountId,
        status_filter: statusFilter && statusFilter !== '0' ? parseInt(statusFilter) : undefined,
        limit: MAX_SCAN_COUNT
      })

      if (myRunId !== useDataStore.getState().orderQueryRunId) return

      const ordersToQuery = response.data?.items || []
      const returnedCount = response.data?.returned_count || ordersToQuery.length
      const hasMore = Boolean(response.data?.has_more)

      if (ordersToQuery.length === 0) {
        toast.info('All eligible orders have already been queried')
        setOrderQueryProgress({ current: 0, total: 0, message: '' })
        return
      }

      setOrderQueryProgress({
        current: 0,
        total: returnedCount,
        message: hasMore
          ? `Fetched ${returnedCount} pending orders for this batch. More orders remain for later scans.`
          : `Fetched ${returnedCount} pending orders.`
      })

      const queryList = ordersToQuery
      const CONCURRENCY = 3
      const REQUEST_DELAY = 500

      for (let i = 0; i < queryList.length && myRunId === useDataStore.getState().orderQueryRunId; i += CONCURRENCY) {
        const batch = queryList.slice(i, i + CONCURRENCY)

        setOrderQueryProgress({
          current: i,
          total: returnedCount,
          message: hasMore
            ? `正在查询 ${i + 1}-${Math.min(i + CONCURRENCY, returnedCount)}/${returnedCount}，后续还有更多订单...`
            : `正在查询 ${i + 1}-${Math.min(i + CONCURRENCY, returnedCount)}/${returnedCount}...`
        })

        const batchPromises = batch.map(order =>
          window.electronAPI.rebateQueryOne({
            account: {
              userid: account.userid,
              token: account.token,
              csecuuid: account.csecuuid || 'c34d9b03-7520-47e3-9d7c-17a3d930c48d',
              openId: account.open_id,
              openIdCipher: account.open_id_cipher
            },
            orderId: order.order_view_id
          }).then(async result => {
            if (result.success && result.data?.response) {
              const backendResponse = result.data.response
              const coupons = backendResponse.data

              if (Array.isArray(coupons) && coupons.length > 0) {
                for (const couponInfo of coupons) {
                  try {
                    await ordersApi.saveCoupon({
                      account_id: parseInt(selectedAccountId),
                      order_id: order.id,
                      order_view_id: order.order_view_id,
                      coupon_data: couponInfo,
                      raw_data: backendResponse
                    })
                  } catch (saveError) {
                    console.error('Save coupon error:', saveError)
                  }
                }
                return { success: true, orderId: order.id }
              }
            }
            return { success: false, orderId: order.id }
          }).catch(error => {
            console.error('Query coupon error:', error)
            return { success: false, orderId: order.id }
          })
        )

        const batchResults = await Promise.all(batchPromises)

        for (const result of batchResults) {
          if (result.success) {
            successCount++
            successOrderIds.push(result.orderId)
          } else {
            failCount++
            failOrderIds.push(result.orderId)
          }
        }

        if (i + CONCURRENCY < queryList.length && myRunId === useDataStore.getState().orderQueryRunId) {
          const wait = REQUEST_DELAY + Math.floor(Math.random() * 300)
          await new Promise(resolve => setTimeout(resolve, wait))
        }
      }

      if (myRunId !== useDataStore.getState().orderQueryRunId) return

      if (successOrderIds.length > 0) {
        try {
          await ordersApi.updateQueryStatus({ order_ids: successOrderIds, status: 1 })
        } catch (e) {
          console.error('Update success status error:', e)
        }
      }
      if (failOrderIds.length > 0) {
        try {
          await ordersApi.updateQueryStatus({ order_ids: failOrderIds, status: 2 })
        } catch (e) {
          console.error('Update fail status error:', e)
        }
      }

      setOrderQueryProgress({
        current: returnedCount,
        total: returnedCount,
        message: hasMore
          ? `本批完成: ${formatCountSummary([{ label: '成功', count: successCount }, { label: '失败', count: failCount }])}。仍有剩余订单待下次处理。`
          : `查询完成: ${formatCountSummary([{ label: '成功', count: successCount }, { label: '失败', count: failCount }])}`
      })
      toast.success(
        hasMore
          ? `本批查券完成: ${formatCountSummary([{ label: '成功', count: successCount }, { label: '失败', count: failCount }])}，仍有剩余订单`
          : `查券完成: ${formatCountSummary([{ label: '成功', count: successCount }, { label: '失败', count: failCount }])}`
      )

      invalidateCouponQueryCache({ closeDialog: true })
      await loadOrders(ordersPage, ordersPageSize, true)
      setTimeout(() => setOrderQueryProgress({ current: 0, total: 0, message: '' }), 5000)

    } catch (error) {
      console.error('Query coupons error:', error)
      toast.error('查券失败: ' + getErrorMessage(error, '未知错误'))
    } finally {
      setOrderQuerying(false)
    }
  }

  const handleStopQuery = () => {
    incrementQueryRunId()
    setOrderQuerying(false)
    setOrderQueryProgress({ current: 0, total: 0, message: '' })
  }

  // 右键菜单处理
  const handleContextMenu = (e, order) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, order })
  }

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, order: null })
  }

  const queryCouponForOrder = async (order, options = {}) => {
    const { forceRefresh = false } = options

    // 检查账号信息
    const account = accounts.find(a => a.id === parseInt(selectedAccountId))
    if (!account) {
      toast.error('账号不存在')
      return
    }

    if (!account.open_id || !account.open_id_cipher) {
      toast.warning('该账号缺少必要信息，请先在账号管理中重新抓取')
      return
    }

    setQueryingOrder(order)
    setCouponQueryDialogOpen(true)
    setCouponQueryLoading(true)
    setCouponQueryMeta(null)

    const cacheKey = getCouponQueryCacheKey(order)
    const cachedEntry = couponQueryCacheRef.current[cacheKey]
    if (!forceRefresh && cachedEntry) {
      setCouponQueryResult(cachedEntry.result)
      setCouponQueryMeta({
        source: 'cache',
        fetchedAt: cachedEntry.fetchedAt
      })
      setCouponQueryLoading(false)
      return
    }

    try {
      let result

      if (!forceRefresh && couponQueryInFlightRef.current[cacheKey]) {
        result = await couponQueryInFlightRef.current[cacheKey]
      } else {
        const requestPromise = window.electronAPI.rebateQueryOne({
          account: {
            userid: account.userid,
            token: account.token,
            csecuuid: account.csecuuid || 'c34d9b03-7520-47e3-9d7c-17a3d930c48d',
            openId: account.open_id,
            openIdCipher: account.open_id_cipher
          },
          orderId: order.order_view_id
        })
        couponQueryInFlightRef.current[cacheKey] = requestPromise
        result = await requestPromise
      }

      if (result.success && result.data?.response) {
        const coupons = Array.isArray(result.data.response?.data) ? result.data.response.data : []
        const queryResult = createSuccessQueryResult({
          source: 'frontend',
          coupons,
          message: coupons.length > 0 ? `查询成功，获取到 ${coupons.length} 个券码` : '未查询到券码信息',
          meta: {
            queryOrderId: order.order_id,
            orderViewId: order.order_view_id
          }
        })
        setCouponQueryResult(queryResult)
        couponQueryCacheRef.current[cacheKey] = {
          result: queryResult,
          fetchedAt: Date.now()
        }
        setCouponQueryMeta({
          source: 'live',
          fetchedAt: couponQueryCacheRef.current[cacheKey].fetchedAt
        })
      } else {
        const errorMessage = getResultErrorMessage(result, '未知错误')
        setCouponQueryResult(createErrorQueryResult({
          source: 'frontend',
          message: `查询失败: ${errorMessage}`,
          meta: {
            queryOrderId: order.order_id,
            orderViewId: order.order_view_id
          }
        }))
        toast.error('查询失败: ' + errorMessage)
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, '未知错误')
      setCouponQueryResult(createErrorQueryResult({
        source: 'frontend',
        message: `查询失败: ${errorMessage}`,
        meta: {
          queryOrderId: order.order_id,
          orderViewId: order.order_view_id
        }
      }))
      toast.error('查询失败: ' + errorMessage)
    } finally {
      delete couponQueryInFlightRef.current[cacheKey]
      setCouponQueryLoading(false)
    }
  }

  // 查询单个订单的券码
  const handleQuerySingleCoupon = async () => {
    if (!contextMenu.order) return

    const order = contextMenu.order
    closeContextMenu()
    await queryCouponForOrder(order, { source: 'context_menu' })
  }

  const handleReturnGift = async () => {
    if (!contextMenu.order) return

    const order = contextMenu.order
    const giftId = getGiftOrderId(order)
    const currentGiftReturnStatus = getGiftReturnStatus(order)
    closeContextMenu()

    if (!giftId || !isGiftOrder(order)) {
      toast.warning('当前订单不是礼物订单')
      return
    }

    if (currentGiftReturnStatus?.status === 'pending') {
      toast.info('这笔礼物订单正在处理中，请稍候')
      return
    }

    const confirmed = await confirm(
      `确定要退还礼物订单 ${giftId} 吗？此操作会向美团提交退还请求。`,
      '退还礼物确认'
    )
    if (!confirmed) {
      return
    }

    if (!selectedAccountId) {
      toast.warning('请先选择账号')
      return
    }

    const account = accounts.find(a => a.id === parseInt(selectedAccountId))
    if (!account) {
      toast.error('账号不存在')
      return
    }

    if (!account.token) {
      toast.error('当前账号缺少 Token，请先重新抓取并保存')
      return
    }

    if (!account.userid) {
      toast.error('当前账号缺少 UserId，请先重新抓取并保存')
      return
    }

    try {
      updateGiftReturnStatus(order, 'pending', '正在退还礼物...')
      const result = await window.electronAPI.apiReturnGift({
        token: account.token,
        giftId,
        options: {
          userId: account.userid,
          uuid: account.csecuuid || '',
          openId: account.open_id || ''
        }
      })

      if (result.success && result.data?.code === 0) {
        const successMessage = result.data?.message || '礼物退还成功'
        updateGiftReturnStatus(order, 'success', successMessage)
        await persistGiftReturnStatusSafely(order, 'success', successMessage)
        toast.success('礼物退还成功')
        await loadOrders(ordersPage, ordersPageSize, true)
      } else if (isGiftReturnRiskControl(result?.data, result?.error)) {
        const riskUrl = getGiftReturnRiskUrl(result?.data)
        const riskMessage = result?.data?.message || result?.data?.msg || result?.error || '退还礼物时触发风控'
        updateGiftReturnStatus(order, 'risk', riskMessage)
        await persistGiftReturnStatusSafely(order, 'risk', riskMessage)
        if (riskUrl) {
          window.open(riskUrl, '_blank')
          toast.warning('触发风控，已打开验证页面，完成验证后请重试')
        } else {
          toast.warning('退还礼物时触发风控，请完成验证或更新 Token 后重试')
        }
      } else {
        const errorMessage = getGiftReturnErrorMessage(result?.data, result?.error)
        updateGiftReturnStatus(order, 'error', errorMessage)
        await persistGiftReturnStatusSafely(order, 'error', errorMessage)
        toast.error(errorMessage)
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, '未知错误')
      if (isGiftReturnRiskControl(null, errorMessage)) {
        updateGiftReturnStatus(order, 'risk', errorMessage)
        await persistGiftReturnStatusSafely(order, 'risk', errorMessage)
        toast.warning('退还礼物时触发风控，请完成验证或更新 Token 后重试')
      } else {
        updateGiftReturnStatus(order, 'error', errorMessage)
        await persistGiftReturnStatusSafely(order, 'error', errorMessage)
        toast.error('退还失败: ' + errorMessage)
      }
    }
  }

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    const handleClick = () => closeContextMenu()
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleExport = async () => {
    const headers = ['订单号', '标题', '分类', '状态', '金额', '下单时间', '券码查询']
    const rows = orders.map(order => [
      order.order_id,
      order.title || '',
      order.catename || '',
      getStatusText(order),
      order.order_amount || '',
      order.order_pay_time || '',
      getQueryStatusText(order.coupon_query_status)
    ])

    try {
      await window.electronAPI.exportExcel({
        data: rows,
        filename: `订单列表_${new Date().toISOString().split('T')[0]}.xlsx`,
        headers
      })
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const getStatusText = (order) => {
    if (order.showstatus) return order.showstatus
    if (order.order_status === 1 || order.tousestatus === 1) return '待消费'
    if (order.order_status === 0) return '其他'
    return '未知'
  }

  const getStatusColor = (order) => {
    const status = order.showstatus || ''
    if (status.includes('待消费') || status.includes('待使用') || order.tousestatus === 1) {
      return 'bg-blue-100 text-blue-800'
    }
    if (status.includes('已完成') || status.includes('待评价')) {
      return 'bg-green-100 text-green-800'
    }
    if (status.includes('退款')) {
      return 'bg-orange-100 text-orange-800'
    }
    return 'bg-gray-100 text-gray-800'
  }

  // 券码查询状态
  const getQueryStatusColor = (status) => {
    switch (status) {
      case 1: return 'bg-green-100 text-green-800'
      case 2: return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-500'
    }
  }

  const getQueryStatusText = (status) => {
    switch (status) {
      case 1: return '成功'
      case 2: return '失败'
      default: return '待查询'
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">选择账号</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">全部账号</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.remark || account.userid}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[150px]">
            <label className="block text-xs text-gray-500 mb-1">订单状态</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="0">全部订单</option>
              <option value="2">待使用</option>
              <option value="3">已完成</option>
              <option value="4">退款/售后</option>
            </select>
          </div>

          <div className="min-w-[150px]">
            <label className="block text-xs text-gray-500 mb-1">时间范围</label>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              {TIME_RANGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">订单号搜索</label>
            <input
              type="text"
              value={orderSearchKeyword}
              onChange={(e) => setOrderSearchKeyword(e.target.value)}
              placeholder="订单号 / 订单视图号"
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">匹配方式</label>
            <select
              value={orderSearchMode}
              onChange={(e) => setOrderSearchMode(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="exact">精确</option>
              <option value="prefix">前缀</option>
            </select>
          </div>

          <div className="min-w-[220px]">
            <label className="block text-xs text-gray-500 mb-1">标题搜索</label>
            <input
              type="text"
              value={titleSearchKeyword}
              onChange={(e) => setTitleSearchKeyword(e.target.value)}
              placeholder="标题关键词"
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <div className="min-w-[100px]">
            <label className="block text-xs text-gray-500 mb-1">最大页数</label>
            <input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(parseInt(e.target.value) || 1)}
              min="1"
              max="1000"
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <button
            onClick={() => loadOrders(1, pageSize, true, 'reset')}
            disabled={loading || orderSyncing || orderQuerying}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 disabled:opacity-50"
          >
            <Database className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? '拉取中...' : '数据库拉取'}
          </button>

          <button
            onClick={orderSyncing ? handleStopSync : handleSyncOrders}
            disabled={loading || orderQuerying}
            className={`px-4 py-2 ${orderSyncing ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'} text-white rounded-lg flex items-center gap-2 disabled:opacity-50`}
          >
            <Download className={`w-4 h-4 ${orderSyncing ? 'animate-pulse' : ''}`} />
            {orderSyncing ? '停止同步' : '同步订单'}
          </button>

          <button
            onClick={orderQuerying ? handleStopQuery : handleQueryCoupons}
            disabled={loading || orderSyncing}
            className={`px-4 py-2 ${orderQuerying ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'} text-white rounded-lg flex items-center gap-2 disabled:opacity-50`}
          >
            <Search className={`w-4 h-4 ${orderQuerying ? 'animate-pulse' : ''}`} />
            {orderQuerying ? '停止扫描' : '券码扫描'}
          </button>

          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> 导出Excel
          </button>

          <span className="text-sm text-gray-500 ml-auto">
            {isExactOrderSearchMode ? `查单结果 ${orders.length} 条` : `共 ${ordersTotal} 条订单`}
          </span>
        </div>

        {/* 同步进度 */}
        {orderSyncing && orderSyncProgress.message && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{orderSyncProgress.message}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all animate-pulse"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {/* 查询进度 */}
        {orderQuerying && orderQueryProgress.message && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{orderQueryProgress.message}</span>
              <span>{orderQueryProgress.current} / {orderQueryProgress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-orange-500 h-2 rounded-full transition-all"
                style={{ width: `${orderQueryProgress.total > 0 ? (orderQueryProgress.current / orderQueryProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
        {singleExactOrder && (
          <div className="border-b border-orange-100 bg-orange-50/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800">
                  已定位订单 {singleExactOrder.order_id}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {singleExactOrder.title || '无标题'} · {getStatusText(singleExactOrder)} · 券码状态 {getQueryStatusText(singleExactOrder.coupon_query_status)}
                </div>
                <div className="flex flex-wrap gap-2 mt-3 text-xs">
                  <span className="px-2 py-1 rounded-full bg-white text-gray-700 border border-orange-100">
                    订单视图号 {singleExactOrder.order_view_id || '-'}
                  </span>
                  <span className="px-2 py-1 rounded-full bg-white text-gray-700 border border-orange-100">
                    金额 {singleExactOrder.order_amount ?? '0'}
                  </span>
                  <span className="px-2 py-1 rounded-full bg-white text-gray-700 border border-orange-100">
                    分类 {singleExactOrder.catename || '-'}
                  </span>
                  <span className="px-2 py-1 rounded-full bg-white text-gray-700 border border-orange-100">
                    下单时间 {singleExactOrder.order_pay_time || '-'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => queryCouponForOrder(singleExactOrder, { source: 'exact_search_card' })}
                  disabled={couponQueryLoading}
                  className="px-3 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
                >
                  <Search className={`w-4 h-4 ${couponQueryLoading ? 'animate-pulse' : ''}`} />
                  {couponQueryLoading ? '查询中...' : '快速查券码'}
                </button>
                <button
                  onClick={clearExactOrderSearch}
                  className="px-3 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  清空查单
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标题</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">分类</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">金额</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">下单时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码查询</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">礼物退还</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map(order => (
                <tr
                  key={order.id}
                  className={`cursor-pointer ${singleExactOrder?.id === order.id ? 'bg-orange-50 ring-1 ring-inset ring-orange-200' : 'hover:bg-gray-50'}`}
                  onContextMenu={(e) => handleContextMenu(e, order)}
                >
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{order.order_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[200px]" title={order.title}>{order.title || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{order.catename || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order)}`}>
                      {getStatusText(order)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">¥{order.order_amount || '0'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{order.order_pay_time || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getQueryStatusColor(order.coupon_query_status)}`}>
                      {getQueryStatusText(order.coupon_query_status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      title={getGiftReturnStatusView(order).title}
                      className={`px-2 py-1 rounded-full text-xs font-medium ${getGiftReturnStatusView(order).className}`}
                    >
                      {getGiftReturnStatusView(order).text}
                    </span>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center text-gray-500">
                    暂无订单数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {ordersTotal > 0 && !isExactOrderSearchMode && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">每页</span>
              <select
                value={ordersPageSize}
                onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
                className="px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
              <span className="text-sm text-gray-500">条</span>
            </div>

            <div className="text-sm text-gray-500">
              显示 {(ordersPage - 1) * ordersPageSize + 1} - {Math.min(ordersPage * ordersPageSize, ordersTotal)} 条，共 {ordersTotal} 条
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(ordersPage - 1)}
                disabled={ordersPage <= 1}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* 页码显示 */}
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (ordersPage <= 3) {
                    pageNum = i + 1
                  } else if (ordersPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = ordersPage - 2 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`px-3 py-1 rounded ${ordersPage === pageNum ? 'bg-orange-500 text-white' : 'border border-gray-300 hover:bg-gray-100'}`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => handlePageChange(ordersPage + 1)}
                disabled={ordersPage >= totalPages}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <div
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleQuerySingleCoupon}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            查询券码
          </button>
          {isGiftOrder(contextMenu.order) && (
            <button
              onClick={handleReturnGift}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Gift className="w-4 h-4" />
              退还礼物
            </button>
          )}
        </div>
      )}

      {/* 查询券码弹窗 */}
      {couponQueryDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[600px] max-w-[90vw] max-h-[80vh] bg-white rounded-xl shadow-lg overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-800">
                  券码查询结果 - 订单 {queryingOrder?.order_id}
                </div>
                {couponQueryMeta && (
                  <div className="text-xs text-gray-500 mt-1">
                    {couponQueryMeta.source === 'cache' ? '已使用本页缓存结果' : '已完成本地查询'}
                  </div>
                )}
                {couponQueryResult && (
                  <div className="text-xs text-gray-500 mt-1">
                    {couponQueryResult.sourceLabel} · {couponQueryResult.status === QUERY_RESULT_STATUS.SUCCESS ? `共 ${couponQueryResult.count} 条` : '失败结果'}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {queryingOrder && (
                  <button
                    onClick={() => queryCouponForOrder(queryingOrder, { forceRefresh: true })}
                    disabled={couponQueryLoading}
                    className="text-sm text-orange-600 hover:text-orange-700 disabled:opacity-50"
                  >
                    重新查询
                  </button>
                )}
                <button
                  onClick={() => setCouponQueryDialogOpen(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="p-5 overflow-auto flex-1">
              {couponQueryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                  <span className="ml-3 text-gray-600">查询中...</span>
                </div>
              ) : couponQueryResult ? (
                <div className="space-y-4">
                  {couponQueryResult.status === QUERY_RESULT_STATUS.SUCCESS && couponQueryResult.count > 0 ? (
                    couponQueryResult.coupons.map((coupon, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500">券码：</span>
                            <span className="font-mono font-medium">{coupon.couponCode || coupon.coupon || '-'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">状态：</span>
                            <span className="font-medium">{coupon.couponStatus || coupon.order_status || coupon.coupon_status || '-'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">核销时间：</span>
                            <span>{coupon.verifyTime || '-'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">核销门店：</span>
                            <span>{coupon.verifyPoiName || '-'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">有效期：</span>
                            <span>{coupon.validStartTime || '-'} 至 {coupon.validEndTime || '-'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">券码类型：</span>
                            <span>{coupon.couponType || '-'}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 py-8">
                      {couponQueryResult.message || '未查询到券码信息'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  无查询结果
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OrderListPage
