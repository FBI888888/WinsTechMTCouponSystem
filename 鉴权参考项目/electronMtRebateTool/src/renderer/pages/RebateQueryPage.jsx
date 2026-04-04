import React, { useMemo, useRef, useState, useEffect } from 'react'
import { BadgeDollarSign, Play, Upload, Download, Trash2 } from 'lucide-react'
import { showToast } from '../components/ToastHost'

function normalizeOrderIds(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

function parseResult(orderId, response) {
  if (!response || typeof response !== 'object') {
    return { orderId, status: 'error', message: '返回数据异常', detail: null }
  }

  if (response.error) {
    return { orderId, status: 'error', message: response.message || '请求失败', detail: null }
  }

  if (response.yodaCode === 406) {
    return { orderId, status: 'risk', message: response.msg || '触发风控', detail: null }
  }

  const data = response.data
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0]
    const base = first && typeof first === 'object' ? first : null
    const extra = base?.detailList?.[0]
    const extraObj = extra && typeof extra === 'object' ? extra : null
    const detail = base ? { ...base, ...(extraObj || {}) } : null
    if (detail && base) {
      detail.orderAmount = base.orderAmount
      detail.commissionFee = base.commissionFee
      detail.totalCouponNum = base.totalCouponNum
      detail.daoDianCouponDataList = base.daoDianCouponDataList
    }
    return { orderId, status: 'success', message: '已走返利', detail }
  }

  if (Array.isArray(data)) {
    return { orderId, status: 'failed', message: '未走返利', detail: null }
  }

  return { orderId, status: 'error', message: '返回数据格式异常', detail: null }
}

function orderStatusToText(orderStatus) {
  if (orderStatus === 3) return '已退款'
  if (orderStatus === 4) return '未核销'
  if (orderStatus === 5) return '已核销'
  if (orderStatus === 0) return '0'
  return orderStatus ? String(orderStatus) : '未知'
}

function rebateStatusToText(status) {
  if (status === 'success') return '走返利成功'
  if (status === 'failed') return '走返利失败'
  if (status === 'risk') return '触发风控'
  if (status === 'pending') return '未查询'
  return '查询失败'
}

function calcPer(value, num) {
  const n = Number(num)
  const v = Number(value)
  if (!Number.isFinite(v) || !Number.isFinite(n) || n <= 0) return ''
  return (Math.round((v / n) * 100) / 100).toFixed(2)
}

