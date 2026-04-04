import { useState, useEffect, useRef } from 'react'
import { statsApi } from '../api'

function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    account: { total: 0, normal: 0, invalid: 0, disabled: 0 },
    order: { total: 0, pending: 0, completed: 0 },
    coupon: { total: 0, pending: 0, used: 0 }
  })
  const statsRequestIdRef = useRef(0)
  const statsAbortControllerRef = useRef(null)

  const isAbortError = (error) =>
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError'

  useEffect(() => {
    loadStats()
    return () => {
      statsAbortControllerRef.current?.abort()
      statsRequestIdRef.current += 1
    }
  }, [])

  const loadStats = async () => {
    const requestId = ++statsRequestIdRef.current
    statsAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    statsAbortControllerRef.current = abortController
    setLoading(true)
    try {
      const res = await statsApi.getDashboard({ signal: abortController.signal })
      if (requestId !== statsRequestIdRef.current) return
      if (res.data) {
        setStats(res.data)
      }
    } catch (error) {
      if (isAbortError(error)) return
      if (requestId !== statsRequestIdRef.current) return
      console.error('加载统计数据失败:', error)
    } finally {
      if (statsAbortControllerRef.current === abortController) {
        statsAbortControllerRef.current = null
      }
      if (requestId === statsRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  const StatCard = ({ title, value, icon, color, subStats }) => (
    <div className="bg-white rounded-xl shadow-sm p-6 flex-1 min-w-[200px]">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d={icon} />
          </svg>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-800">{value}</div>
          <div className="text-sm text-gray-500">{title}</div>
        </div>
      </div>
      {subStats && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex gap-4 text-xs text-gray-500">
          {subStats.map((stat, i) => (
            <span key={i}>{stat.label}: <span className={stat.color}>{stat.value}</span></span>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">系统仪表盘</h1>
        <p className="text-gray-500 mt-1">系统运行状态概览</p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <StatCard
              title="账号总数"
              value={stats.account.total}
              icon="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-1.79 4-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
              color="bg-blue-500"
              subStats={[
                { label: '正常', value: stats.account.normal, color: 'text-green-600' },
                { label: '失效', value: stats.account.invalid, color: 'text-red-600' },
                { label: '禁用', value: stats.account.disabled, color: 'text-gray-600' }
              ]}
            />
            <StatCard
              title="订单总数"
              value={stats.order.total}
              icon="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
              color="bg-purple-500"
              subStats={[
                { label: '待使用', value: stats.order.pending, color: 'text-orange-600' },
                { label: '已完成', value: stats.order.completed, color: 'text-green-600' }
              ]}
            />
            <StatCard
              title="券码总数"
              value={stats.coupon.total}
              icon="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"
              color="bg-green-500"
              subStats={[
                { label: '待使用', value: stats.coupon.pending, color: 'text-orange-600' },
                { label: '已使用', value: stats.coupon.used, color: 'text-gray-600' }
              ]}
            />
          </div>

          {/* 快捷操作 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">快捷操作</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <a
                href="#/accounts"
                className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-1.79 4-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-800">账号管理</div>
                  <div className="text-xs text-gray-500">管理美团账号</div>
                </div>
              </a>
              <a
                href="#/orders"
                className="flex items-center gap-3 p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-800">订单列表</div>
                  <div className="text-xs text-gray-500">查看所有订单</div>
                </div>
              </a>
              <a
                href="#/coupons"
                className="flex items-center gap-3 p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
              >
                <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-800">券码查询</div>
                  <div className="text-xs text-gray-500">查询券码状态</div>
                </div>
              </a>
              <a
                href="#/logs"
                className="flex items-center gap-3 p-4 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
              >
                <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H6v-2h6v2zm4-4H6v-2h10v2zm0-4H6V7h10v2z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-800">运行日志</div>
                  <div className="text-xs text-gray-500">查看系统日志</div>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DashboardPage
