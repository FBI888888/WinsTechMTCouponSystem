import { useState, useEffect } from 'react'
import { couponsApi } from '../api'
import { Play, Download, Trash2, RefreshCw, Copy, Database } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'

function CouponQueryPage() {
  // 从 store 获取持久化数据
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

  // 同步结果到 store
  useEffect(() => {
    setCouponQueryData(results, couponCodes)
  }, [results, couponCodes])

  // 复制券码信息到剪贴板
  const handleCopy = async (result) => {
    const lines = [`券码：${result.coupon_code}`]
    lines.push(`券码状态：${result.coupon_status || '-'}`)

    // 只有已使用状态才添加核销信息
    if (result.verify_time) {
      lines.push(`核销时间：${result.verify_time}`)
    }
    if (result.verify_poi_name) {
      lines.push(`核销门店：${result.verify_poi_name}`)
    }

    // 订单号或礼物号
    const orderId = result.order_view_id !== '-' ? result.order_view_id : result.gift_id
    const orderLabel = result.gift_id !== '-' ? '礼物号' : '订单号'
    lines.push(`${orderLabel}：${orderId || '-'}`)
    lines.push(`MTUserID：${result.userid || '-'}`)

    const text = lines.join('\n')

    try {
      await navigator.clipboard.writeText(text)
      // 简单的成功提示
      const btn = document.getElementById(`copy-btn-${result.coupon_code}`)
      if (btn) {
        btn.textContent = '已复制'
        setTimeout(() => {
          btn.textContent = '复制'
        }, 1500)
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
      // 1. 先从数据库查询券码关联的账号信息
      const dbResponse = await couponsApi.query({ coupon_codes: codes })
      const dbResults = dbResponse.data || []

      // 2. 遍历结果，调用美团API获取最新状态
      for (let i = 0; i < dbResults.length; i++) {
        const item = dbResults[i]
        setProgress({ current: i + 1, total: codes.length })

        if (item.status !== 'found' || !item.userid || !item.token) {
          // 数据库中没有找到或缺少账号信息
          const idStr = String(item.order_view_id || '')
          const isGiftId = idStr.length > 20 || /^[a-zA-Z]/.test(idStr)
          const displayOrderId = isGiftId ? '-' : (item.order_view_id || '-')
          const displayGiftId = isGiftId ? idStr : (item.gift_id || '-')

          allResults.push({
            coupon_code: item.coupon_code,
            order_view_id: displayOrderId,
            gift_id: displayGiftId,
            userid: item.userid || '-',
            coupon_status: item.coupon_status || '-',
            verify_time: '',
            verify_poi_name: '',
            status: item.status,
            account_id: item.account_id,
            order_db_id: item.order_id
          })
          continue
        }

        // 3. 调用 Electron API 查询美团券码最新状态
        try {
          // 通过位数判断订单号和礼物号
          // 订单号通常是19位左右，礼物号通常是23位左右（超过20位视为礼物号）
          const idStr = String(item.order_view_id || '')
          const isGiftId = idStr.length > 20 || /^[a-zA-Z]/.test(idStr)

          // 如果是礼物号，使用 gift_id 字段传递；否则使用 order_view_id
          const queryOrderId = isGiftId ? idStr : item.order_view_id

          const meituanResult = await window.electronAPI.rebateQueryOne({
            account: {
              userid: item.userid,
              token: item.token,
              csecuuid: item.csecuuid,
              openId: item.open_id,
              openIdCipher: item.open_id_cipher
            },
            orderId: queryOrderId,
            isGiftId: isGiftId  // 标记是否为礼物号
          })

          if (meituanResult.success && meituanResult.data?.response?.data) {
            const coupons = meituanResult.data.response.data
            // 找到匹配的券码
            const matchedCoupon = coupons.find(c =>
              c.coupon === item.coupon_code ||
              c.encode === item.coupon_code ||
              c.coupon_code === item.coupon_code
            )

            if (matchedCoupon) {
              // 直接使用后端返回的核销信息字段
              const verifyTime = matchedCoupon.verifyTime || ''
              const verifyPoiName = matchedCoupon.verifyPoiName || ''

              // 根据判断结果，正确设置订单号和礼物号
              const displayOrderId = isGiftId ? '-' : (item.order_view_id || '-')
              const displayGiftId = isGiftId ? idStr : (item.gift_id || '-')

              allResults.push({
                coupon_code: item.coupon_code,
                order_view_id: displayOrderId,
                gift_id: displayGiftId,
                userid: item.userid || '-',
                coupon_status: matchedCoupon.order_status || matchedCoupon.coupon_status || '未知',
                use_status: matchedCoupon.useStatus,
                verify_time: verifyTime,
                verify_poi_name: verifyPoiName,
                status: 'success',
                account_id: item.account_id,
                order_db_id: item.order_id
              })
            } else {
              // 券码列表中没有匹配的，调用后端接口获取数据库中的信息
              try {
                const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] })
                const backendResult = backendResponse.data?.[0]
                if (backendResult && backendResult.status === 'found') {
                  allResults.push({
                    coupon_code: backendResult.coupon_code,
                    order_view_id: backendResult.order_view_id || '-',
                    gift_id: backendResult.gift_id || '-',
                    userid: backendResult.userid || '-',
                    coupon_status: backendResult.coupon_status || '-',
                    verify_time: backendResult.verify_time || '',
                    verify_poi_name: backendResult.verify_poi_name || '',
                    status: 'backend',
                    account_id: item.account_id,
                    order_db_id: item.order_id
                  })
                } else {
                  allResults.push({
                    coupon_code: item.coupon_code,
                    order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                    gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                    userid: item.userid || '-',
                    coupon_status: item.coupon_status || '-',
                    verify_time: '',
                    verify_poi_name: '',
                    status: 'partial',
                    account_id: item.account_id,
                    order_db_id: item.order_id
                  })
                }
              } catch (backendError) {
                console.error('Backend query error:', backendError)
                allResults.push({
                  coupon_code: item.coupon_code,
                  order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                  gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                  userid: item.userid || '-',
                  coupon_status: item.coupon_status || '-',
                  verify_time: '',
                  verify_poi_name: '',
                  status: 'partial',
                  account_id: item.account_id,
                  order_db_id: item.order_id
                })
              }
            }
          } else {
            // Electron查询失败，调用后端接口获取数据库中的信息
            try {
              const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] })
              const backendResult = backendResponse.data?.[0]
              if (backendResult && backendResult.status === 'found') {
                allResults.push({
                  coupon_code: backendResult.coupon_code,
                  order_view_id: backendResult.order_view_id || '-',
                  gift_id: backendResult.gift_id || '-',
                  userid: backendResult.userid || '-',
                  coupon_status: backendResult.coupon_status || '-',
                  verify_time: backendResult.verify_time || '',
                  verify_poi_name: backendResult.verify_poi_name || '',
                  status: 'backend',
                  account_id: item.account_id,
                  order_db_id: item.order_id
                })
              } else {
                allResults.push({
                  coupon_code: item.coupon_code,
                  order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                  gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                  userid: item.userid || '-',
                  coupon_status: item.coupon_status || '-',
                  verify_time: '',
                  verify_poi_name: '',
                  status: 'error',
                  account_id: item.account_id,
                  order_db_id: item.order_id
                })
              }
            } catch (backendError) {
              console.error('Backend query error:', backendError)
              allResults.push({
                coupon_code: item.coupon_code,
                order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                userid: item.userid || '-',
                coupon_status: item.coupon_status || '-',
                verify_time: '',
                verify_poi_name: '',
                status: 'error',
                account_id: item.account_id,
                order_db_id: item.order_id
              })
            }
          }
        } catch (error) {
          console.error('Query meituan error:', error)
          // Electron查询异常，调用后端接口获取数据库中的信息
          try {
            const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] })
            const backendResult = backendResponse.data?.[0]
            if (backendResult && backendResult.status === 'found') {
              allResults.push({
                coupon_code: backendResult.coupon_code,
                order_view_id: backendResult.order_view_id || '-',
                gift_id: backendResult.gift_id || '-',
                userid: backendResult.userid || '-',
                coupon_status: backendResult.coupon_status || '-',
                verify_time: backendResult.verify_time || '',
                verify_poi_name: backendResult.verify_poi_name || '',
                status: 'backend',
                account_id: item.account_id,
                order_db_id: item.order_id
              })
            } else {
              allResults.push({
                coupon_code: item.coupon_code,
                order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                userid: item.userid || '-',
                coupon_status: item.coupon_status || '-',
                verify_time: '',
                verify_poi_name: '',
                status: 'error',
                account_id: item.account_id,
                order_db_id: item.order_id
              })
            }
          } catch (backendError) {
            console.error('Backend query error:', backendError)
            allResults.push({
              coupon_code: item.coupon_code,
              order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
              gift_id: isGiftId ? idStr : (item.gift_id || '-'),
              userid: item.userid || '-',
              coupon_status: item.coupon_status || '-',
              verify_time: '',
              verify_poi_name: '',
              status: 'error',
              account_id: item.account_id,
              order_db_id: item.order_id
            })
          }
        }

        // 请求间隔
        if (i < dbResults.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      setResults(allResults)

      // 批量更新查询成功的券码状态到数据库
      const successResults = allResults.filter(r =>
        r.status === 'success' &&
        r.coupon_status &&
        r.coupon_code
      )

      if (successResults.length > 0) {
        try {
          await couponsApi.batchUpdate({
            coupons: successResults.map(r => ({
              coupon_code: r.coupon_code,
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

  // 后端查询 - 直接从数据库获取券码信息
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
        order_view_id: item.order_view_id || '-',
        gift_id: item.gift_id || '-',
        userid: item.userid || '-',
        coupon_status: item.coupon_status || '-',
        verify_time: item.verify_time || '',
        verify_poi_name: item.verify_poi_name || '',
        status: item.status
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
    const headers = ['券码', '订单号', '礼物号', 'USERID', '券码状态', '核销时间', '核销门店', '状态']
    const rows = results.map(r => [
      r.coupon_code,
      r.order_view_id || '',
      r.gift_id || '',
      r.userid || '',
      r.coupon_status || '',
      r.verify_time || '',
      r.verify_poi_name || '',
      r.status
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
      case 'found':  // 后端查询成功也显示绿色
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
      case 'found':  // 后端查询成功也显示"成功"
        return '成功'
      case 'backend': return '成功'  // 数据库查询成功也显示"成功"
      case 'not_found': return '未找到'
      case 'partial': return '部分成功'
      case 'error': return '错误'
      default: return status
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {results.map((result, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">{result.coupon_code}</td>
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
                    <button
                      id={`copy-btn-${result.coupon_code}`}
                      onClick={() => handleCopy(result)}
                      className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> 复制
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && !loading && (
                <tr>
                  <td colSpan="9" className="px-4 py-8 text-center text-gray-500">
                    暂无查询结果，请输入券码并点击查询
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

export default CouponQueryPage
