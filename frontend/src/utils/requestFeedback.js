export const isAbortError = (error) =>
  error?.code === 'ERR_CANCELED' ||
  error?.name === 'CanceledError' ||
  error?.name === 'AbortError'

const pickMessage = (...candidates) => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
}

export const getErrorMessage = (error, fallback = '操作失败') => {
  if (!error) return fallback
  if (typeof error === 'string') return error

  const responseData = error.response?.data
  const detail = responseData?.detail

  if (Array.isArray(detail)) {
    const joined = detail
      .map(item => {
        if (typeof item === 'string') return item
        if (typeof item?.msg === 'string') return item.msg
        return ''
      })
      .filter(Boolean)
      .join('；')

    if (joined) return joined
  }

  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') {
    return detail.msg
  }

  return pickMessage(
    typeof responseData === 'string' ? responseData : '',
    detail,
    responseData?.message,
    responseData?.error,
    error.message,
    fallback
  )
}

export const getResultErrorMessage = (result, fallback = '操作失败') =>
  pickMessage(
    result?.error,
    result?.message,
    result?.data?.detail,
    result?.data?.message,
    result?.data?.error,
    fallback
  )

export const formatCountSummary = (items) => {
  const summary = items
    .filter(item => Number(item?.count) > 0)
    .map(item => `${item.label}${Number(item.count)}`)
    .join('，')

  return summary || '无变化'
}
