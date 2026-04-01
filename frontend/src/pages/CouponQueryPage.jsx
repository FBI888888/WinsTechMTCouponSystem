import { useState, useEffect } from 'react'
import { couponsApi } from '../api'
import { Play, Download, Trash2, RefreshCw, Database, ArrowRight, Info, X, Clock, User, FileText, AlertCircle } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'

function CouponQueryPage() {
  const {
    couponQueryResults: storedResults,
    couponQueryCodes: storedCodes,
    setCouponQueryData,
    clearCouponQueryData
  } = useDataStore()
  const toast = useToastStore()

  const [couponCodes, setCouponCodes] = useState(storedCodes || '')
  const [results, setResults] = useState(storedResults || [])
  const [loading, setLoading] = useState(false)
  const [backendLoading, setBackendLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  // 详情弹窗状态
  const [showDetail, setShowDetail] = useState(false)
  const [detailData, setDetailData] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    setCouponQueryData(results, couponCodes)
  }, [results, couponCodes])

  // 获取券码详情
  const handleShowDetail = async (couponCode) => {
    setDetailLoading(true)
    setShowDetail(true)
    setDetailData(null)

    try {
      const response = await couponsApi.getDetailByCode(couponCode)
      setDetailData(response.data)
    } catch (error) {
      console.error('获取详情失败:', error)
      toast.error('获取详情失败: ' + (error.response?.data?.detail || error.message))
      setShowDetail(false)
    } finally {
      setDetailLoading(false)
    }
  }

  // 关闭弹窗
  const handleCloseDetail = () => {
    setShowDetail(false)
    setDetailData(null)
  }

  const handleCopy = async (result) => {
    const lines = [`券码：${result.current_coupon_code || result.coupon_code}`]

    if (result.old_coupon_code) {
      lines.push(`原券码：${result.old_coupon_code}（已变更）`)
    }

    lines.push(`券码状态：${result.coupon_status || '-'}`)

    if (result.verify_time) {
      lines.push(`核销时间：${result.verify_time}`)
    }
    if (result.verify_poi_name) {
      lines.push(`核销门店：${result.verify_poi_name}`)
    }

    const orderId = result.order_view_id !== '-' ? result.order_view_id : result.gift_id
    const orderLabel = result.gift_id !== '-' ? '礼物号' : '订单号'
    lines.push(`${orderLabel}：${orderId || '-'}`)
    lines.push(`MTUserID：${result.userid || '-'}`)

    if (result.code_changed) {
      lines.push(`变更类型：${getChangeTypeText(result.change_type)}`)
    }
    if (result.change_count > 0) {
      lines.push(`历史变更次数：${result.change_count}`)
    }

    const text = lines.join('\n')

    try {
      await navigator.clipboard.writeText(text)
      const btn = document.getElementById(`copy-btn-${result.coupon_code}`)
      if (btn) {
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      }
    } catch (error) {
      console.error('复制失败:', error)
      toast.error('复制失败')
    }
  }

  const handleQuery = async () => {
    const codes = couponCodes.split(/[\n,]/).map(c => c.trim()).filter(Boolean)
    if (!codes.length) {
      toast.warning('请输入券码')
      return
    }

    setLoading(true)
    setProgress({ current: 0, total: codes.length })
    setResults([])

    const allResults = []

    try {
      const dbResponse = await couponsApi.query({ coupon_codes: codes })
      const dbResults = dbResponse.data || []

      for (let i = 0; i < dbResults.length; i++) {
        const item = dbResults[i]
        setProgress({ current: i + 1, total: codes.length })

        if (item.status !== 'found' || !item.userid || !item.token) {
          const idStr = String(item.order_view_id || '')
          const isGiftId = idStr.length > 20 || /^[a-zA-Z]/.test(idStr)
          const displayOrderId = isGiftId ? '-' : (item.order_view_id || '-')
          const displayGiftId = isGiftId ? idStr : (item.gift_id || '-')

          allResults.push({
            coupon_code: item.coupon_code,
            current_coupon_code: item.current_coupon_code || item.coupon_code,
            order_view_id: displayOrderId,
            gift_id: displayGiftId,
            userid: item.userid || '-',
            coupon_status: item.coupon_status || '-',
            verify_time: '',
            verify_poi_name: '',
            status: item.status,
            account_id: item.account_id,
            order_db_id: item.order_id,
            is_old_code: item.is_old_code || false,
            code_changed: false,
            change_type: 'none',
            change_count: 0
          })
          continue
        }

        try {
          const idStr = String(item.order_view_id || '')
          const isGiftId = idStr.length > 20 || /^[a-zA-Z]/.test(idStr)
          const queryOrderId = isGiftId ? idStr : item.order_view_id

          const meituanResult = await window.electronAPI.rebateQueryOne({
            account: {
              userid: item.userid,
              token: item.token,
              csecuuid: item.csecuuid || 'c34d9b03-7520-47e3-9d7c-17a3d930c48d',
              openId: item.open_id,
              openIdCipher: item.open_id_cipher
            },
            orderId: queryOrderId,
            isGiftId: isGiftId
          })

          if (meituanResult.success && meituanResult.data?.response?.data) {
            const coupons = meituanResult.data.response.data
            const actualCode = item.current_coupon_code || item.coupon_code
            const matchedCoupon = coupons.find(c =>
              c.coupon === actualCode ||
              c.encode === actualCode ||
              c.coupon_code === actualCode ||
              c.coupon === item.coupon_code ||
              c.encode === item.coupon_code
            )

            if (matchedCoupon) {
              const verifyTime = matchedCoupon.verifyTime || ''
              const verifyPoiName = matchedCoupon.verifyPoiName || ''
              const displayOrderId = isGiftId ? '-' : (item.order_view_id || '-')
              const displayGiftId = isGiftId ? idStr : (item.gift_id || '-')

              allResults.push({
                coupon_code: item.coupon_code,
                current_coupon_code: item.current_coupon_code || matchedCoupon.coupon || item.coupon_code,
                order_view_id: displayOrderId,
                gift_id: displayGiftId,
                userid: item.userid || '-',
                coupon_status: matchedCoupon.order_status || matchedCoupon.coupon_status || '未知',
                use_status: matchedCoupon.useStatus,
                verify_time: verifyTime,
                verify_poi_name: verifyPoiName,
                status: 'success',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: item.is_old_code || false,
                code_changed: false,
                change_type: 'none',
                change_count: item.change_info?.change_count || 0
              })
            } else {
              try {
                const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] })
                const backendResult = backendResponse.data?.[0]
                if (backendResult && backendResult.status === 'found') {
                  allResults.push({
                    coupon_code: backendResult.coupon_code,
                    current_coupon_code: backendResult.current_coupon_code || backendResult.coupon_code,
                    order_view_id: backendResult.order_view_id || '-',
                    gift_id: backendResult.gift_id || '-',
                    userid: backendResult.userid || '-',
                    coupon_status: backendResult.coupon_status || '-',
                    verify_time: backendResult.verify_time || '',
                    verify_poi_name: backendResult.verify_poi_name || '',
                    status: 'backend',
                    account_id: item.account_id,
                    order_db_id: item.order_id,
                    is_old_code: backendResult.is_old_code || false,
                    code_changed: backendResult.code_changed || false,
                    change_type: backendResult.change_type || 'none',
                    old_coupon_code: backendResult.old_coupon_code,
                    change_count: backendResult.change_count || 0
                  })
                } else {
                  allResults.push({
                    coupon_code: item.coupon_code,
                    current_coupon_code: item.current_coupon_code || item.coupon_code,
                    order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                    gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                    userid: item.userid || '-',
                    coupon_status: item.coupon_status || '-',
                    verify_time: '',
                    verify_poi_name: '',
                    status: 'partial',
                    account_id: item.account_id,
                    order_db_id: item.order_id,
                    is_old_code: item.is_old_code || false,
                    code_changed: false,
                    change_type: 'none',
                    change_count: 0
                  })
                }
              } catch (backendError) {
                console.error('Backend query error:', backendError)
                allResults.push({
                  coupon_code: item.coupon_code,
                  current_coupon_code: item.current_coupon_code || item.coupon_code,
                  order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                  gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                  userid: item.userid || '-',
                  coupon_status: item.coupon_status || '-',
                  verify_time: '',
                  verify_poi_name: '',
                  status: 'partial',
                  account_id: item.account_id,
                  order_db_id: item.order_id,
                  is_old_code: item.is_old_code || false,
                  code_changed: false,
                  change_type: 'none',
                  change_count: 0
                })
              }
            }
          } else {
            try {
              const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] })
              const backendResult = backendResponse.data?.[0]
              if (backendResult && backendResult.status === 'found') {
                allResults.push({
                  coupon_code: backendResult.coupon_code,
                  current_coupon_code: backendResult.current_coupon_code || backendResult.coupon_code,
                  order_view_id: backendResult.order_view_id || '-',
                  gift_id: backendResult.gift_id || '-',
                  userid: backendResult.userid || '-',
                  coupon_status: backendResult.coupon_status || '-',
                  verify_time: backendResult.verify_time || '',
                  verify_poi_name: backendResult.verify_poi_name || '',
                  status: 'backend',
                  account_id: item.account_id,
                  order_db_id: item.order_id,
                  is_old_code: backendResult.is_old_code || false,
                  code_changed: backendResult.code_changed || false,
                  change_type: backendResult.change_type || 'none',
                  old_coupon_code: backendResult.old_coupon_code,
                  change_count: backendResult.change_count || 0
                })
              } else {
                allResults.push({
                  coupon_code: item.coupon_code,
                  current_coupon_code: item.current_coupon_code || item.coupon_code,
                  order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                  gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                  userid: item.userid || '-',
                  coupon_status: item.coupon_status || '-',
                  verify_time: '',
                  verify_poi_name: '',
                  status: 'error',
                  account_id: item.account_id,
                  order_db_id: item.order_id,
                  is_old_code: item.is_old_code || false,
                  code_changed: false,
                  change_type: 'none',
                  change_count: 0
                })
              }
            } catch (backendError) {
              console.error('Backend query error:', backendError)
              allResults.push({
                coupon_code: item.coupon_code,
                current_coupon_code: item.current_coupon_code || item.coupon_code,
                order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                userid: item.userid || '-',
                coupon_status: item.coupon_status || '-',
                verify_time: '',
                verify_poi_name: '',
                status: 'error',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: item.is_old_code || false,
                code_changed: false,
                change_type: 'none',
                change_count: 0
              })
            }
          }
        } catch (error) {
          console.error('Query meituan error:', error)
          try {
            const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] })
            const backendResult = backendResponse.data?.[0]
            if (backendResult && backendResult.status === 'found') {
              allResults.push({
                coupon_code: backendResult.coupon_code,
                current_coupon_code: backendResult.current_coupon_code || backendResult.coupon_code,
                order_view_id: backendResult.order_view_id || '-',
                gift_id: backendResult.gift_id || '-',
                userid: backendResult.userid || '-',
                coupon_status: backendResult.coupon_status || '-',
                verify_time: backendResult.verify_time || '',
                verify_poi_name: backendResult.verify_poi_name || '',
                status: 'backend',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: backendResult.is_old_code || false,
                code_changed: backendResult.code_changed || false,
                change_type: backendResult.change_type || 'none',
                old_coupon_code: backendResult.old_coupon_code,
                change_count: backendResult.change_count || 0
              })
            } else {
              allResults.push({
                coupon_code: item.coupon_code,
                current_coupon_code: item.current_coupon_code || item.coupon_code,
                order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                userid: item.userid || '-',
                coupon_status: item.coupon_status || '-',
                verify_time: '',
                verify_poi_name: '',
                status: 'error',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: item.is_old_code || false,
                code_changed: false,
                change_type: 'none',
                change_count: 0
              })
            }
          } catch (backendError) {
            console.error('Backend query error:', backendError)
            allResults.push({
              coupon_code: item.coupon_code,
              current_coupon_code: item.current_coupon_code || item.coupon_code,
              order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
              gift_id: isGiftId ? idStr : (item.gift_id || '-'),
              userid: item.userid || '-',
              coupon_status: item.coupon_status || '-',
              verify_time: '',
              verify_poi_name: '',
              status: 'error',
              account_id: item.account_id,
              order_db_id: item.order_id,
              is_old_code: item.is_old_code || false,
              code_changed: false,
              change_type: 'none',
              change_count: 0
            })
          }
        }

        if (i < dbResults.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      setResults(allResults)

      const successResults = allResults.filter(r =>
        r.status === 'success' &&
        r.coupon_status &&
        (r.current_coupon_code || r.coupon_code)
      )

      if (successResults.length > 0) {
        try {
          await couponsApi.batchUpdate({
            coupons: successResults.map(r => ({
              coupon_code: r.current_coupon_code || r.coupon_code,
              coupon_status: r.coupon_status,
              use_status: r.use_status
            }))
          })
          console.log(`批量更新了 ${successResults.length} 条券码状态`)
        } catch (updateError) {
          console.error('批量更新券码状态失败:', updateError)
        }
      }
    } catch (error) {
      console.error('Query failed:', error)
      toast.error('查询失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleBackendQuery = async () => {
    const codes = couponCodes.split(/[\n,]/).map(c => c.trim()).filter(Boolean)
    if (!codes.length) {
      toast.warning('请输入券码')
      return
    }

    setBackendLoading(true)
    setResults([])

    try {
      const response = await couponsApi.queryBackend({ coupon_codes: codes })
      const backendResults = response.data || []

      const allResults = backendResults.map(item => ({
        coupon_code: item.coupon_code,
        current_coupon_code: item.current_coupon_code || item.coupon_code,
        order_view_id: item.order_view_id || '-',
        gift_id: item.gift_id || '-',
        userid: item.userid || '-',
        coupon_status: item.coupon_status || '-',
        verify_time: item.verify_time || '',
        verify_poi_name: item.verify_poi_name || '',
        status: item.status,
        is_old_code: item.is_old_code || false,
        code_changed: item.code_changed || false,
        change_type: item.change_type || 'none',
        old_coupon_code: item.old_coupon_code,
        change_count: item.change_count || 0
      }))

      setResults(allResults)
    } catch (error) {
      console.error('Backend query failed:', error)
      toast.error('后端查询失败: ' + error.message)
    } finally {
      setBackendLoading(false)
    }
  }

  const handleExport = async () => {
    const headers = ['券码', '当前券码', '订单号', '礼物号', 'USERID', '券码状态', '核销时间', '核销门店', '状态', '变更状态', '旧券码', '变更次数']
    const rows = results.map(r => [
      r.coupon_code,
      r.current_coupon_code || r.coupon_code,
      r.order_view_id || '',
      r.gift_id || '',
      r.userid || '',
      r.coupon_status || '',
      r.verify_time || '',
      r.verify_poi_name || '',
      r.status,
      getChangeTypeText(r.change_type),
      r.old_coupon_code || '',
      r.change_count || 0
    ])

    try {
      await window.electronAPI.exportExcel({
        data: rows,
        filename: `券码查询结果_${new Date().toISOString().split('T')[0]}.xlsx`,
        headers
      })
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const handleClear = () => {
    setCouponCodes('')
    setResults([])
    clearCouponQueryData()
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
      case 'found':
      case 'backend':
        return 'bg-green-100 text-green-800'
      case 'not_found': return 'bg-gray-100 text-gray-800'
      case 'partial': return 'bg-yellow-100 text-yellow-800'
      case 'error': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'success':
      case 'found':
        return '成功'
      case 'backend': return '成功'
      case 'not_found': return '未找到'
      case 'partial': return '部分成功'
      case 'error': return '错误'
      default: return status
    }
  }

  const getChangeTypeColor = (changeType, isOldCode) => {
    if (isOldCode) {
      return 'bg-blue-100 text-blue-800'
    }
    switch (changeType) {
      case 'full': return 'bg-red-100 text-red-800'
      case 'partial': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  const getChangeTypeText = (changeType) => {
    switch (changeType) {
      case 'full': return '全部变更'
      case 'partial': return '部分变更'
      default: return '-'
    }
  }

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-'
    try {
      return new Date(dateStr).toLocaleString('zh-CN')
    } catch {
      return dateStr
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* 工具栏 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> 清空
            </button>
            <button
              onClick={handleQuery}
              disabled={loading || backendLoading}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  查询中 {progress.current}/{progress.total}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> 查询
                </>
              )}
            </button>
            <button
              onClick={handleBackendQuery}
              disabled={loading || backendLoading}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 disabled:opacity-50"
            >
              {backendLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  查询中...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" /> 后端查询
                </>
              )}
            </button>
            <button
              onClick={handleExport}
              disabled={!results.length}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> 导出Excel
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-gray-500 mb-1">
            输入券码（每行一个或逗号分隔）
          </label>
          <textarea
            value={couponCodes}
            onChange={(e) => setCouponCodes(e.target.value)}
            rows={6}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
            placeholder="请输入券码，每行一个&#10;例如：&#10;027356222860&#10;026825522544"
          />
        </div>
      </div>

      {/* 结果表格 */}
      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">礼物号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">USERID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">核销时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">核销门店</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">查询状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">变更状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {results.map((result, index) => (
                <tr key={index} className={`hover:bg-gray-50 ${result.is_old_code ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">
                    <div className="flex items-center gap-2">
                      <span>{result.coupon_code}</span>
                      {result.is_old_code && (
                        <span className="text-xs text-blue-600 flex items-center gap-1">
                          <ArrowRight className="w-3 h-3" />
                          {result.current_coupon_code}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{result.order_view_id || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{result.gift_id || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{result.userid || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      result.coupon_status === '待使用' ? 'bg-blue-100 text-blue-800' :
                      result.coupon_status === '已使用' ? 'bg-gray-100 text-gray-600' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {result.coupon_status || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{result.verify_time || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[150px] truncate" title={result.verify_poi_name}>{result.verify_poi_name || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(result.status)}`}>
                      {getStatusText(result.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getChangeTypeColor(result.change_type, result.is_old_code)}`}>
                        {result.is_old_code ? '旧券码' : getChangeTypeText(result.change_type)}
                      </span>
                      {result.code_changed && result.old_coupon_code && (
                        <span className="text-xs text-gray-500" title="原券码">
                          原: {result.old_coupon_code}
                        </span>
                      )}
                      {result.change_count > 0 && (
                        <span className="text-xs text-gray-400">
                          变更{result.change_count}次
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleShowDetail(result.coupon_code)}
                        className="px-2 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100"
                        title="查看详情"
                      >
                        详情
                      </button>
                      <button
                        id={`copy-btn-${result.coupon_code}`}
                        onClick={() => handleCopy(result)}
                        className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                      >
                        复制
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {results.length === 0 && !loading && (
                <tr>
                  <td colSpan="10" className="px-4 py-8 text-center text-gray-500">
                    暂无查询结果，请输入券码并点击查询
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 详情弹窗 */}
      {showDetail && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleCloseDetail}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* 弹窗头部 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Info className="w-5 h-5 text-purple-500" />
                券码详情
              </h3>
              <button onClick={handleCloseDetail} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-500">加载中...</span>
                </div>
              ) : detailData ? (
                <div className="space-y-6">
                  {/* 券码信息 */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      券码信息
                    </h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">当前券码：</span>
                        <span className="font-mono font-medium">{detailData.coupon?.coupon_code || '-'}</span>
                        {detailData.is_old_code && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">旧券码查询</span>
                        )}
                      </div>
                      <div>
                        <span className="text-gray-500">Encode：</span>
                        <span className="font-mono">{detailData.coupon?.encode || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">券码状态：</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          detailData.coupon?.coupon_status === '待使用' ? 'bg-blue-100 text-blue-700' :
                          detailData.coupon?.coupon_status === '已使用' ? 'bg-gray-200 text-gray-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {detailData.coupon?.coupon_status || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">礼物ID：</span>
                        <span className="font-mono">{detailData.coupon?.gift_id || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">最后查询：</span>
                        <span>{formatDateTime(detailData.coupon?.query_time)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">创建时间：</span>
                        <span>{formatDateTime(detailData.coupon?.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 订单信息 */}
                  {detailData.order && (
                    <div className="bg-blue-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-500" />
                        订单信息
                      </h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">订单号：</span>
                          <span className="font-mono">{detailData.order?.order_view_id || detailData.order?.order_id || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">标题：</span>
                          <span className="truncate" title={detailData.order?.title}>{detailData.order?.title || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">订单金额：</span>
                          <span className="text-orange-600 font-medium">¥{detailData.order?.order_amount || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">佣金：</span>
                          <span className="text-green-600">¥{detailData.order?.commission_fee || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">券码数量：</span>
                          <span>{detailData.order?.total_coupon_num || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">订单状态：</span>
                          <span>{detailData.order?.showstatus || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">分类：</span>
                          <span>{detailData.order?.catename || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">是否礼物：</span>
                          <span>{detailData.order?.is_gift ? '是' : '否'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">下单城市：</span>
                          <span>{detailData.order?.city_name || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">支付时间：</span>
                          <span>{formatDateTime(detailData.order?.order_pay_time)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 账号信息 */}
                  {detailData.account && (
                    <div className="bg-green-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <User className="w-4 h-4 text-green-500" />
                        账号信息
                      </h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">账号ID：</span>
                          <span>{detailData.account?.id}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">备注：</span>
                          <span>{detailData.account?.remark || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">MT UserID：</span>
                          <span className="font-mono">{detailData.account?.userid || '-'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">账号状态：</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            detailData.account?.status === 'normal' ? 'bg-green-100 text-green-700' :
                            detailData.account?.status === 'invalid' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {detailData.account?.status === 'normal' ? '正常' :
                             detailData.account?.status === 'invalid' ? '失效' : '未检测'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">最后检测：</span>
                          <span>{formatDateTime(detailData.account?.last_check_time)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 变更历史 */}
                  {detailData.change_history && detailData.change_history.length > 0 && (
                    <div className="bg-orange-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-orange-500" />
                        变更历史（共 {detailData.change_history.length} 次）
                      </h4>
                      <div className="space-y-2">
                        {detailData.change_history.map((h, idx) => (
                          <div key={h.id} className="flex items-center gap-3 text-sm bg-white rounded p-2">
                            <span className="text-gray-400 text-xs w-6">#{idx + 1}</span>
                            <span className="font-mono text-red-600">{h.old_coupon_code}</span>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                            <span className="font-mono text-green-600">{h.new_coupon_code}</span>
                            <span className="text-gray-400 text-xs ml-auto">{formatDateTime(h.changed_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 无变更历史提示 */}
                  {(!detailData.change_history || detailData.change_history.length === 0) && (
                    <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500 text-sm">
                      <AlertCircle className="w-5 h-5 mx-auto mb-2 text-gray-300" />
                      暂无变更记录
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-12">暂无数据</div>
              )}
            </div>

            {/* 弹窗底部 */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                onClick={handleCloseDetail}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CouponQueryPage