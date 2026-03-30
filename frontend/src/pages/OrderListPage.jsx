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
    setOrders, updateOrdersPage
  } = useDataStore()
  const toast = useToastStore()

  // 本地状态
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [querying, setQuerying] = useState(false)
  const [maxPages, setMaxPages] = useState(200)
  const [timeRange, setTimeRange] = useState(30) // 默认近一个月

  // 筛选条件（本地状态，用于输入）
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [statusFilter, setStatusFilter] = useState('2') // 默认待使用
  const [pageSize, setPageSize] = useState(ordersPageSize)

  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, message: '' })
  const [queryProgress, setQueryProgress] = useState({ current: 0, total: 0, message: '' })

  const queryRunIdRef = useRef(0)
  const syncRunIdRef = useRef(0)

  const loadAccounts = async () => {
    // 如果已加载，直接返回
    if (accountsLoaded) return

    try {
      const data = await fetchAccounts(accountsApi)
      // 设置默认账号为第一个
      if (data && data.length > 0 && !selectedAccountId) {
        setSelectedAccountId(String(data[0].id))
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

  // 账号加载完成后设置默认值
  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(String(accounts[0].id))
    }
  }, [accounts])

  // 监听账号或状态筛选变化，自动重新加载订单
  useEffect(() => {
    if (selectedAccountId) {
      loadOrders(1, pageSize, true)
    }
  }, [selectedAccountId, statusFilter])

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

    const myRunId = ++syncRunIdRef.current
    setSyncing(true)
    setSyncProgress({ current: 0, total: 0, message: '正在获取已有订单ID...' })

    try {
      // 1. 先从后端获取该账号已有的订单ID集合（轻量请求）
      const existingIdsResponse = await ordersApi.getIds({ account_id: selectedAccountId })
      if (myRunId !== syncRunIdRef.current) return

      const existingIds = new Set(existingIdsResponse.data?.ids || [])
      setSyncProgress({ current: 0, total: maxPages, message: `已有 ${existingIds.size} 条订单，正在获取远程数据...` })

      // 2. 从美团API获取订单列表
      const result = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days: timeRange,
        statusFilter: parseInt(statusFilter) || 0,
        maxPages: parseInt(maxPages) || 200
      })

      if (myRunId !== syncRunIdRef.current) return

      if (!result.success) {
        toast.error(`获取订单失败: ${result.error || '未知错误'}`)
        setSyncing(false)
        setSyncProgress({ current: 0, total: 0, message: '' })
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

      setSyncProgress({
        current: maxPages,
        total: maxPages,
        message: `获取 ${formattedOrders.length} 条，已存在 ${duplicateCount} 条，新增 ${newOrders.length} 条${newOrders.length > 0 ? '，正在保存...' : ''}`
      })

      // 5. 只保存新增订单
      if (newOrders.length === 0) {
        toast.info('没有新订单需要保存')
        setSyncing(false)
        setTimeout(() => setSyncProgress({ current: 0, total: 0, message: '' }), 2000)
        return
      }

      const saveResponse = await ordersApi.saveBatch({
        account_id: parseInt(selectedAccountId),
        orders: newOrders
      })

      if (myRunId !== syncRunIdRef.current) return

      if (saveResponse.data?.success) {
        setSyncProgress({
          current: maxPages,
          total: maxPages,
          message: `同步完成！新增 ${saveResponse.data?.new_count || newOrders.length} 条`
        })
        await loadOrders(1, pageSize, true)
        setTimeout(() => setSyncProgress({ current: 0, total: 0, message: '' }), 3000)
      } else {
        toast.error('保存失败: ' + (saveResponse.data?.message || '未知错误'))
        setSyncProgress({ current: 0, total: 0, message: '' })
      }

    } catch (error) {
      console.error('Sync orders error:', error)
      toast.error('同步失败: ' + error.message)
      setSyncProgress({ current: 0, total: 0, message: '' })
    } finally {
      setSyncing(false)
    }
  }

  const handleStopSync = () => {
    syncRunIdRef.current++
    setSyncing(false)
    setSyncProgress({ current: 0, total: 0, message: '' })
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

    if (!account.csecuuid || !account.open_id || !account.open_id_cipher) {
      toast.warning('该账号缺少 csecuuid/openId/openIdCipher，请先在账号管理中重新抓取并保存')
      return
    }

    const myRunId = ++queryRunIdRef.current
    setQuerying(true)
    setQueryProgress({ current: 0, total: 0, message: '正在获取待查询订单...' })

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

      if (myRunId !== queryRunIdRef.current) return

      const ordersToQuery = response.data?.items || []
      const totalCount = response.data?.total || 0

      if (ordersToQuery.length === 0) {
        toast.info('所有订单都已查询过券码')
        setQuerying(false)
        setQueryProgress({ current: 0, total: 0, message: '' })
        return
      }

      setQueryProgress({
        current: 0,
        total: ordersToQuery.length,
        message: `待查询 ${ordersToQuery.length} 条订单（已跳过已查询成功的订单）`
      })

      // 并发控制：每次最多2个并发请求
      const CONCURRENCY = 3
      const REQUEST_DELAY = 500  // 批次间延迟

      // 2. 分批并行处理
      for (let i = 0; i < ordersToQuery.length && myRunId === queryRunIdRef.current; i += CONCURRENCY) {
        const batch = ordersToQuery.slice(i, i + CONCURRENCY)

        setQueryProgress({
          current: i,
          total: ordersToQuery.length,
          message: `正在查询 ${i + 1}-${Math.min(i + CONCURRENCY, ordersToQuery.length)}/${ordersToQuery.length}...`
        })

        // 并行执行批次内的请求
        const batchPromises = batch.map(order =>
          window.electronAPI.rebateQueryOne({
            account: {
              userid: account.userid,
              token: account.token,
              csecuuid: account.csecuuid,
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
        if (i + CONCURRENCY < ordersToQuery.length && myRunId === queryRunIdRef.current) {
          const wait = REQUEST_DELAY + Math.floor(Math.random() * 300)
          await new Promise(resolve => setTimeout(resolve, wait))
        }
      }

      if (myRunId !== queryRunIdRef.current) return

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

      setQueryProgress({
        current: ordersToQuery.length,
        total: ordersToQuery.length,
        message: `查询完成！成功 ${successCount} 条，失败 ${failCount} 条`
      })

      await loadOrders(ordersPage, ordersPageSize, true)
      setTimeout(() => setQueryProgress({ current: 0, total: 0, message: '' }), 5000)

    } catch (error) {
      console.error('Query coupons error:', error)
      toast.error('查询失败: ' + error.message)
    } finally {
      setQuerying(false)
    }
  }

  const handleStopQuery = () => {
    queryRunIdRef.current++
    setQuerying(false)
    setQueryProgress({ current: 0, total: 0, message: '' })
  }

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
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-800">订单列表</h1>
      </div>

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
            disabled={loading || syncing || querying}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 disabled:opacity-50"
          >
            <Database className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? '拉取中...' : '数据库拉取'}
          </button>

          <button
            onClick={syncing ? handleStopSync : handleSyncOrders}
            disabled={loading || querying}
            className={`px-4 py-2 ${syncing ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'} text-white rounded-lg flex items-center gap-2 disabled:opacity-50`}
          >
            <Download className={`w-4 h-4 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? '停止同步' : '同步订单'}
          </button>

          <button
            onClick={querying ? handleStopQuery : handleQueryCoupons}
            disabled={loading || syncing}
            className={`px-4 py-2 ${querying ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'} text-white rounded-lg flex items-center gap-2 disabled:opacity-50`}
          >
            <Search className={`w-4 h-4 ${querying ? 'animate-pulse' : ''}`} />
            {querying ? '停止扫描' : '券码扫描'}
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
        {syncing && syncProgress.message && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{syncProgress.message}</span>
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
        {querying && queryProgress.message && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{queryProgress.message}</span>
              <span>{queryProgress.current} / {queryProgress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-orange-500 h-2 rounded-full transition-all"
                style={{ width: `${queryProgress.total > 0 ? (queryProgress.current / queryProgress.total) * 100 : 0}%` }}
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
                <tr key={order.id} className="hover:bg-gray-50">
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
    </div>
  )
}

export default OrderListPage
