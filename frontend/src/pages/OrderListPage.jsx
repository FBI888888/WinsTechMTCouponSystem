import { useState, useEffect, useRef } from 'react'
import { ordersApi, accountsApi } from '../api'
import { Download, Search, Database, ChevronLeft, ChevronRight } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'

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
  const [searchKeyword, setSearchKeyword] = useState('') // 搜索关键词

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, order: null })
  // 查询券码弹窗状态
  const [couponQueryDialogOpen, setCouponQueryDialogOpen] = useState(false)
  const [queryingOrder, setQueryingOrder] = useState(null)
  const [couponQueryResult, setCouponQueryResult] = useState(null)
  const [couponQueryLoading, setCouponQueryLoading] = useState(false)

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

  const loadOrders = async (page = ordersPage, pSize = pageSize, forceRefresh = false) => {
    // 如果已加载且不强制刷新，直接返回
    if (ordersLoaded && !forceRefresh) return

    setLoading(true)
    try {
      const params = {
        skip: (page - 1) * pSize,
        limit: pSize
      }
      if (selectedAccountId) params.account_id = selectedAccountId
      if (statusFilter && statusFilter !== '0') params.status_filter = parseInt(statusFilter)
      if (searchKeyword.trim()) params.search = searchKeyword.trim()

      const response = await ordersApi.getAll(params)
      setOrders(
        response.data.items || [],
        response.data.total || 0,
        page,
        pSize,
        { account_id: selectedAccountId, status_filter: statusFilter }
      )
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  // 账号加载完成后设置默认值（仅当没有选择任何账号时）
  useEffect(() => {
    if (accounts && accounts.length > 0 && !orderSelectedAccountId) {
      setOrderSelectedAccountId(String(accounts[0].id))
    }
  }, [accounts])

  // 监听账号或状态筛选变化，自动重新加载订单
  useEffect(() => {
    if (orderSelectedAccountId) {
      loadOrders(1, pageSize, true)
    }
  }, [orderSelectedAccountId, orderStatusFilter, searchKeyword])

  // 分页控制
  const totalPages = Math.ceil(ordersTotal / ordersPageSize)

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return
    updateOrdersPage(newPage)
    loadOrders(newPage, ordersPageSize, true)
  }

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize)
    updateOrdersPage(1)
    loadOrders(1, newSize, true)
  }

  // 从接口获取最新订单列表（优化版：前端预去重）
  const handleSyncOrders = async () => {
    if (!selectedAccountId) {
      toast.warning('请先选择账号')
      return
    }

    const account = accounts.find(a => a.id === parseInt(selectedAccountId))
    if (!account) {
      toast.error('账号不存在')
      return
    }

    incrementSyncRunId()
    const myRunId = orderSyncRunId + 1  // 获取新的 runId
    setOrderSyncing(true)
    setOrderSyncProgress({ current: 0, total: 0, message: '正在获取已有订单ID...' })

    try {
      // 1. 先从后端获取该账号已有的订单ID集合（轻量请求）
      const existingIdsResponse = await ordersApi.getIds({ account_id: selectedAccountId })
      if (myRunId !== useDataStore.getState().orderSyncRunId) return

      const existingIds = new Set(existingIdsResponse.data?.ids || [])
      setOrderSyncProgress({ current: 0, total: maxPages, message: `已有 ${existingIds.size} 条订单，正在获取远程数据...` })

      // 2. 从美团API获取订单列表
      const result = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days: timeRange,
        statusFilter: parseInt(statusFilter) || 0,
        maxPages: parseInt(maxPages) || 200
      })

      if (myRunId !== useDataStore.getState().orderSyncRunId) return

      if (!result.success) {
        toast.error(`获取订单失败: ${result.error || '未知错误'}`)
        setOrderSyncing(false)
        setOrderSyncProgress({ current: 0, total: 0, message: '' })
        return
      }

      const ordersData = result.data || []

      // 3. 解析订单信息
      const parseOrderInfo = (orderInfo, ordertime) => {
        let amount = 0
        let payTime = null

        if (Array.isArray(orderInfo)) {
          for (const info of orderInfo) {
            const amountMatch = info.match(/(?:总价|实付|订单金额)[:：]\s*[¥￥]?\s*([\d.]+)/)
            if (amountMatch) {
              amount = parseFloat(amountMatch[1]) || 0
            }
            const timeMatch = info.match(/下单时间[:：]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/)
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

      // 4. 前端去重：过滤掉已存在的订单
      const newOrders = formattedOrders.filter(order => !existingIds.has(order.orderId))
      const duplicateCount = formattedOrders.length - newOrders.length

      setOrderSyncProgress({
        current: maxPages,
        total: maxPages,
        message: `获取 ${formattedOrders.length} 条，已存在 ${duplicateCount} 条，新增 ${newOrders.length} 条${newOrders.length > 0 ? '，正在保存...' : ''}`
      })

      // 5. 只保存新增订单
      if (newOrders.length === 0) {
        toast.info('没有新订单需要保存')
        setOrderSyncing(false)
        setTimeout(() => setOrderSyncProgress({ current: 0, total: 0, message: '' }), 2000)
        return
      }

      const saveResponse = await ordersApi.saveBatch({
        account_id: parseInt(selectedAccountId),
        orders: newOrders
      })

      if (myRunId !== useDataStore.getState().orderSyncRunId) return

      if (saveResponse.data?.success) {
        setOrderSyncProgress({
          current: maxPages,
          total: maxPages,
          message: `同步完成！新增 ${saveResponse.data?.new_count || newOrders.length} 条`
        })
        await loadOrders(1, pageSize, true)
        setTimeout(() => setOrderSyncProgress({ current: 0, total: 0, message: '' }), 3000)
      } else {
        toast.error('保存失败: ' + (saveResponse.data?.message || '未知错误'))
        setOrderSyncProgress({ current: 0, total: 0, message: '' })
      }

    } catch (error) {
      console.error('Sync orders error:', error)
      toast.error('同步失败: ' + error.message)
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
      toast.warning('请先选择账号')
      return
    }

    const account = accounts.find(a => a.id === parseInt(selectedAccountId))
    if (!account) {
      toast.error('账号不存在')
      return
    }

    if (!account.open_id || !account.open_id_cipher) {
      toast.warning('该账号缺少 openId/openIdCipher，请先在账号管理中重新抓取并保存')
      return
    }

    incrementQueryRunId()
    const myRunId = orderQueryRunId + 1  // 获取新的 runId
    setOrderQuerying(true)
    setOrderQueryProgress({ current: 0, total: 0, message: '正在获取待查询订单...' })

    let successCount = 0
    let failCount = 0
    const successOrderIds = []
    const failOrderIds = []

    try {
      // 1. 使用后端API一次性获取所有待查询订单
      const response = await ordersApi.getPendingCouponQuery({
        account_id: selectedAccountId,
        status_filter: statusFilter && statusFilter !== '0' ? parseInt(statusFilter) : undefined
      })

      if (myRunId !== useDataStore.getState().orderQueryRunId) return

      const ordersToQuery = response.data?.items || []
      const totalCount = response.data?.total || 0

      if (ordersToQuery.length === 0) {
        toast.info('所有订单都已查询过券码')
        setOrderQuerying(false)
        setOrderQueryProgress({ current: 0, total: 0, message: '' })
        return
      }

      // 单次最多扫描1000个订单
      const MAX_SCAN_COUNT = 1000
      const actualQueryCount = Math.min(ordersToQuery.length, MAX_SCAN_COUNT)
      const limited = ordersToQuery.length > MAX_SCAN_COUNT

      setOrderQueryProgress({
        current: 0,
        total: actualQueryCount,
        message: limited 
          ? `待查询 ${ordersToQuery.length} 条，本次扫描前 ${MAX_SCAN_COUNT} 条` 
          : `待查询 ${ordersToQuery.length} 条订单`
      })

      // 如果超过限制，只取前1000个
      const queryList = limited ? ordersToQuery.slice(0, MAX_SCAN_COUNT) : ordersToQuery

      // 并发控制：每次最多3个并发请求
      const CONCURRENCY = 3
      const REQUEST_DELAY = 500  // 批次间延迟

      // 2. 分批并行处理
      for (let i = 0; i < queryList.length && myRunId === useDataStore.getState().orderQueryRunId; i += CONCURRENCY) {
        const batch = queryList.slice(i, i + CONCURRENCY)

        setOrderQueryProgress({
          current: i,
          total: actualQueryCount,
          message: limited 
            ? `正在查询 ${i + 1}-${Math.min(i + CONCURRENCY, actualQueryCount)}/${actualQueryCount} (共${ordersToQuery.length}条)...`
            : `正在查询 ${i + 1}-${Math.min(i + CONCURRENCY, actualQueryCount)}/${actualQueryCount}...`
        })

        // 并行执行批次内的请求
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
              const response = result.data.response
              const coupons = response.data

              if (Array.isArray(coupons) && coupons.length > 0) {
                // 保存所有券码
                for (const couponInfo of coupons) {
                  try {
                    await ordersApi.saveCoupon({
                      account_id: parseInt(selectedAccountId),
                      order_id: order.id,
                      order_view_id: order.order_view_id,
                      coupon_data: couponInfo,
                      raw_data: response
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

        // 等待当前批次完成
        const batchResults = await Promise.all(batchPromises)

        // 统计结果
        for (const result of batchResults) {
          if (result.success) {
            successCount++
            successOrderIds.push(result.orderId)
          } else {
            failCount++
            failOrderIds.push(result.orderId)
          }
        }

        // 批次间延迟（避免请求过于频繁）
        if (i + CONCURRENCY < queryList.length && myRunId === useDataStore.getState().orderQueryRunId) {
          const wait = REQUEST_DELAY + Math.floor(Math.random() * 300)
          await new Promise(resolve => setTimeout(resolve, wait))
        }
      }

      if (myRunId !== useDataStore.getState().orderQueryRunId) return

      // 批量更新订单的券码查询状态
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
        current: actualQueryCount,
        total: actualQueryCount,
        message: limited 
          ? `本次扫描完成！成功 ${successCount} 条，失败 ${failCount} 条（共${ordersToQuery.length}条待查询）`
          : `查询完成！成功 ${successCount} 条，失败 ${failCount} 条`
      })

      await loadOrders(ordersPage, ordersPageSize, true)
      setTimeout(() => setOrderQueryProgress({ current: 0, total: 0, message: '' }), 5000)

    } catch (error) {
      console.error('Query coupons error:', error)
      toast.error('查询失败: ' + error.message)
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

  // 查询单个订单的券码
  const handleQuerySingleCoupon = async () => {
    if (!contextMenu.order) return

    const order = contextMenu.order
    closeContextMenu()

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
    setCouponQueryResult(null)

    try {
      const result = await window.electronAPI.rebateQueryOne({
        account: {
          userid: account.userid,
          token: account.token,
          csecuuid: account.csecuuid || 'c34d9b03-7520-47e3-9d7c-17a3d930c48d',
          openId: account.open_id,
          openIdCipher: account.open_id_cipher
        },
        orderId: order.order_view_id
      })

      if (result.success && result.data?.response) {
        setCouponQueryResult(result.data.response)
      } else {
        toast.error('查询失败: ' + (result.error || '未知错误'))
        setCouponQueryDialogOpen(false)
      }
    } catch (error) {
      toast.error('查询失败: ' + error.message)
      setCouponQueryDialogOpen(false)
    } finally {
      setCouponQueryLoading(false)
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
            <label className="block text-xs text-gray-500 mb-1">搜索</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="订单号/标题关键词"
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
            onClick={() => loadOrders(1, pageSize, true)}
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
            共 {ordersTotal} 条订单
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
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map(order => (
                <tr
                  key={order.id}
                  className="hover:bg-gray-50 cursor-pointer"
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
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                    暂无订单数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {ordersTotal > 0 && (
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
        </div>
      )}

      {/* 查询券码弹窗 */}
      {couponQueryDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[600px] max-w-[90vw] max-h-[80vh] bg-white rounded-xl shadow-lg overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-medium text-gray-800">
                券码查询结果 - 订单 {queryingOrder?.order_id}
              </div>
              <button
                onClick={() => setCouponQueryDialogOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="p-5 overflow-auto flex-1">
              {couponQueryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                  <span className="ml-3 text-gray-600">查询中...</span>
                </div>
              ) : couponQueryResult ? (
                <div className="space-y-4">
                  {Array.isArray(couponQueryResult.data) && couponQueryResult.data.length > 0 ? (
                    couponQueryResult.data.map((coupon, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500">券码：</span>
                            <span className="font-mono font-medium">{coupon.couponCode || '-'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">状态：</span>
                            <span className="font-medium">{coupon.couponStatus || '-'}</span>
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
                      未查询到券码信息
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
