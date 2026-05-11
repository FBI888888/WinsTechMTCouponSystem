import { QUERY_RESULT_STATUS } from '../utils/queryResult'

function getMetaLabel(meta) {
  if (!meta) return ''
  if (meta.source === 'cache') return '已使用本页缓存结果'
  if (meta.source === 'backend') return '后端查询'
  return '已完成本地查询'
}

function getCouponCode(coupon) {
  return coupon.couponCode || coupon.coupon || coupon.coupon_code || coupon.current_coupon_code || '-'
}

function getCouponStatus(coupon) {
  return coupon.couponStatus || coupon.order_status || coupon.coupon_status || '-'
}

export default function CouponQueryResultDialog({
  open,
  onClose,
  titleSuffix = '',
  queryResult,
  queryMeta,
  loading,
  onRefresh
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[600px] max-w-[90vw] max-h-[80vh] bg-white rounded-xl shadow-lg overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-800">
              券码查询结果{titleSuffix ? ` - ${titleSuffix}` : ''}
            </div>
            {queryMeta && (
              <div className="text-xs text-gray-500 mt-1">
                {getMetaLabel(queryMeta)}
              </div>
            )}
            {queryResult && (
              <div className="text-xs text-gray-500 mt-1">
                {queryResult.sourceLabel} · {queryResult.status === QUERY_RESULT_STATUS.SUCCESS ? `共 ${queryResult.count} 条` : '失败结果'}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="text-sm text-orange-600 hover:text-orange-700 disabled:opacity-50"
              >
                重新查询
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="p-5 overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
              <span className="ml-3 text-gray-600">查询中...</span>
            </div>
          ) : queryResult ? (
            <div className="space-y-4">
              {queryResult.status === QUERY_RESULT_STATUS.SUCCESS && queryResult.count > 0 ? (
                queryResult.coupons.map((coupon, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">券码：</span>
                        <span className="font-mono font-medium">{getCouponCode(coupon)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">状态：</span>
                        <span className="font-medium">{getCouponStatus(coupon)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">核销时间：</span>
                        <span>{coupon.verifyTime || coupon.verify_time || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">核销门店：</span>
                        <span>{coupon.verifyPoiName || coupon.verify_poi_name || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">有效期：</span>
                        <span>{coupon.validStartTime || '-'} 至 {coupon.validEndTime || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">券码类型：</span>
                        <span>{coupon.couponType || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-8">
                  {queryResult.message || '未查询到券码信息'}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              无查询结果
            </div>
          )}
        </div>
      </div>
    </div>
  )
}