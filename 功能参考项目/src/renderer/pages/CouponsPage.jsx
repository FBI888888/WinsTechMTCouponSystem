import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Ticket, Search, RefreshCw, Copy, Download, CheckCircle, XCircle } from 'lucide-react'

function CouponsPage({ accounts, onAccountsChange }) {
  const [selectedAccount, setSelectedAccount] = useState('')

  // 自动选中第一个账号
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0].userid)
    }
  }, [accounts])
  const [days, setDays] = useState(7)
  const [statusFilter, setStatusFilter] = useState(2)
  const [keyword, setKeyword] = useState('')
  const [longitude, setLongitude] = useState('')
  const [latitude, setLatitude] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [coupons, setCoupons] = useState([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, coupon: null })
  const [flashRowIndex, setFlashRowIndex] = useState(-1)
  const [toast, setToast] = useState({ show: false, type: '', message: '' })
  const [queryTimeStart, setQueryTimeStart] = useState('')
  const [queryTimeEnd, setQueryTimeEnd] = useState('')

  const localCacheRef = useRef({})
  const LOCAL_CACHE_KEY = 'electronMtQrcodeTools_coupon_cache_v1'

  const statusOptions = [
    { value: 0, label: '全部订单' },
    { value: 2, label: '待使用' },
    { value: 3, label: '已完成' },
    { value: 4, label: '退款/售后' }
  ]

  const showMessage = (type, text) => {
    setToast({ show: true, type, message: text })
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000)
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_CACHE_KEY)
      localCacheRef.current = raw ? JSON.parse(raw) : {}
    } catch {
      localCacheRef.current = {}
    }
  }, [])

  const persistLocalCache = () => {
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(localCacheRef.current || {}))
    } catch { }
  }

  const getCachedOrder = (userid, orderid) => {
    const uid = String(userid || '')
    const oid = String(orderid || '')
    return localCacheRef.current?.[uid]?.[oid] || null
  }

  const upsertCachedOrder = ({ userid, orderid, title, queryTime, couponList }) => {
    const uid = String(userid || '')
    const oid = String(orderid || '')

    const validCoupons = (couponList || []).filter(c => {
      const code = String(c?.coupon || '')
      return code && code !== '000000000000'
    })

    if (validCoupons.length === 0) return

    if (!localCacheRef.current[uid]) localCacheRef.current[uid] = {}
    localCacheRef.current[uid][oid] = {
      title: title || '',
      queryTime: queryTime || new Date().toISOString(),
      coupons: validCoupons.map(c => ({
        coupon: c.coupon,
        order_status: c.order_status,
        status: c.status
      }))
    }
    persistLocalCache()
  }

  const formatQueryTime = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const getSelectedAccountData = () => {
    return accounts.find(a => a.userid === selectedAccount)
  }

  const isAllPlaceholderCoupons = (result) => {
    if (!result?.success) return false
    if (!Array.isArray(result.data) || result.data.length === 0) return false
    return result.data.every(c => String(c?.coupon || '') === '000000000000')
  }

  // 缓存从后端获取的店铺位置，用于后续订单复用（减少请求次数）
  const cachedShopLocationRef = useRef(null)

  const apiGetCouponsWithRetry = async ({ token, orderid }) => {
    // 优先使用缓存的店铺位置，其次使用用户手动输入的经纬度
    const cachedLocation = cachedShopLocationRef.current
    const baseLongitude = cachedLocation?.lng || longitude.trim() || undefined
    const baseLatitude = cachedLocation?.lat || latitude.trim() || undefined

    const request = async (reqLongitude, reqLatitude) => {
      return await window.electronAPI.apiGetCoupons({
        token,
        orderid,
        longitude: reqLongitude,
        latitude: reqLatitude
      })
    }

    let result = await request(baseLongitude, baseLatitude)

    // 如果后端返回了有效的 shopLocation，缓存起来供后续订单复用
    if (result?.shopLocation?.lat && result?.shopLocation?.lng) {
      console.log('[券码查询] 缓存店铺位置:', result.shopLocation)
      cachedShopLocationRef.current = result.shopLocation
    }

    if (!isAllPlaceholderCoupons(result)) return result

    // 如果仍为占位券码，尝试使用微调坐标再次请求
    const lngNum = baseLongitude ? parseFloat(baseLongitude) : NaN
    const latNum = baseLatitude ? parseFloat(baseLatitude) : NaN
    if (!Number.isFinite(lngNum) || !Number.isFinite(latNum)) return result

    const tweakedLongitude = (lngNum + 0.00001).toFixed(6)
    const tweakedLatitude = (latNum + 0.00001).toFixed(6)

    await new Promise(r => setTimeout(r, 200))
    const tweakedResult = await request(tweakedLongitude, tweakedLatitude)

    // 更新缓存
    if (tweakedResult?.shopLocation?.lat && tweakedResult?.shopLocation?.lng) {
      cachedShopLocationRef.current = tweakedResult.shopLocation
    }

    return tweakedResult?.success ? tweakedResult : result
  }

  // 重置店铺位置缓存（用于新的查询批次）
  const resetShopLocationCache = () => {
    cachedShopLocationRef.current = null
  }

  const visibleRows = useMemo(() => {
    const startTs = queryTimeStart ? new Date(queryTimeStart).getTime() : NaN
    let endTs = queryTimeEnd ? new Date(queryTimeEnd).getTime() : NaN
    if (Number.isFinite(endTs)) endTs += 999

    return (coupons || [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const t = Date.parse(row?.queryTime || '')
        if (!Number.isFinite(t)) return false
        if (Number.isFinite(startTs) && t < startTs) return false
        if (Number.isFinite(endTs) && t > endTs) return false
        return true
      })
  }, [coupons, queryTimeStart, queryTimeEnd])

  // 查询券码
  const handleQuery = async () => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }
    if (!keyword.trim()) {
      showMessage('error', '请填写券码名称')
      return
    }

    setLoading(true)
    setCoupons([])
    setSelectedRows(new Set())
    setProgress('正在获取订单列表...')
    resetShopLocationCache()  // 重置店铺位置缓存，用于新的查询批次

    try {
      // 获取订单
      const ordersResult = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days,
        statusFilter
      })

      if (!ordersResult.success) {
        showMessage('error', ordersResult.error || '获取订单失败')
        setLoading(false)
        return
      }

      // 过滤匹配关键词的订单
      const matchedOrders = (ordersResult.data || []).filter(o =>
        o.title?.toLowerCase().includes(keyword.toLowerCase())
      )

      if (matchedOrders.length === 0) {
        showMessage('error', '未找到匹配的订单')
        setLoading(false)
        return
      }

      const allCoupons = []
      let windControlDetected = false

      // 查询每个订单的券码
      for (let i = 0; i < matchedOrders.length; i++) {
        const order = matchedOrders[i]
        setProgress(`进度：${i + 1} / ${matchedOrders.length}    当前订单：${order.orderid}`)

        try {
          const cached = getCachedOrder(account.userid, order.orderid)
          if (cached && Array.isArray(cached.coupons) && cached.coupons.length > 0) {
            cached.coupons.forEach(c => {
              allCoupons.push({
                orderid: order.orderid,
                title: cached.title || order.title,
                coupon: c.coupon,
                order_status: c.order_status,
                status: c.status,
                queryTime: cached.queryTime
              })
            })
            continue
          }

          const queryTime = new Date().toISOString()
          const couponResult = await apiGetCouponsWithRetry({ token: account.token, orderid: order.orderid })

          if (couponResult.success && couponResult.data?.length > 0) {
            couponResult.data.forEach(c => {
              allCoupons.push({
                orderid: order.orderid,
                title: order.title,
                coupon: c.coupon,
                order_status: c.order_status,
                status: c.status,
                queryTime
              })
            })
            upsertCachedOrder({
              userid: account.userid,
              orderid: order.orderid,
              title: order.title,
              queryTime,
              couponList: couponResult.data
            })
          } else if (couponResult.error === 'WIND_CONTROL') {
            // 检测到风控
            windControlDetected = true
            const queryTime = new Date().toISOString()
            allCoupons.push({
              orderid: order.orderid,
              title: order.title,
              coupon: '[风控-需手动补全]',
              order_status: '风控',
              status: '遇到风控，请手动补全券码',
              queryTime
            })
          } else {
            // 没有券码的订单也显示
            const queryTime = new Date().toISOString()
            allCoupons.push({
              orderid: order.orderid,
              title: order.title,
              coupon: '',
              order_status: '',
              status: '',
              queryTime
            })
          }
        } catch (e) {
          console.error('获取券码失败:', e)
          // 检测到风控异常
          if (e.message?.includes('WIND_CONTROL')) {
            windControlDetected = true
            const queryTime = new Date().toISOString()
            allCoupons.push({
              orderid: order.orderid,
              title: order.title,
              coupon: '[风控-需手动补全]',
              order_status: '风控',
              status: '遇到风控，请手动补全券码',
              queryTime
            })
          }
        }
        // 延迟500ms避免请求过快
        await new Promise(r => setTimeout(r, 500))
      }

      setCoupons(allCoupons)

      if (windControlDetected) {
        setProgress(`完成：共 ${allCoupons.length} 条记录 (部分遇到风控)`)
        showMessage('error', '遇到风控，请检查账号或替换小程序Token后，等待3分钟后重试或补全券码')
      } else {
        setProgress(`完成：共 ${allCoupons.length} 条记录`)
      }
      // showMessage('success', '查询完成')
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setLoading(false)
    }
  }

  // 本地搜索
  const handleLocalSearch = () => {
    if (!searchKeyword.trim()) {
      showMessage('error', '请输入搜索关键词')
      return
    }
    const kw = searchKeyword.toLowerCase()
    const found = visibleRows.find(({ row }) =>
      row.orderid?.toString().includes(kw) ||
      row.title?.toLowerCase().includes(kw) ||
      row.coupon?.includes(kw) ||
      row.status?.toLowerCase().includes(kw)
    )
    if (found) {
      document.getElementById(`coupon-row-${found.index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 闪烁提醒
      setFlashRowIndex(found.index)
      setTimeout(() => setFlashRowIndex(-1), 1500)
    } else {
      showMessage('error', '未找到匹配结果')
    }
  }

  // 单独查询某订单的券码信息
  const handleQuerySingleOrder = async (orderid, title) => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    try {
      const queryTime = new Date().toISOString()
      const couponResult = await apiGetCouponsWithRetry({ token: account.token, orderid: orderid })

      if (couponResult.success && couponResult.data?.length > 0) {
        upsertCachedOrder({
          userid: account.userid,
          orderid,
          title,
          queryTime,
          couponList: couponResult.data
        })
        // 更新表格中对应订单的券码信息
        setCoupons(prev => {
          const newCoupons = [...prev]
          // 找到该订单的行并更新
          const index = newCoupons.findIndex(c => c.orderid === orderid)
          if (index !== -1) {
            // 删除原来的行，插入新的券码数据
            newCoupons.splice(index, 1)
            couponResult.data.forEach((c, i) => {
              newCoupons.splice(index + i, 0, {
                orderid: orderid,
                title: title,
                coupon: c.coupon,
                order_status: c.order_status,
                status: c.status,
                queryTime
              })
            })
          } else {
            // 如果没找到，添加到末尾
            couponResult.data.forEach(c => {
              newCoupons.push({
                orderid: orderid,
                title: title,
                coupon: c.coupon,
                order_status: c.order_status,
                status: c.status,
                queryTime
              })
            })
          }
          return newCoupons
        })
      } else {
        showMessage('error', '未查询到券码信息')
      }
    } catch (error) {
      showMessage('error', '查询失败: ' + error.message)
    }
  }

  // 补全空券码
  const handleFillEmptyCoupons = async () => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    // 找出券码为空的订单（去重）
    const emptyOrders = []
    const seenOrderIds = new Set()
    coupons.forEach(c => {
      if (!c.coupon && !seenOrderIds.has(c.orderid)) {
        seenOrderIds.add(c.orderid)
        emptyOrders.push({ orderid: c.orderid, title: c.title })
      }
    })

    if (emptyOrders.length === 0) {
      showMessage('success', '没有需要补全的券码')
      return
    }

    setLoading(true)
    setProgress(`正在补全券码：0 / ${emptyOrders.length}`)

    let successCount = 0
    for (let i = 0; i < emptyOrders.length; i++) {
      const order = emptyOrders[i]
      setProgress(`正在补全券码：${i + 1} / ${emptyOrders.length}    当前订单：${order.orderid}`)

      try {
        const queryTime = new Date().toISOString()
        const couponResult = await apiGetCouponsWithRetry({ token: account.token, orderid: order.orderid })

        if (couponResult.success && couponResult.data?.length > 0) {
          upsertCachedOrder({
            userid: account.userid,
            orderid: order.orderid,
            title: order.title,
            queryTime,
            couponList: couponResult.data
          })
          successCount++
          setCoupons(prev => {
            const newCoupons = [...prev]
            const index = newCoupons.findIndex(c => c.orderid === order.orderid && !c.coupon)
            if (index !== -1) {
              newCoupons.splice(index, 1)
              couponResult.data.forEach((c, j) => {
                newCoupons.splice(index + j, 0, {
                  orderid: order.orderid,
                  title: order.title,
                  coupon: c.coupon,
                  order_status: c.order_status,
                  status: c.status,
                  queryTime
                })
              })
            }
            return newCoupons
          })
        }
      } catch (e) {
        console.error('补全券码失败:', e)
      }
      // 延迟500ms避免请求过快
      await new Promise(r => setTimeout(r, 500))
    }

    setLoading(false)
    setProgress(`补全完成：成功 ${successCount} / ${emptyOrders.length}`)
    showMessage('success', `补全完成：成功 ${successCount} 个`)
  }

  const handleFixInvalidCoupons = async () => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    const fixOrders = []
    const seenOrderIds = new Set()
    coupons.forEach(c => {
      if (c.coupon === '000000000000' && !seenOrderIds.has(c.orderid)) {
        seenOrderIds.add(c.orderid)
        fixOrders.push({ orderid: c.orderid, title: c.title })
      }
    })

    if (fixOrders.length === 0) {
      showMessage('success', '没有需要修正的券码')
      return
    }

    setLoading(true)
    setProgress(`正在修正券码：0 / ${fixOrders.length}`)

    let successCount = 0
    for (let i = 0; i < fixOrders.length; i++) {
      const order = fixOrders[i]
      setProgress(`正在修正券码：${i + 1} / ${fixOrders.length}    当前订单：${order.orderid}`)

      try {
        const queryTime = new Date().toISOString()
        const couponResult = await apiGetCouponsWithRetry({ token: account.token, orderid: order.orderid })

        if (couponResult.success && couponResult.data?.length > 0) {
          upsertCachedOrder({
            userid: account.userid,
            orderid: order.orderid,
            title: order.title,
            queryTime,
            couponList: couponResult.data
          })
          successCount++
          setCoupons(prev => {
            const newCoupons = [...prev]
            const firstIndex = newCoupons.findIndex(c => c.orderid === order.orderid && c.coupon === '000000000000')
            if (firstIndex === -1) return newCoupons

            for (let idx = newCoupons.length - 1; idx >= 0; idx--) {
              if (newCoupons[idx].orderid === order.orderid && newCoupons[idx].coupon === '000000000000') {
                newCoupons.splice(idx, 1)
              }
            }

            couponResult.data.forEach((c, j) => {
              newCoupons.splice(firstIndex + j, 0, {
                orderid: order.orderid,
                title: order.title,
                coupon: c.coupon,
                order_status: c.order_status,
                status: c.status,
                queryTime
              })
            })

            return newCoupons
          })
        }
      } catch (e) {
        console.error('修正券码失败:', e)
      }

      await new Promise(r => setTimeout(r, 500))
    }

    setLoading(false)
    setProgress(`修正完成：成功 ${successCount} / ${fixOrders.length}`)
    showMessage('success', `修正完成：成功 ${successCount} 个`)
  }

  // 收集数据
  const collectCoupons = (onlySelected = false) => {
    const items = onlySelected
      ? coupons.filter((_, i) => selectedRows.has(i))
      : coupons
    return items.filter(c => c.coupon)
  }

  // 复制全部券码
  const handleCopyAllCoupons = () => {
    const items = collectCoupons(false)
    const text = items.map(c => c.coupon).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制 ${items.length} 个券码`)
  }

  // 复制全部订单号+券码
  const handleCopyAllOrderCoupons = () => {
    const items = collectCoupons(false)
    const text = items.map(c => `${c.orderid}---${c.coupon}`).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制 ${items.length} 条 订单号+券码`)
  }

  // 复制选中券码
  const handleCopySelectedCoupons = () => {
    const items = collectCoupons(true)
    const text = items.map(c => c.coupon).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制选中 ${items.length} 个券码`)
  }

  // 复制选中订单号+券码
  const handleCopySelectedOrderCoupons = () => {
    const items = collectCoupons(true)
    const text = items.map(c => `${c.orderid}---${c.coupon}`).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制选中 ${items.length} 条 订单号+券码`)
  }

  // 导出Excel
  const handleExport = async () => {
    if (coupons.length === 0) {
      showMessage('error', '暂无数据可导出')
      return
    }

    const account = getSelectedAccountData()
    const filename = `${account?.remark || '券码'}+${statusOptions.find(o => o.value === statusFilter)?.label}+${days}天+${new Date().toISOString().replace(/[:.]/g, '')}.xlsx`

    const headers = ['orderid', 'title', 'coupon', 'order_status', 'status', 'queryTime']
    const data = coupons.map(c => [c.orderid, c.title, c.coupon, c.order_status, c.status, formatQueryTime(c.queryTime)])

    const result = await window.electronAPI.exportExcel({ data, filename, headers })
    if (result.success) {
      showMessage('success', '导出成功')
    } else if (!result.cancelled) {
      showMessage('error', result.error || '导出失败')
    }
  }

  // 切换选中
  const toggleRowSelection = (index) => {
    const newSelected = new Set(selectedRows)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedRows(newSelected)
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* 标题 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <Ticket className="w-5 h-5 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">券码查询</h1>
      </div>

      {/* 右上角弹窗提醒 */}
      {toast.show && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-in ${toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      {/* 查询条件 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-center">
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {accounts.length === 0 ? (
              <option value="">暂无账号</option>
            ) : (
              accounts.map(a => (
                <option key={a.userid} value={a.userid}>{a.remark}</option>
              ))
            )}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(Number(e.target.value))}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {statusOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">天数：</span>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              min={1}
              max={120}
              className="w-20 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="券码名称（必填）"
            className="flex-1 min-w-[150px] px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />

          <input
            type="text"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="纬度（选填）"
            className="w-28 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />

          <input
            type="text"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="经度（选填）"
            className="w-28 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />

          <button
            onClick={handleQuery}
            disabled={loading}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            查询券码
          </button>

          <button
            onClick={handleFillEmptyCoupons}
            disabled={loading || coupons.length === 0}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            补全券码
          </button>

          <button
            onClick={handleFixInvalidCoupons}
            disabled={loading || coupons.length === 0}
            className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            修正券码
          </button>
        </div>
      </div>

      {/* 操作按钮区 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLocalSearch()}
            placeholder="搜索"
            className="w-40 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 whitespace-nowrap">开始时间</span>
            <input
              type="datetime-local"
              step="1"
              value={queryTimeStart}
              onChange={(e) => setQueryTimeStart(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 whitespace-nowrap">结束时间</span>
            <input
              type="datetime-local"
              step="1"
              value={queryTimeEnd}
              onChange={(e) => setQueryTimeEnd(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button onClick={handleLocalSearch} className="px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">
            <Search className="w-4 h-4" />
          </button>
          <button onClick={handleCopyAllCoupons} className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">
            复制全部券码
          </button>
          <button onClick={handleCopyAllOrderCoupons} className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">
            复制全部订单号券码
          </button>
          <button onClick={handleCopySelectedCoupons} className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm">
            复制选中券码
          </button>
          <button onClick={handleCopySelectedOrderCoupons} className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm">
            复制选中订单号券码
          </button>
          <button onClick={handleExport} className="px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 text-sm flex items-center gap-1">
            <Download className="w-4 h-4" /> 导出数据
          </button>
        </div>
      </div>

      {/* 表格区域 */}
      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      const visibleIndices = visibleRows.map(v => v.index)
                      if (e.target.checked) {
                        setSelectedRows(prev => {
                          const next = new Set(prev)
                          visibleIndices.forEach(i => next.add(i))
                          return next
                        })
                      } else {
                        setSelectedRows(prev => {
                          const next = new Set(prev)
                          visibleIndices.forEach(i => next.delete(i))
                          return next
                        })
                      }
                    }}
                    checked={visibleRows.length > 0 && visibleRows.every(v => selectedRows.has(v.index))}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标题</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">查询时间</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visibleRows.map(({ row: coupon, index }) => (
                <tr
                  key={index}
                  id={`coupon-row-${index}`}
                  className={`hover:bg-gray-50 cursor-pointer ${flashRowIndex === index ? 'animate-pulse bg-yellow-200' : ''} ${selectedRows.has(index) ? 'bg-orange-50' : ''} ${!coupon.coupon ? 'bg-red-50' : ''}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ show: true, x: e.clientX, y: e.clientY, coupon })
                  }}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(index)}
                      onChange={() => toggleRowSelection(index)}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{coupon.orderid}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[200px]" title={coupon.title}>{coupon.title}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{coupon.coupon || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{coupon.order_status || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{coupon.status || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatQueryTime(coupon.queryTime) || '-'}</td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                    暂无券码数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRows.size > 0 && (
        <div className="mt-2 text-sm text-gray-600 text-center">已选择 {selectedRows.size} 行</div>
      )}

      {/* 进度条 */}
      {progress && (
        <div className="mt-2 text-sm text-gray-500 text-center">{progress}</div>
      )}

      {/* 右键菜单 */}
      {contextMenu.show && (
        <div
          className="fixed z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div
            className="fixed inset-0"
            onClick={() => setContextMenu({ ...contextMenu, show: false })}
          />
          <div className="relative bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[150px]">
            <button
              onClick={() => {
                const c = contextMenu.coupon
                if (c) {
                  handleQuerySingleOrder(c.orderid, c.title)
                }
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 font-medium text-blue-600"
            >
              查询券码
            </button>
            <div className="border-t border-gray-100 my-1"></div>
            <button
              onClick={() => {
                if (contextMenu.coupon?.coupon) {
                  navigator.clipboard.writeText(contextMenu.coupon.coupon)
                }
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
            >
              复制券码
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(String(contextMenu.coupon?.orderid || ''))
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
            >
              复制订单号
            </button>
            <button
              onClick={() => {
                const c = contextMenu.coupon
                if (c) {
                  navigator.clipboard.writeText(`${c.orderid}---${c.coupon || ''}`)
                }
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
            >
              复制订单号+券码
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.coupon?.title || '')
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
            >
              复制标题
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CouponsPage