function RebateQueryPage({ accounts }) {
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [orderIds, setOrderIds] = useState([])
  const [loadingType, setLoadingType] = useState('')
  const [results, setResults] = useState([])
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const queryRunIdRef = useRef(0)

  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 })
  const [contextOrderId, setContextOrderId] = useState('')
  const contextMenuRef = useRef(null)

  const selectedAccount = useMemo(() => {
    if (!selectedAccountId) return null
    return accounts.find(a => String(a.userid) === String(selectedAccountId)) || null
  }, [accounts, selectedAccountId])

  const showMessage = (type, text, options = {}) => {
    showToast(type, text, options)
  }

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0 })
    setContextOrderId('')
  }

  useEffect(() => {
    const handleClick = () => closeContextMenu()
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleImportOrders = () => {
    setImportText(orderIds.join('\n'))
    setImportOpen(true)
  }

  const handleConfirmImport = () => {
    const ids = normalizeOrderIds(importText)
    if (!ids.length) {
      showMessage('error', '未检测到订单号')
      return
    }
    setOrderIds(ids)
    setResults([])
    setImportOpen(false)
    showMessage('success', `已导入 ${ids.length} 个订单号`)
  }

  const resultsMap = useMemo(() => {
    const m = new Map()
    ;(results || []).forEach(r => {
      if (r && r.orderId) m.set(String(r.orderId), r)
    })
    return m
  }, [results])

  const displayRows = useMemo(() => {
    return (orderIds || []).map((id) => {
      const orderId = String(id)
      const r = resultsMap.get(orderId)
      return r || { orderId, status: 'pending', message: '未查询', detail: null }
    })
  }, [orderIds, resultsMap])

  const missingOrderIds = useMemo(() => {
    return (orderIds || []).filter(id => !resultsMap.has(String(id)))
  }, [orderIds, resultsMap])

  const doQueryOrders = async ({ ids, reset, type }) => {
    if (!selectedAccount) {
      showMessage('error', '请选择账号')
      return
    }
    if (!ids.length) {
      showMessage('error', reset ? '请先导入订单号' : '暂无需要补全查询的订单')
      return
    }
    if (!selectedAccount.csecuuid || !selectedAccount.openId || !selectedAccount.openIdCipher) {
      showMessage('error', '该账号缺少 csecuuid/openId/openIdCipher，请先使用“抓取Token”重新抓取并保存账号')
      return
    }

    const myRunId = ++queryRunIdRef.current

    setLoadingType(type)
    if (reset) setResults([])

    let ok = 0
    let done = 0
    let refunded = 0

    try {
      for (let i = 0; i < ids.length; i++) {
        if (myRunId !== queryRunIdRef.current) {
          return
        }

        const orderId = String(ids[i] || '').trim()
        if (!orderId) continue

        const r = await window.electronAPI.rebateQueryOne({ account: selectedAccount, orderId })
        console.log('[rebate-query-one] raw ipc response:', r)

        if (myRunId !== queryRunIdRef.current) {
          return
        }

        if (!r.success) {
          showMessage('error', r.error || '查询失败')
          return
        }

        const parsedOne = parseResult(r.data.orderId, r.data.response)
        if (parsedOne.status === 'success') ok++
        if (parsedOne.detail?.orderStatus === 3) refunded++
        done++

        setResults((prev) => {
          if (myRunId !== queryRunIdRef.current) return []
          const next = new Map()
          ;(prev || []).forEach(p => {
            if (p && p.orderId) next.set(String(p.orderId), p)
          })
          next.set(String(parsedOne.orderId), parsedOne)
          return Array.from(next.values())
        })

        if (i !== ids.length - 1) {
          const wait = 700 + Math.floor(Math.random() * 501)
          await new Promise(res => setTimeout(res, wait))
        }
      }

      if (myRunId === queryRunIdRef.current) {
        showMessage('success', reset ? `查询完成：已走返利 ${ok}/${done}，已退款 ${refunded}` : `补全完成：本次已走返利 ${ok}/${done}，已退款 ${refunded}`, { duration: 0 })
      }
    } catch (e) {
      if (myRunId === queryRunIdRef.current) {
        showMessage('error', e.message)
      }
    } finally {
      if (myRunId === queryRunIdRef.current) {
        setLoadingType('')
      }
    }
  }

  const handleClear = () => {
    queryRunIdRef.current++
    setLoadingType('')
    setOrderIds([])
    setResults([])
    setImportText('')
    setImportOpen(false)
    closeContextMenu()
    showMessage('success', '已清空')
  }

  const handleStopQuery = () => {
    queryRunIdRef.current++
    setLoadingType('')
    showMessage('success', '已停止查询')
  }

  const handleStartQuery = async () => {
    await doQueryOrders({ ids: orderIds, reset: true, type: 'start' })
  }

  const handleFillQuery = async () => {
    await doQueryOrders({ ids: missingOrderIds, reset: false, type: 'fill' })
  }

  const handleQuerySingle = async (orderId) => {
    const id = String(orderId || '').trim()
    if (!id) return
    await doQueryOrders({ ids: [id], reset: false })
  }

  const handleExportExcel = async () => {
    if (!results.length) {
      showMessage('error', '暂无结果可导出')
      return
    }

    const headers = [
      '订单号',
      '状态',
      '推广单号',
      '子订单数',
      '单张价格',
      '订单总价格',
      '单张佣金(元)',
      '总佣金(元)',
      '卡券状态',
      '下单时间',
      '下单城市',
      '核销城市',
      '提示'
    ]

    const rows = results.map(r => {
      const d = r.detail || {}
      const num = d.totalCouponNum
      const perPrice = d.daoDianCouponDataList?.[0]?.orderAmount ?? calcPer(d.orderAmount, num)
      const perCommission = d.daoDianCouponDataList?.[0]?.commissionFee ?? calcPer(d.commissionFee, num)
      return [
        r.orderId,
        rebateStatusToText(r.status),
        d.orderViewId || '',
        d.totalCouponNum ?? '',
        perPrice,
        d.orderAmount || '',
        perCommission,
        d.commissionFee || '',
        orderStatusToText(d.orderStatus),
        d.orderPayTime || '',
        d.cityName || '',
        d.consumeCityName || '',
        r.message
      ]
    })

    const rowStyles = results.map((r) => {
      const orderStatus = r.detail?.orderStatus
      const isRefunded = orderStatus === 3
      const isNotRebated = r.status === 'failed'
      if (isRefunded) return 'yellow'
      if (isNotRebated) return 'red'
      return ''
    })

    const filename = `返利查询结果_${Date.now()}.xlsx`
    const r = await window.electronAPI.exportExcel({ data: rows, filename, headers, rowStyles })
    if (r.success) {
      showMessage('success', '导出成功')
    } else if (!r.cancelled) {
      showMessage('error', r.error || '导出失败')
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <BadgeDollarSign className="w-5 h-5 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">返利查询</h1>
      </div>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[720px] max-w-[90vw] bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-medium text-gray-800">导入订单号（换行分割）</div>
              <button
                onClick={() => setImportOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="p-5">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={10}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                placeholder="一行一个订单号"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setImportOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmImport}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  确认导入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="min-w-[260px] flex-1">
            <label className="block text-xs text-gray-500 mb-1">选择账号</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">请选择账号...</option>
              {accounts.map((a) => (
                <option key={a.userid} value={a.userid}>
                  {a.remark} ({a.userid})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button onClick={handleImportOrders} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2">
              <Upload className="w-4 h-4" /> 导入订单号
            </button>
            <button
              onClick={handleClear}
              disabled={loadingType && !orderIds.length && !results.length}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 flex items-center gap-2 disabled:opacity-50"
              title="清空订单号与查询结果"
            >
              <Trash2 className="w-4 h-4" /> 清空
            </button>
            <button
              onClick={loadingType === 'fill' ? handleStopQuery : handleFillQuery}
              disabled={loadingType === 'start' || (!loadingType && missingOrderIds.length === 0)}
              className={`px-4 py-2 ${loadingType === 'fill' ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-500 hover:bg-slate-600'} text-white rounded-lg flex items-center gap-2 disabled:opacity-50`}
              title={missingOrderIds.length ? `尚未查询：${missingOrderIds.length} 个` : '暂无未查询订单'}
            >
              {loadingType === 'fill' ? '停止查询' : '补全查询'}
            </button>
            <button
              onClick={loadingType === 'start' ? handleStopQuery : handleStartQuery}
              disabled={loadingType === 'fill'}
              className={`px-4 py-2 ${loadingType === 'start' ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'} text-white rounded-lg flex items-center gap-2 disabled:opacity-50`}
            >
              <Play className={`w-4 h-4 ${loadingType ? 'animate-pulse' : ''}`} /> {loadingType === 'start' ? '停止查询' : '开始查询'}
            </button>
            <button onClick={handleExportExcel} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2">
              <Download className="w-4 h-4" /> 导出Excel
            </button>
          </div>

          <div className="text-sm text-gray-500">
            已导入订单数：<span className="font-medium">{orderIds.length}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">序号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">结果</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">子订单数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">单张价格</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单总价格</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">单张佣金</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">总佣金</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">支付时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">城市</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">消费城市</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">提示</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayRows.map((r, index) => (
                <tr
                  key={`${r.orderId}-${index}`}
                  className={`${r.detail?.orderStatus === 3 ? 'bg-yellow-100 hover:bg-yellow-200' : r.status === 'failed' ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextOrderId(String(r.orderId))
                    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
                  }}
                >
                  <td className="px-4 py-3 text-sm text-gray-700">{index + 1}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{r.orderId}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        r.status === 'success'
                          ? 'bg-green-100 text-green-800'
                          : r.status === 'failed'
                            ? 'bg-gray-100 text-gray-800'
                            : r.status === 'risk'
                              ? 'bg-yellow-100 text-yellow-800'
                              : r.status === 'pending'
                                ? 'bg-blue-50 text-blue-700'
                              : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.totalCouponNum ?? ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.daoDianCouponDataList?.[0]?.orderAmount ?? calcPer(r.detail?.orderAmount, r.detail?.totalCouponNum)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.orderAmount || ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.daoDianCouponDataList?.[0]?.commissionFee ?? calcPer(r.detail?.commissionFee, r.detail?.totalCouponNum)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.commissionFee || ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{orderStatusToText(r.detail?.orderStatus)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.orderPayTime || ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.cityName || ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{r.detail?.consumeCityName || ''}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{r.message}</td>
                </tr>
              ))}
              {!displayRows.length && (
                <tr>
                  <td colSpan="13" className="px-4 py-8 text-center text-gray-500">
                    暂无结果，请先导入订单号并开始查询
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const oid = contextOrderId
              closeContextMenu()
              handleQuerySingle(oid)
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            查询此订单
          </button>
        </div>
      )}
    </div>
  )
}

export default RebateQueryPage
