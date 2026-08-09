function searchableOrderText(order) {
  const orderInfo = Array.isArray(order?.orderinfo)
    ? order.orderinfo.map((item) => (
        typeof item === 'string' ? item : Object.values(item || {}).join(' ')
      )).join(' ')
    : ''
  return [
    order?.orderid,
    order?.stringOrderId,
    order?.title,
    order?.showstatus,
    order?.catename,
    orderInfo
  ].filter(Boolean).join(' ').toLowerCase()
}

export function filterGiftOrders(orders, keyword) {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase()
  if (!normalizedKeyword) return Array.isArray(orders) ? orders : []
  return (Array.isArray(orders) ? orders : []).filter(
    (order) => searchableOrderText(order).includes(normalizedKeyword)
  )
}
