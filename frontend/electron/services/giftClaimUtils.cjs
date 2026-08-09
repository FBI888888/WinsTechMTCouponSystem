const VALID_PLATFORMS = new Set(['android', 'windows', 'ios', 'harmony'])

function requireText(value, label) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label}不能为空`)
  return text
}

function normalizeCredential(credential, { requireUserId = true } = {}) {
  const source = credential && typeof credential === 'object' ? credential : {}
  const platform = String(source.platform || '').trim().toLowerCase()
  if (!VALID_PLATFORMS.has(platform)) throw new Error('请选择有效平台')

  return {
    ...source,
    userid: requireUserId ? requireText(source.userid || source.userId, 'userId') : String(source.userid || source.userId || '').trim(),
    token: requireText(source.token, 'Token'),
    platform
  }
}

function buildPlainGiftRequest(token, giftId) {
  const normalizedToken = requireText(token, 'Token')
  const normalizedGiftId = requireText(giftId, '礼物号')
  const url = new URL('https://apimobile.meituan.com/api/foodorder/receiveGift')
  url.searchParams.set('giftId', normalizedGiftId)
  url.searchParams.set('token', normalizedToken)
  url.searchParams.set('useNewProcess', 'true')

  return {
    url: url.toString(),
    body: {
      token: normalizedToken,
      useNewProcess: true
    }
  }
}

function findGiftCouponArrays(value, arrays = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return arrays
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item) => findGiftCouponArrays(item, arrays, seen))
    return arrays
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'coupons' && Array.isArray(child)) arrays.push(child)
    findGiftCouponArrays(child, arrays, seen)
  }
  return arrays
}

function extractGiftCardsFromResponse(payload, sourceOrderId) {
  const root = payload?.data?.nodeDataMap?.CouponModule1
    || payload?.nodeDataMap?.CouponModule1
    || payload
  const couponArrays = findGiftCouponArrays(root)
  const gifts = new Map()

  for (const coupons of couponArrays) {
    for (const coupon of coupons) {
      const extra = coupon?.giftExtra || coupon?.gift_extra
      const giftId = String(extra?.giftId || extra?.gift_id || coupon?.giftId || coupon?.gift_id || '').trim()
      if (!giftId || gifts.has(giftId)) continue

      const giftStatus = Number(extra?.giftStatus ?? extra?.gift_status ?? coupon?.giftStatus ?? 0)
      const statusText = String(extra?.statusText || extra?.status_text || coupon?.statusText || '').trim()
      gifts.set(giftId, {
        gift_id: giftId,
        gift_status: Number.isFinite(giftStatus) ? giftStatus : 0,
        status_text: statusText,
        card_url: String(extra?.cardUrl || extra?.card_url || '').trim(),
        wish: String(extra?.wish || '').trim(),
        share_title: String(extra?.shareTitle || extra?.share_title || '').trim(),
        deliver_time: extra?.deliverTime ?? extra?.deliver_time ?? null,
        coupon_code: String(coupon?.coupon || coupon?.code || coupon?.couponCode || coupon?.coupon_code || '').trim(),
        source_order_id: String(sourceOrderId || '').trim(),
        claimable: (Number.isFinite(giftStatus) ? giftStatus : 0) === 0
      })
    }
  }

  return [...gifts.values()]
}

function extractGiftCardsFromCoupons(coupons, sourceOrderId) {
  return extractGiftCardsFromResponse({ coupons: Array.isArray(coupons) ? coupons : [] }, sourceOrderId)
}

function responseMessage(payload, fallback = '领取失败') {
  return String(
    payload?.data?.mainText
    || payload?.data?.subText
    || payload?.msg
    || payload?.message
    || fallback
  )
}

function classifyReceiveGiftResponse(payload, httpStatus = 200) {
  const yodaCode = Number(payload?.yodaCode ?? payload?.data?.yodaCode)
  const generalPageUrl = payload?.data?.generalPageUrl
    || payload?.generalPageUrl
    || payload?.customData?.generalPageUrl
    || payload?.data?.customData?.generalPageUrl
    || ''
  const riskMessage = [payload?.msg, payload?.message, payload?.data?.mainText]
    .filter(Boolean)
    .join(' ')
  if (
    httpStatus === 403
    || httpStatus === 418
    || payload?.code === 403
    || yodaCode === 403
    || yodaCode === 406
    || Boolean(generalPageUrl)
    || /风控|yoda|forbidden/i.test(riskMessage)
  ) {
    const riskCode = Number(payload?.result ?? payload?.code ?? (Number.isFinite(yodaCode) ? yodaCode : httpStatus))
    return {
      success: false,
      category: 'risk',
      code: Number.isFinite(riskCode) ? riskCode : httpStatus,
      message: responseMessage(payload, '触发风控验证'),
      generalPageUrl
    }
  }

  if (payload?.result === 0 && payload?.success === true && payload?.failed !== true) {
    return {
      success: true,
      category: 'success',
      code: 0,
      message: responseMessage(payload, '礼物领取成功')
    }
  }

  const code = Number(payload?.result ?? payload?.code)
  const category = code === 1011
    ? 'limit'
    : code === 1003
      ? 'transient'
    : code === 5083
      ? 'self_gift'
      : code === 5084
        ? 'unavailable'
        : 'failed'

  return {
    success: false,
    category,
    code: Number.isFinite(code) ? code : null,
    message: responseMessage(payload)
  }
}

module.exports = {
  VALID_PLATFORMS,
  normalizeCredential,
  buildPlainGiftRequest,
  extractGiftCardsFromResponse,
  extractGiftCardsFromCoupons,
  classifyReceiveGiftResponse
}
