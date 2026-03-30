import { useState, useEffect } from 'react'
import { ordersApi, accountsApi } from '../api'
import { Play, Database, Save, Copy } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'

function OrderQueryPage() {
  const { accounts, accountsLoaded, fetchAccounts } = useDataStore()
  const toast = useToastStore()

  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [loading, setLoading] = useState(false)
  const [backendLoading, setBackendLoading] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!accountsLoaded) {
      fetchAccounts(accountsApi)
    }
  }, [accountsLoaded, fetchAccounts])

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(String(accounts[0].id))
    }
  }, [accounts])

  const selectedAccount = accounts.find(a => a.id === parseInt(selectedAccountId))

  // 前端直接调用美团API查询
  const handleQuery = async () => {
    if (!selectedAccountId) {
      toast.warning('请先选择账号')
      return
    }
    if (!orderId.trim()) {
      toast.warning('请输入订单号')
      return
    }
    if (!selectedAccount?.csecuuid || !selectedAccount?.open_id) {
      toast.warning('该账号缺少必要信息(csecuuid/openId)，请先在账号管理中重新抓取')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const meituanResult = await window.electronAPI.rebateQueryOne({
        account: {
          userid: selectedAccount.userid,
          token: selectedAccount.token,
          csecuuid: selectedAccount.csecuuid,
          openId: selectedAccount.open_id,
          openIdCipher: selectedAccount.open_id_cipher
        },
        orderId: orderId.trim()
      })

      if (meituanResult.success && meituanResult.data?.response?.data) {
        const coupons = meituanResult.data.response.data
        setResult({
          success: true,
          coupons: coupons,
          source: 'frontend',
          message: `查询成功，获取到 ${coupons.length} 个券码`
        })
      } else {
        const errorMsg = meituanResult.error || meituanResult.data?.error || '查询失败'
        setResult({
          success: false,
          coupons: [],
          source: 'frontend',
          message: errorMsg
        })
      }
    } catch (error) {
      console.error('Query error:', error)
      setResult({
        success: false,
        coupons: [],
        source: 'frontend',
        message: error.message || '查询异常'
      })
    } finally {
      setLoading(false)
    }
  }

  // 后端调用美团API查询
  const handleBackendQuery = async () => {
    if (!selectedAccountId) {
      toast.warning('请先选择账号')
      return
    }
    if (!orderId.trim()) {
      toast.warning('请输入订单号')
      return
    }

    setBackendLoading(true)
    setResult(null)

    try {
      const response = await ordersApi.queryOrderByOrderId({
        account_id: parseInt(selectedAccountId),
        order_id: orderId.trim()
      })

      if (response.data?.success) {
        const coupons = response.data.coupons || []
        setResult({
          success: true,
          coupons: coupons,
          source: 'backend',
          message: response.data.message || `查询成功，获取到 ${coupons.length} 个券码`,
          saved: response.data.saved
        })
      } else {
        setResult({
          success: false,
          coupons: [],
          source: 'backend',
          message: response.data?.message || '查询失败'
        })
      }
    } catch (error) {
      console.error('Backend query error:', error)
      setResult({
        success: false,
        coupons: [],
        source: 'backend',
        message: error.response?.data?.detail || error.message || '查询异常'
      })
    } finally {
      setBackendLoading(false)
    }
  }

  // 保存查询结果到数据库
  const handleSave = async () => {
    if (!result?.success || !result.coupons?.length) {
      toast.warning('没有可保存的数据')
      return
    }

    try {
      // 先保存或更新订单
      const orderData = {
        orderId: orderId.trim(),
        orderViewId: orderId.trim(),
        orderAmount: 0,
        orderStatus: 1,
        title: result.coupons[0]?.title || ''
      }

      const saveResponse = await ordersApi.saveBatch({
        account_id: parseInt(selectedAccountId),
        orders: [orderData]
      })

      if (saveResponse.data?.success) {
        const savedOrderId = saveResponse.data.order_ids?.[0]

        // 保存券码
        for (const couponInfo of result.coupons) {
          try {
            await ordersApi.saveCoupon({
              account_id: parseInt(selectedAccountId),
              order_id: savedOrderId || null,
              order_view_id: orderId.trim(),
              coupon_data: couponInfo,
              raw_data: { data: result.coupons }
            })
          } catch (saveError) {
            console.error('Save coupon error:', saveError)
          }
        }

        toast.success('保存成功')
        setResult(prev => ({ ...prev, saved: true }))
      } else {
        toast.error('保存失败: ' + (saveResponse.data?.message || '未知错误'))
      }
    } catch (error) {
      console.error('Save error:', error)
      toast.error('保存失败: ' + error.message)
    }
  }

  // 复制券码信息
  const handleCopy = async (coupon) => {
    const text = [
      `券码：${coupon.coupon || coupon.encode || '-'}`,
      `状态：${coupon.order_status || coupon.coupon_status || '-'}`,
      `订单号：${orderId.trim()}`
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败')
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
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.remark || account.userid}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[300px] flex-1">
            <label className="block text-xs text-gray-500 mb-1">订单号</label>
            <input
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              placeholder="请输入订单号"
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
            />
          </div>

          <button
            onClick={handleQuery}
            disabled={loading || backendLoading}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <span className="animate-spin">...</span>
            ) : (
              <Play className="w-4 h-4" />
            )}
            查询
          </button>

          <button
            onClick={handleBackendQuery}
            disabled={loading || backendLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 disabled:opacity-50"
          >
            {backendLoading ? (
              <span className="animate-spin">...</span>
            ) : (
              <Database className="w-4 h-4" />
            )}
            后端查询
          </button>
        </div>
      </div>

      {/* 查询结果 */}
      {result && (
        <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {result.success ? '成功' : '失败'}
              </span>
              <span className="text-sm text-gray-600">{result.message}</span>
              {result.source === 'backend' && (
                <span className="text-xs text-blue-500">(后端查询)</span>
              )}
              {result.saved && (
                <span className="text-xs text-green-500">(已保存)</span>
              )}
            </div>
            {result.success && result.coupons?.length > 0 && !result.saved && (
              <button
                onClick={handleSave}
                className="px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-1 text-sm"
              >
                <Save className="w-3 h-3" /> 保存到数据库
              </button>
            )}
          </div>

          {result.coupons?.length > 0 ? (
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">券码</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">编码</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">标题</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">核销时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">核销门店</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {result.coupons.map((coupon, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{coupon.coupon || '-'}</td>
                      <td className="px-4 py-3 text-sm font-mono">{coupon.encode || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          coupon.order_status === '待使用' ? 'bg-blue-100 text-blue-800' :
                          coupon.order_status === '已使用' ? 'bg-gray-100 text-gray-600' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {coupon.order_status || coupon.coupon_status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[200px]" title={coupon.title}>
                        {coupon.title || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{coupon.verifyTime || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[150px]" title={coupon.verifyPoiName}>
                        {coupon.verifyPoiName || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          onClick={() => handleCopy(coupon)}
                          className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> 复制
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              {result.success ? '该订单没有券码' : '查询失败，请检查订单号或账号信息'}
            </div>
          )}
        </div>
      )}

      {!result && (
        <div className="flex-1 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-500">
          请输入订单号并点击查询
        </div>
      )}
    </div>
  )
}

export default OrderQueryPage
