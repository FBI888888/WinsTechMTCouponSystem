import { useEffect, useState } from 'react'
import { ordersApi, accountsApi } from '../api'
import { Play, Database, Save, Copy } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { formatCountSummary, getErrorMessage, getResultErrorMessage } from '../utils/requestFeedback'
import {
  createErrorQueryResult,
  createSuccessQueryResult,
  markQueryResultSaved,
  QUERY_RESULT_STATUS
} from '../utils/queryResult'

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
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(String(accounts[0].id))
    }
  }, [accounts, selectedAccountId])

  const selectedAccount = accounts.find(account => account.id === parseInt(selectedAccountId, 10))

  const resetResult = () => {
    setResult(null)
  }

  const buildQueryMeta = () => ({
    queryOrderId: orderId.trim(),
    accountId: selectedAccountId
  })

  const handleQuery = async () => {
    if (!selectedAccountId) {
      toast.warning('请先选择账号')
      return
    }
    if (!orderId.trim()) {
      toast.warning('请输入订单号')
      return
    }
    if (!selectedAccount?.open_id) {
      toast.warning('该账号缺少必要信息(openId)，请先在账号管理中重新抓取')
      return
    }

    setLoading(true)
    resetResult()

    try {
      const meituanResult = await window.electronAPI.rebateQueryOne({
        account: {
          userid: selectedAccount.userid,
          token: selectedAccount.token,
          csecuuid: selectedAccount.csecuuid || 'c34d9b03-7520-47e3-9d7c-17a3d930c48d',
          openId: selectedAccount.open_id,
          openIdCipher: selectedAccount.open_id_cipher
        },
        orderId: orderId.trim()
      })

      if (meituanResult.success && Array.isArray(meituanResult.data?.response?.data)) {
        const coupons = meituanResult.data.response.data
        setResult(createSuccessQueryResult({
          source: 'frontend',
          coupons,
          message: `查询成功，获取到 ${coupons.length} 个券码`,
          meta: buildQueryMeta()
        }))
      } else {
        setResult(createErrorQueryResult({
          source: 'frontend',
          message: getResultErrorMessage(meituanResult, '查询失败'),
          meta: buildQueryMeta()
        }))
      }
    } catch (error) {
      console.error('Query error:', error)
      setResult(createErrorQueryResult({
        source: 'frontend',
        message: getErrorMessage(error, '查询异常'),
        meta: buildQueryMeta()
      }))
    } finally {
      setLoading(false)
    }
  }

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
    resetResult()

    try {
      const response = await ordersApi.queryOrderByOrderId({
        account_id: parseInt(selectedAccountId, 10),
        order_id: orderId.trim()
      })

      if (response.data?.success) {
        const coupons = response.data.coupons || []
        setResult(createSuccessQueryResult({
          source: 'backend',
          coupons,
          message: response.data.message || `查询成功，获取到 ${coupons.length} 个券码`,
          saved: Boolean(response.data.saved),
          meta: buildQueryMeta()
        }))
      } else {
        setResult(createErrorQueryResult({
          source: 'backend',
          message: response.data?.message || '查询失败',
          meta: buildQueryMeta()
        }))
      }
    } catch (error) {
      console.error('Backend query error:', error)
      setResult(createErrorQueryResult({
        source: 'backend',
        message: getErrorMessage(error, '查询异常'),
        meta: buildQueryMeta()
      }))
    } finally {
      setBackendLoading(false)
    }
  }

  const handleSave = async () => {
    if (result?.status !== QUERY_RESULT_STATUS.SUCCESS || !result.coupons?.length) {
      toast.warning('没有可保存的数据')
      return
    }

    try {
      const orderData = {
        orderId: orderId.trim(),
        orderViewId: orderId.trim(),
        orderAmount: 0,
        orderStatus: 1,
        title: result.coupons[0]?.title || ''
      }

      const saveResponse = await ordersApi.saveBatch({
        account_id: parseInt(selectedAccountId, 10),
        orders: [orderData]
      })

      if (!saveResponse.data?.success) {
        toast.error('保存失败: ' + getErrorMessage({ response: { data: saveResponse.data } }, '未知错误'))
        return
      }

      const savedOrderId = saveResponse.data.order_ids?.[0]
      const summary = formatCountSummary([
        { label: '新增', count: saveResponse.data?.new_count || 0 },
        { label: '更新', count: saveResponse.data?.update_count || 0 },
        { label: '跳过', count: saveResponse.data?.skip_count || 0 }
      ])

      for (const couponInfo of result.coupons) {
        try {
          await ordersApi.saveCoupon({
            account_id: parseInt(selectedAccountId, 10),
            order_id: savedOrderId || null,
            order_view_id: orderId.trim(),
            coupon_data: couponInfo,
            raw_data: { data: result.coupons }
          })
        } catch (saveError) {
          console.error('Save coupon error:', saveError)
        }
      }

      toast.success(`保存成功: ${summary}`)
      setResult(previous => markQueryResultSaved(previous))
    } catch (error) {
      console.error('Save error:', error)
      toast.error('保存失败: ' + getErrorMessage(error, '未知错误'))
    }
  }

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

  const getCouponStatusTone = (coupon) => {
    const status = coupon.order_status || coupon.coupon_status || ''
    if (status.includes('待')) return 'bg-blue-100 text-blue-800'
    if (status.includes('已')) return 'bg-gray-100 text-gray-700'
    return 'bg-gray-100 text-gray-800'
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
            {loading ? <span className="animate-spin">...</span> : <Play className="w-4 h-4" />}
            本地查询
          </button>

          <button
            onClick={handleBackendQuery}
            disabled={loading || backendLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 disabled:opacity-50"
          >
            {backendLoading ? <span className="animate-spin">...</span> : <Database className="w-4 h-4" />}
            后端查询
          </button>
        </div>
      </div>

      {result ? (
        <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                result.status === QUERY_RESULT_STATUS.SUCCESS
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {result.status === QUERY_RESULT_STATUS.SUCCESS ? '成功' : '失败'}
              </span>
              <span className="text-sm text-gray-600">{result.message}</span>
              <span className="text-xs text-blue-500">({result.sourceLabel})</span>
              {result.saved && (
                <span className="text-xs text-green-600">(已保存)</span>
              )}
              {result.status === QUERY_RESULT_STATUS.SUCCESS && (
                <span className="text-xs text-gray-500">共 {result.count} 条</span>
              )}
            </div>

            {result.status === QUERY_RESULT_STATUS.SUCCESS && result.count > 0 && !result.saved && (
              <button
                onClick={handleSave}
                className="px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-1 text-sm"
              >
                <Save className="w-3 h-3" />
                保存到数据库
              </button>
            )}
          </div>

          {result.count > 0 ? (
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
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCouponStatusTone(coupon)}`}>
                          {coupon.order_status || coupon.coupon_status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[220px]" title={coupon.title}>
                        {coupon.title || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{coupon.verifyTime || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[160px]" title={coupon.verifyPoiName}>
                        {coupon.verifyPoiName || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          onClick={() => handleCopy(coupon)}
                          className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          复制
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              {result.status === QUERY_RESULT_STATUS.SUCCESS
                ? '该订单没有可展示的券码'
                : '查询失败，请检查订单号或账号信息'}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-500">
          请输入订单号并选择查询方式
        </div>
      )}
    </div>
  )
}

export default OrderQueryPage
