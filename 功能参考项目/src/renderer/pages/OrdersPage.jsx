import React, { useState, useEffect } from 'react'
import { History, Search, RefreshCw, Copy, XCircle, CheckCircle } from 'lucide-react'

function OrdersPage({ accounts, onAccountsChange }) {
  const [selectedAccount, setSelectedAccount] = useState('')

  // 自动选中第一个账号
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0].userid)
    }
  }, [accounts])
  const [days, setDays] = useState(30)
  const [statusFilter, setStatusFilter] = useState(0)
  const [orders, setOrders] = useState([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [couponDialog, setCouponDialog] = useState({ open: false, orderid: '', coupons: [] })
  const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, order: null })
  const [flashRowIndex, setFlashRowIndex] = useState(-1)
  const [toast, setToast] = useState({ show: false, type: '', message: '' })
  const [longitude, setLongitude] = useState('')
  const [latitude, setLatitude] = useState('')

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

  const getSelectedAccountData = () => {
    return accounts.find(a => a.userid === selectedAccount)
  }

  // 获取订单列表
  const handleGetOrders = async () => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    setLoading(true)
    setOrders([])

    try {
      const result = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days,
        statusFilter
      })

      if (result.success) {
        setOrders(result.data || [])
        // showMessage('success', `获取到 ${result.data?.length || 0} 个订单`)
      } else {
        showMessage('error', result.error || '获取订单失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setLoading(false)
    }
  }

  // 搜索订单
  const handleSearch = () => {
    if (!searchKeyword.trim()) {
      showMessage('error', '请输入搜索关键词')
      return
    }
    const keyword = searchKeyword.toLowerCase()
    const index = orders.findIndex(o =>
      o.orderid?.toString().includes(keyword) ||
      o.title?.toLowerCase().includes(keyword) ||
      o.orderstatus?.toLowerCase().includes(keyword)
    )
    if (index >= 0) {
      document.getElementById(`order-row-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 闪烁提醒
      setFlashRowIndex(index)
      setTimeout(() => setFlashRowIndex(-1), 1500)
    } else {
      showMessage('error', '未找到匹配结果')
    }
  }

  // 查询券码信息
  const handleQueryCoupons = async (orderid) => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    try {
      const result = await window.electronAPI.apiGetCoupons({
        token: account.token,
        orderid,
        longitude: longitude.trim() || undefined,
        latitude: latitude.trim() || undefined
      })

      if (result.success) {
        setCouponDialog({ open: true, orderid, coupons: result.data || [] })
      } else {
        showMessage('error', result.error || '获取券码失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    }
  }

  // 复制券码信息
  const handleCopyCoupons = () => {
    const text = couponDialog.coupons.map((c, i) =>
      `【券码 ${i + 1}】\n券码：${c.coupon}\n状态：${c.status}\n订单状态：${c.order_status || ''}`
    ).join('\n\n')
    navigator.clipboard.writeText(text)
    showMessage('success', '券码信息已复制')
  }

  // 退还礼物
  const handleReturnGift = async (order) => {
    if (!window.confirm(`确定要退还礼物订单 ${order.orderid} 吗？`)) {
      return
    }

    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    setLoading(true)
    try {
      const result = await window.electronAPI.apiReturnGift({
        token: account.token,
        giftId: order.orderid,
        options: {
          userId: account.userid,
          // 可以根据需要添加更多参数，目前使用默认指纹和位置
        }
      })

      if (result.success && result.data.code === 0) {
        showMessage('success', '礼物退还成功')
        // 刷新列表
        handleGetOrders()
      } else {
        showMessage('error', result.data?.message || result.error || '退还失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setLoading(false)
    }
  }

  const isGiftOrder = (order) => {
    if (!order || !order.orderid) return false
    const orderIdStr = String(order.orderid)
    return /^[a-zA-Z]/.test(orderIdStr) || (orderIdStr.length > 20)
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* 标题 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <History className="w-5 h-5 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">订单查询</h1>
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
            onClick={handleGetOrders}
            disabled={loading}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            获取订单
          </button>
        </div>
      </div>

      {/* 搜索区域 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索 orderid/title/status"
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button onClick={handleSearch} className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center gap-2">
            <Search className="w-4 h-4" /> 搜索
          </button>
        </div>
      </div>

      {/* 表格区域 */}
      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标题</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单状态</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map((order, index) => (
                <tr
                  key={index}
                  id={`order-row-${index}`}
                  className={`hover:bg-gray-50 cursor-pointer ${flashRowIndex === index ? 'animate-pulse bg-yellow-200' : ''}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ show: true, x: e.clientX, y: e.clientY, order })
                  }}
                >
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{order.orderid}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{order.title}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{order.orderstatus}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan="3" className="px-4 py-8 text-center text-gray-500">
                    暂无订单数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 券码信息弹窗 */}
      {couponDialog.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-800">券码信息 - {couponDialog.orderid}</h3>
              <button onClick={() => setCouponDialog({ open: false, orderid: '', coupons: [] })} className="text-gray-400 hover:text-gray-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {couponDialog.coupons.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无券码信息</p>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">共 {couponDialog.coupons.length} 个券码</p>
                  {couponDialog.coupons.map((c, i) => (
                    <div key={i} className="p-3 bg-gray-50 rounded-lg">
                      <p className="font-medium text-gray-800">【券码 {i + 1}】</p>
                      <p className="text-sm text-gray-600">券码：{c.coupon}</p>
                      <p className="text-sm text-gray-600">状态：{c.status}</p>
                      {c.order_status && <p className="text-sm text-gray-600">订单状态：{c.order_status}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={handleCopyCoupons}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" /> 复制全部
              </button>
              <button
                onClick={() => setCouponDialog({ open: false, orderid: '', coupons: [] })}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
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
                handleQueryCoupons(contextMenu.order.orderid)
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              查看券码
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(String(contextMenu.order.orderid))
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              复制订单号
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.order.title || '')
                setContextMenu({ ...contextMenu, show: false })
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              复制标题
            </button>
            {isGiftOrder(contextMenu.order) && (
              <button
                onClick={() => {
                  handleReturnGift(contextMenu.order)
                  setContextMenu({ ...contextMenu, show: false })
                }}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-100"
              >
                退还礼物
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default OrdersPage
