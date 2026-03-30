import React, { useState, useEffect, useRef } from 'react'
import { Radio, Play, Square, Trash2, Download, CheckCircle, XCircle, RefreshCw } from 'lucide-react'

function GiftMonitorPage() {
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [records, setRecords] = useState([])
  const [message, setMessage] = useState({ type: '', text: '' })
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [includeRemark, setIncludeRemark] = useState(true)
  const [batchRemark, setBatchRemark] = useState('')
  const batchRemarkRef = useRef('')

  useEffect(() => {
    batchRemarkRef.current = batchRemark
  }, [batchRemark])

  useEffect(() => {
    // 监听礼物数据
    window.electronAPI.onGiftDataReceived((data) => {
      setRecords(prev => [...prev, { ...data, remark: batchRemarkRef.current }])
    })

    // 监听错误（只提示，不显示日志框）
    window.electronAPI.onGiftMonitorError((errorMessage) => {
      showMessage('error', errorMessage)
    })

    return () => {
      window.electronAPI.removeAllListeners('gift-data-received')
      window.electronAPI.removeAllListeners('gift-monitor-error')
    }
  }, [])

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
  }

  // 开始监控
  const handleStartMonitor = async () => {
    // 验证备注不能为空
    if (!batchRemark.trim()) {
      showMessage('error', '请先输入备注信息')
      return
    }
    
    setIsLoading(true)
    const hintTimer = setTimeout(() => {
      showMessage('success', '启动耗时较长：首次运行可能需要生成/安装证书，请稍等(30-60秒)。')
    }, 5000)
    
    try {
      const result = await window.electronAPI.startGiftMonitor(8899)
      if (result.success) {
        setIsMonitoring(true)
        showMessage('success', '监控已启动')
      } else {
        showMessage('error', result.error || '启动失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      clearTimeout(hintTimer)
      setIsLoading(false)
    }
  }

  // 停止监控
  const handleStopMonitor = async () => {
    try {
      await window.electronAPI.stopGiftMonitor()
      setIsMonitoring(false)
      showMessage('success', '监控已停止')
    } catch (error) {
      showMessage('error', error.message)
    }
  }

  // 清空数据
  const handleClearData = () => {
    if (window.confirm('确定要清空所有数据吗？')) {
      setRecords([])
      showMessage('success', '数据已清空')
    }
  }

  // 重置证书
  const handleResetCertificates = async () => {
    if (!window.confirm('确定要重置证书吗？这将停止监控并重新生成CA证书。')) {
      return
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.resetCertificates()
      setIsMonitoring(false)
      if (result.success) {
        showMessage('success', '证书已重置，请重新开启监控')
      } else {
        showMessage('error', result.error || '证书重置失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setIsLoading(false)
    }
  }

  // 收集数据
  const collectData = (onlySelected = false) => {
    const items = onlySelected 
      ? records.filter((_, i) => selectedRows.has(i))
      : records
    return items.filter(r => r.coupon)
  }

  // 复制全部券码
  const handleCopyAllCoupons = () => {
    const items = collectData(false)
    const text = items.map(r => {
      if (includeRemark && r.remark) {
        return `${r.coupon}---${r.remark}`
      }
      return r.coupon
    }).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制 ${items.length} 个券码`)
  }

  // 复制全部订单号+券码
  const handleCopyAllGiftCoupons = () => {
    const items = collectData(false)
    const text = items.map(r => {
      if (includeRemark && r.remark) {
        return `${r.giftid}---${r.coupon}---${r.remark}`
      }
      return `${r.giftid}---${r.coupon}`
    }).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制 ${items.length} 条 订单号+券码`)
  }

  // 复制选中券码
  const handleCopySelectedCoupons = () => {
    const items = collectData(true)
    if (items.length === 0) {
      showMessage('error', '未选中任何券码')
      return
    }
    const text = items.map(r => {
      if (includeRemark && r.remark) {
        return `${r.coupon}---${r.remark}`
      }
      return r.coupon
    }).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制选中 ${items.length} 个券码`)
  }

  // 复制选中订单号+券码
  const handleCopySelectedGiftCoupons = () => {
    const items = collectData(true)
    if (items.length === 0) {
      showMessage('error', '未选中任何数据')
      return
    }
    const text = items.map(r => {
      if (includeRemark && r.remark) {
        return `${r.giftid}---${r.coupon}---${r.remark}`
      }
      return `${r.giftid}---${r.coupon}`
    }).join('\n')
    navigator.clipboard.writeText(text)
    showMessage('success', `已复制选中 ${items.length} 条 订单号+券码`)
  }

  // 导出Excel
  const handleExportExcel = async () => {
    if (records.length === 0) {
      showMessage('error', '暂无数据可导出')
      return
    }

    const filename = `礼物监控_${new Date().toISOString().replace(/[:.]/g, '')}.xlsx`
    const headers = ['礼物订单号', '券码', '状态', '备注', '捕获时间']
    const data = records.map(r => [r.giftid, r.coupon, r.statusText, r.remark || '', r.timestamp])

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
          <Radio className="w-5 h-5 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">礼物领取监控</h1>
        {isMonitoring && (
          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full animate-pulse">
            监控中...
          </span>
        )}
      </div>

      {/* 右上角弹窗提示 */}
      {message.text && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 min-w-[200px] max-w-[400px] ${
            message.type === 'success' 
              ? 'bg-green-500 text-white' 
              : 'bg-red-500 text-white'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <XCircle className="w-5 h-5 flex-shrink-0" />}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        </div>
      )}

      {/* 控制按钮 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex items-center gap-2 relative z-10">
            <span className="text-sm text-gray-600 whitespace-nowrap">备注 <span className="text-red-500">*</span></span>
            <input
              type="text"
              value={batchRemark}
              onChange={(e) => setBatchRemark(e.target.value)}
              placeholder="请输入本批次备注"
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ pointerEvents: 'auto' }}
            />
          </div>
          <button
            onClick={handleStartMonitor}
            disabled={isMonitoring || isLoading}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading ? <span className="animate-spin">⌛</span> : <Play className="w-4 h-4" />}
            {isLoading ? '启动中...' : '开启监控'}
          </button>
          <button
            onClick={handleStopMonitor}
            disabled={!isMonitoring}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
          >
            <Square className="w-4 h-4" /> 停止监控
          </button>
          <button
            onClick={handleClearData}
            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> 清空数据
          </button>
          <button
            onClick={handleExportExcel}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> 导出Excel
          </button>
          <button
            onClick={handleResetCertificates}
            disabled={isLoading}
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-2"
            title="如果遇到网络问题，可尝试重置证书"
          >
            <RefreshCw className="w-4 h-4" /> 重置证书
          </button>
        </div>
      </div>

      {/* 复制按钮 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-center">
          <button onClick={handleCopyAllCoupons} className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">
            复制全部券码
          </button>
          <button onClick={handleCopyAllGiftCoupons} className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">
            复制全部订单号+券码
          </button>
          <button onClick={handleCopySelectedCoupons} className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm">
            复制选中券码
          </button>
          <button onClick={handleCopySelectedGiftCoupons} className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm">
            复制选中订单号+券码
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeRemark}
              onChange={(e) => setIncludeRemark(e.target.checked)}
              className="rounded"
            />
            是否复制备注信息
          </label>
        </div>
      </div>

      {/* 状态信息 */}
      <div className="text-sm text-gray-500 mb-2">
        已捕获 {records.length} 条记录
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
                      if (e.target.checked) {
                        setSelectedRows(new Set(records.map((_, i) => i)))
                      } else {
                        setSelectedRows(new Set())
                      }
                    }}
                    checked={selectedRows.size === records.length && records.length > 0}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">礼物订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">捕获时间</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {records.map((record, index) => (
                <tr 
                  key={index} 
                  className={`hover:bg-gray-50 ${selectedRows.has(index) ? 'bg-orange-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(index)}
                      onChange={() => toggleRowSelection(index)}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{record.giftid}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{record.coupon}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      record.statusText?.includes('待使用') || record.statusText?.includes('未使用')
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {record.statusText || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{record.remark || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{record.timestamp}</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                    暂无数据，请开启监控
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}

export default GiftMonitorPage
