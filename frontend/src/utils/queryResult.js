export const QUERY_RESULT_STATUS = {
  IDLE: 'idle',
  SUCCESS: 'success',
  ERROR: 'error'
}

const QUERY_SOURCE_LABELS = {
  frontend: '本地查询',
  backend: '后端查询'
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
    coupons,
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
