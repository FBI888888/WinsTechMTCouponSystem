export const QUERY_RESULT_STATUS = {
  IDLE: 'idle',
  SUCCESS: 'success',
  ERROR: 'error'
}

const QUERY_SOURCE_LABELS = {
  frontend: '本地查询',
  backend: '后端查询'
}

/** 占位券码（需经纬度重试后仍失败时不应入库/展示） */
export const isPlaceholderCouponCode = (code) =>
  String(code || '').replace(/\s/g, '') === '000000000000'

export const stripPlaceholderCoupons = (list) => {
  if (!Array.isArray(list)) return []
  return list.filter(
    (c) => !isPlaceholderCouponCode(c?.coupon || c?.code || c?.coupon_code || c?.encode)
  )
}

const buildBaseQueryResult = ({
  status,
  source,
  message,
  coupons = [],
  saved = false,
  meta = {}
}) => ({
  status,
  success: status === QUERY_RESULT_STATUS.SUCCESS,
  source,
  sourceLabel: QUERY_SOURCE_LABELS[source] || source || '未知来源',
  message,
  coupons,
  count: Array.isArray(coupons) ? coupons.length : 0,
  saved,
  meta
})

export const createSuccessQueryResult = ({
  source,
  message,
  coupons = [],
  saved = false,
  meta = {}
}) =>
  buildBaseQueryResult({
    status: QUERY_RESULT_STATUS.SUCCESS,
    source,
    message,
    coupons: stripPlaceholderCoupons(coupons),
    saved,
    meta
  })

export const createErrorQueryResult = ({
  source,
  message,
  meta = {}
}) =>
  buildBaseQueryResult({
    status: QUERY_RESULT_STATUS.ERROR,
    source,
    message,
    coupons: [],
    saved: false,
    meta
  })

export const markQueryResultSaved = (result) => {
  if (!result) return result
  return {
    ...result,
    saved: true
  }
}
