import { useState, useEffect, useCallback } from 'react'
import { logsApi } from '../api'
import { useDataStore } from '../stores/dataStore'
import { ChevronLeft, ChevronRight } from 'lucide-react'

function LogPage() {
  // 全局缓存
  const {
    logs, logsLoaded, logsTab, logsPage, logsTotal,
    setLogs
  } = useDataStore()

  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(logsTab || 'operations')
  const [currentPage, setCurrentPage] = useState(logsPage || 1)
  const [pageSize] = useState(20)  // 减少每页条数，提升性能

  const loadLogs = useCallback(async (forceRefresh = false) => {
    // 如果已加载且不强制刷新且tab没变且页码没变，直接返回
    if (logsLoaded && !forceRefresh && logsTab === activeTab && logsPage === currentPage) return

    setLoading(true)
    try {
      let api
      if (activeTab === 'operations') {
        api = logsApi.getOperations
      } else if (activeTab === 'logins') {
        api = logsApi.getLogins
      } else {
        api = logsApi.getScheduledTasks
      }

      // 分页查询
      const response = await api({
        skip: (currentPage - 1) * pageSize,
        limit: pageSize
      })
      setLogs(response.data.items || [], response.data.total || 0, currentPage, pageSize, activeTab)
    } catch (error) {
      console.error('Failed to load logs:', error)
    } finally {
      setLoading(false)
    }
  }, [activeTab, currentPage, pageSize, logsLoaded, logsTab, logsPage, setLogs])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  // 切换tab时重置页码
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setCurrentPage(1)
  }

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage)
  }

  const totalPages = Math.ceil((logsTotal || 0) / pageSize)

  // 获取状态颜色
  const getStatusColor = (status) => {
    switch (status) {
      case 'success': return 'bg-green-100 text-green-800'
      case 'failed': return 'bg-red-100 text-red-800'
      case 'running': return 'bg-blue-100 text-blue-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'success': return '成功'
      case 'failed': return '失败'
      case 'running': return '运行中'
      default: return status
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-2 items-center">
          <button
            onClick={() => handleTabChange('operations')}
            className={`px-4 py-2 rounded-lg ${activeTab === 'operations' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            操作日志
          </button>
          <button
            onClick={() => handleTabChange('logins')}
            className={`px-4 py-2 rounded-lg ${activeTab === 'logins' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            登录日志
          </button>
          <button
            onClick={() => handleTabChange('scheduled')}
            className={`px-4 py-2 rounded-lg ${activeTab === 'scheduled' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            定时任务日志
          </button>
          <button
            onClick={() => loadLogs(true)}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 ml-auto"
          >
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {activeTab === 'operations' ? (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">目标类型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">详情</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                  </>
                ) : activeTab === 'logins' ? (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">原因</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">开始时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">任务名称</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">扫描账号</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">发现订单</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">查询券码</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">耗时</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">错误信息</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50">
                  {activeTab === 'operations' ? (
                    <>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.created_at}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{log.action}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.target_type}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.details}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.ip_address}</td>
                    </>
                  ) : activeTab === 'logins' ? (
                    <>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.created_at}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{log.username}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          log.login_status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {log.login_status === 'success' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.ip_address}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.fail_reason || '-'}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.started_at}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{log.task_name}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(log.status)}`}>
                          {getStatusText(log.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.accounts_scanned || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.orders_found || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.coupons_queried || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.duration_seconds ? `${log.duration_seconds}秒` : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate" title={log.error_message}>{log.error_message || '-'}</td>
                    </>
                  )}
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={activeTab === 'scheduled' ? 8 : 5} className="px-4 py-8 text-center text-gray-500">
                    暂无日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页控件 */}
        {logsTotal > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white">
            <div className="text-sm text-gray-500">
              显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, logsTotal)} 条，共 {logsTotal} 条
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
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
                  } else if (currentPage <= 3) {
                    pageNum = i + 1
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = currentPage - 2 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`px-3 py-1 rounded ${currentPage === pageNum ? 'bg-orange-500 text-white' : 'border border-gray-300 hover:bg-gray-100'}`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
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

export default LogPage
