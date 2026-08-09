/**
 * 后端美团API服务 - 供Python通过subprocess调用
 * 用法: node meituanBackendApi.cjs <action> <args_json>
 */

const axios = require('axios')
const http = require('http')
const https = require('https')
const readline = require('readline')
const { sign: signRequest, reinit: reinitSigner } = require('./mtgsig_standalone')
const {
  DEFAULT_COOKIES,
  DEFAULT_PLATFORM,
  getPlatformConfig,
} = require('./platformConfig.cjs')

// Compatibility defaults for historical capture accounts only. Native
// accounts never inherit identity values from this profile.
const LEGACY_REQUEST_PROFILE = Object.freeze({
  cityId: '795',
  appVersion: '10.13.4',
  uuid: '19b373b4485c8-6002391ccec5e4-0-0-19b373b4485c8',
  openId: 'oJVP50DRAdtKlPFyi66xw2Uw03Is',
  finger: '582897vz66wv5u2xy55wx99z6yz4v54280y626y3xw29797833u146v1',
  rcfUniqueId: 'rcf49e2.49cc1e183816a.83cc0e339-adf9.f2cae2b95-84c5.8550adc46-0a59.6446ca0ec-1872.392ddd3ee-default-1775211828231',
  rcfToken: '5cac67121c9d446c8c2d7b93'
})
const GIFT_REQUEST_PROFILE = LEGACY_REQUEST_PROFILE

function resolveAccountRequestOptions(options = {}) {
  const isNative = String(options.credentialSource || '').toLowerCase() === 'native'
  const legacyValue = (name, profileName) => {
    const own = options[name]
    if (own !== undefined && own !== null && String(own) !== '') return own
    return isNative ? '' : LEGACY_REQUEST_PROFILE[profileName]
  }
  return {
    ...options,
    uuid: legacyValue('uuid', 'uuid'),
    openId: legacyValue('openId', 'openId'),
    finger: legacyValue('finger', 'finger'),
    unionId: options.unionId || '',
    openIdCipher: options.openIdCipher || '',
    unionIdCipher: options.unionIdCipher || '',
  }
}

function applyAccountCredentialHeaders(headers, options) {
  const mappings = {
    openid: options.openId,
    openidcipher: options.openIdCipher,
    unionid: options.unionId,
    unionidcipher: options.unionIdCipher,
    csecuuid: options.uuid,
  }
  for (const [name, value] of Object.entries(mappings)) {
    if (value) headers[name] = String(value)
  }
  return headers
}

const BACKEND_API_DEBUG = process.env.MEITUAN_BACKEND_DEBUG === '1'

function debugLog(...args) {
  if (BACKEND_API_DEBUG) {
    console.error(...args)
  }
}

const axiosClient = axios.create({
  timeout: 15000,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 10 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 10 })
})

/**
 * 获取签名后的 URL（与 mt-qrcode-web 对齐：默认每次 fresh 会话，防风控）
 */
function getSignedUrl(methodOrOpts, url, body, cookies) {
  let opts
  if (typeof methodOrOpts === 'object') {
    opts = methodOrOpts
  } else {
    opts = { method: methodOrOpts, url, body, cookies: cookies || DEFAULT_COOKIES }
  }
  if (!opts.cookies) opts.cookies = DEFAULT_COOKIES
  // 不强制 fresh/maxReuse：mtgsig_core 默认 fresh=true（每次新建会话）

  try {
    const { signedUrl } = signRequest(opts)
    return signedUrl || opts.url
  } catch (e) {
    console.error('Sign failed:', e.message)
    try {
      reinitSigner()
    } catch (_) {}
    return opts.url
  }
}

function isWindControlResponse(data) {
  if (!data) return false
  return data.code === 403
    || (typeof data.msg === 'string' && data.msg.includes('风控'))
    || (typeof data.message === 'string' && data.message.includes('风控'))
}

function getYodaVerificationDetails(source) {
  const data = source?.response?.data || source
  const generalPageUrl = data?.customData?.generalPageUrl
  if (typeof generalPageUrl !== 'string' || !generalPageUrl.trim()) return null

  return {
    code: 'YODA_VERIFICATION_REQUIRED',
    message: '触发美团风控验证，请完成验证后重新查询',
    generalPageUrl: generalPageUrl.trim(),
    requestCode: data?.customData?.requestCode || '',
    riskLevel: data?.customData?.riskLevel || '',
    yodaCode: data?.yodaCode,
    status: source?.response?.status
  }
}

function createYodaWindControlResult(source) {
  const details = getYodaVerificationDetails(source)
  if (!details) return null

  return {
    success: false,
    error: details.message,
    isWindControl: true,
    riskControl: details,
    coupons: []
  }
}

function reinitOnWindControl() {
  try {
    reinitSigner()
  } catch (_) {}
}

function applyLocationToPayload(payload, lat, lng) {
  if (!payload?.pageQuery || !payload?.commonParams?.location) return
  const latText = String(lat)
  const lngText = String(lng)
  const latNumber = parseFloat(latText)
  const lngNumber = parseFloat(lngText)

  payload.pageQuery.lat = latText
  payload.pageQuery.lng = lngText
  payload.pageQuery.latitude = latText
  payload.pageQuery.longitude = lngText
  payload.commonParams.location.lat = latNumber
  payload.commonParams.location.lng = lngNumber
  payload.commonParams.location.latitude = latNumber
  payload.commonParams.location.longitude = lngNumber
}

function buildLocationObject(longitude, latitude) {
  const locationObj = { accuracy: 0 }
  if (longitude !== undefined && longitude !== null && longitude !== '') {
    const lng = parseFloat(longitude)
    if (Number.isFinite(lng)) {
      locationObj.longitude = lng
      locationObj.lng = lng
    }
  }
  if (latitude !== undefined && latitude !== null && latitude !== '') {
    const lat = parseFloat(latitude)
    if (Number.isFinite(lat)) {
      locationObj.latitude = lat
      locationObj.lat = lat
    }
  }
  return locationObj
}

function getNodePayload(node) {
  return node?.props || node?.p || null
}

function isPlaceholderCouponCode(code) {
  return String(code || '').replace(/\s/g, '') === '000000000000'
}

function stripPlaceholderCoupons(list) {
  if (!Array.isArray(list)) return []
  return list.filter((c) => !isPlaceholderCouponCode(c?.coupon || c?.code || c?.coupon_code))
}

/** 任一占位券码即触发（对齐 mt-qrcode-web） */
function isAllPlaceholderCoupons(couponsInfoList) {
  if (!Array.isArray(couponsInfoList) || couponsInfoList.length === 0) {
    return false
  }
  return couponsInfoList.some((c) => isPlaceholderCouponCode(c?.coupon || c?.code || c?.coupon_code))
}

function isProbablyGiftIdEncrypt(value) {
  const text = String(value || '').trim()
  if (!text) return false
  return /[+/=]/.test(text) || text.startsWith('AwQ')
}

function isPlainGiftId(value) {
  const text = String(value || '').trim()
  if (!text || isProbablyGiftIdEncrypt(text)) return false
  return /^[a-zA-Z]/.test(text) || text.length > 20
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

function extractGiftIdFromRedirectUrl(redirectUrl) {
  const text = String(redirectUrl || '').trim()
  if (!text) return ''

  try {
    const url = new URL(text, 'https://awp.meituan.com')
    const giftId = url.searchParams.get('giftId')
    if (giftId) return giftId
  } catch (_) {}

  const match = text.match(/[?&]giftId=([^&#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

function extractGiftIdFromGiftReceiveResponse(res) {
  const nodeDataMap = res?.data?.nodeDataMap || {}

  const directProps = nodeDataMap.MeishiGiftReceiptBox?.p || nodeDataMap.MeishiGiftReceiptBox?.props
  const directGiftId = extractGiftIdFromRedirectUrl(directProps?.redirectUrl)
  if (directGiftId) return directGiftId

  const stack = [res]
  const seen = new Set()
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)

    if (typeof node.redirectUrl === 'string') {
      const giftId = extractGiftIdFromRedirectUrl(node.redirectUrl)
      if (giftId) return giftId
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        stack.push(value)
      }
    }
  }

  return ''
}

/**
 * 从响应中提取店铺位置信息 (lat/lng)
 * 兼容 node.props / node.p（对齐 mt-qrcode-web）
 */
function extractShopLocation(res) {
  try {
    const ndm = res?.data?.nodeDataMap || {}

    const notice = getNodePayload(ndm.OrderDetailNoticeModule1)?.shopInfo
    if (notice?.lat && notice?.lng) {
      debugLog(`[Backend API] 从OrderDetailNoticeModule1.shopInfo中提取到店铺位置: lat=${notice.lat}, lng=${notice.lng}`)
      return { lat: String(notice.lat), lng: String(notice.lng) }
    }

    const poi = getNodePayload(ndm.OrderDetailPoi1)?.shopInfo
    if (poi?.lat && poi?.lng) {
      debugLog(`[Backend API] 从OrderDetailPoi1.shopInfo中提取到店铺位置: lat=${poi.lat}, lng=${poi.lng}`)
      return { lat: String(poi.lat), lng: String(poi.lng) }
    }

    const navBar = getNodePayload(ndm.OrderDetailNavBar1)
    const shop = navBar?.shopInfo
    if (shop?.lat && shop?.lng) {
      debugLog(`[Backend API] 从OrderDetailNavBar1.shopInfo中提取到店铺位置: lat=${shop.lat}, lng=${shop.lng}`)
      return { lat: String(shop.lat), lng: String(shop.lng) }
    }

    const extra = navBar?.bizParams?.extra || {}
    const lat = extra.lat || extra.poiLat
    const lng = extra.lng || extra.poiLng
    if (lat && lng) {
      debugLog(`[Backend API] 从bizParams中提取到店铺位置: lat=${lat}, lng=${lng}`)
      return { lat: String(lat), lng: String(lng) }
    }
  } catch (e) {
    console.error('[Backend API] 提取店铺位置失败:', e.message)
  }
  return null
}

function buildCommonParams({ token, uuid, finger, userId, openId, unionId, cityId, latitude, longitude, platform }) {
  const cfg = getPlatformConfig(platform)
  return {
    location: buildLocationObject(longitude, latitude),
    userInfo: {
      userId: userId || '',
      token,
      uuid,
      openId: openId || '',
      wxUnionId: unionId || '',
      uuidV2: openId || ''
    },
    cityInfo: {
      cityId: cityId || GIFT_REQUEST_PROFILE.cityId,
      locCityId: cityId || GIFT_REQUEST_PROFILE.cityId
    },
    fingerprint: {
      fingerprint: finger
    },
    systemInfo: {
      version: '',
      systemVersion: '',
      device: '',
      platform: cfg.systemPlatform,
      IS_MT: true,
      IS_DP: false,
      IS_TICKET: false,
      IS_HOTEL: false,
      isMRN: false,
      isWeb: true,
      isWeChatMiniProgram: false,
      mpAppId: 'wxde8ac0a21135c07d',
      mpAppVersion: GIFT_REQUEST_PROFILE.appVersion,
      envInWeb: {
        isWebInApp: false,
        isWebInMtApp: false,
        isWebInDpApp: false,
        isWebInWeChatMiniProgram: true,
        isWebInTicketWeChatMiniProgram: false,
        isWebInMtWeChatMiniProgram: true,
        isWebInDpWeChatMiniProgram: false,
        isWebInHotelWeChatMiniProgram: false,
        isWebInToutiaoMiniProgram: false,
        isWebInKSMiniProgram: false,
        isWebInBaiduMiniProgram: false,
        isWebInDpBaiduMiniProgram: false,
        isWebInMtBaiduMiniProgram: false,
        isWebInHarmonyMSCMiniProgram: false
      },
      isDebug: false,
      userAgent: cfg.userAgent
    },
    storage: {},
    isPreview: true,
    isUpdate: false,
    isSubmit: false,
    isCheck: false
  }
}

async function resolveGiftIdFromReceivePreview({ token, giftIdEncrypt, orderId, options, uuid, finger, headers }) {
  if (!giftIdEncrypt) return ''

  const latitude = options.latitude || options.lat || ''
  const longitude = options.longitude || options.lng || ''
  const cityId = String(options.cityId || GIFT_REQUEST_PROFILE.cityId)
  const baseUrl = `https://apimobile.meituan.com/foodtrade/gift/receive/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.2.0`
  const commonParams = buildCommonParams({
    token,
    uuid,
    finger,
    userId: options.userId,
    openId: options.openId,
    unionId: options.unionId,
    cityId,
    latitude,
    longitude,
    platform: options.platform
  })

  const payload = {
    pageQuery: {
      giftIdEncrypt,
      orderId: orderId || '',
      presentPath: options.presentPath || 'wechat',
      uuid,
      utm_content: options.utm_content || '0',
      utm_campaign: options.utm_campaign || '0',
      mina_name: 'mt-weapp',
      finger,
      token,
      lat: String(latitude),
      lng: String(longitude),
      loc_type: 'WX',
      cityId,
      cityid: cityId,
      ci: cityId,
      rcf_token: options.rcf_token || GIFT_REQUEST_PROFILE.rcfToken,
      rcf_uniqueid: options.rcf_uniqueid || GIFT_REQUEST_PROFILE.rcfUniqueId,
      __lxsdk_params: options.lxsdkParams || options.__lxsdk_params || '',
      _lx_ver: '3.17.5'
    },
    commonParams,
    prevData: {},
    nodeDataMap: {},
    updatePropMap: {},
    payload: {},
    cacheDynamicComponent: { protocolVersion: '0001' },
    pageId: '12431',
    pageProtocolId: '0013',
    minifyHttpResponse: '1'
  }

  const signedUrl = getSignedUrl({ method: 'POST', url: baseUrl, body: payload, cookies: DEFAULT_COOKIES })
  const response = await axiosClient.post(signedUrl, payload, { headers })
  const giftId = extractGiftIdFromGiftReceiveResponse(response.data)
  debugLog(`[Backend API] gift receive preview resolved giftId: ${giftId || '-'}`)
  return giftId
}

/**
 * 获取订单券码信息（普通单走轻量 payload，礼物单走专用逻辑；对齐 mt-qrcode-web）
 */
async function getCouponList(token, orderId, options = {}) {
  options = resolveAccountRequestOptions(options)
  const orderIdStr = String(orderId)
  const giftIdEncrypt = firstNonEmpty(
    options.giftIdEncrypt,
    options.gift_id_encrypt,
    options.giftIdEnc,
    isProbablyGiftIdEncrypt(orderIdStr) ? orderIdStr : ''
  )
  const resolvedGiftId = firstNonEmpty(options.giftId, options.gift_id, options.plainGiftId)
  const isGift = Boolean(resolvedGiftId) || isPlainGiftId(orderIdStr) || Boolean(giftIdEncrypt)

  const platform = options.platform || DEFAULT_PLATFORM
  if (!options.platform) options.platform = platform

  if (isGift) {
    return await getGiftCouponList(token, resolvedGiftId || orderIdStr, {
      ...options,
      giftIdEncrypt,
      platform,
    })
  }

  return await getNormalCouponList(token, orderIdStr, options)
}

/**
 * 普通订单查券（轻量 payload，与 mt-qrcode-web / Electron 对齐）
 */
async function getNormalCouponList(token, orderIdStr, options = {}) {
  const { longitude, latitude } = options
  const platform = options.platform || DEFAULT_PLATFORM
  const cfg = getPlatformConfig(platform)
  const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/detail/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.0.2`

  const locationObj = buildLocationObject(longitude, latitude)

  const payload = {
    pageQuery: {
      cityId: '795',
      lat: latitude,
      lng: longitude,
      locCityId: '795',
      orderId: orderIdStr,
      programName: 'mt',
      mina_name: 'mt-weapp',
      token,
      userId: options.userId || '',
      openId: options.openId,
      unionId: options.unionId,
      uuid: options.uuid,
      finger: options.finger,
      utmMedium: 'WEIXINPROGRAM',
      appVersion: '9.27.2',
      envPlatform: 'wx',
      platform: cfg.platform,
      uniPlatform: cfg.uniPlatform,
      utmTerm: '0',
      utmCampaign: '0',
      app_version: '9.27.2',
      scene: '1256',
      _lx_ver: '3.17.5',
    },
    commonParams: {
      location: locationObj,
      userInfo: {
        userId: options.userId || '',
        token,
        uuid: options.uuid,
        openId: options.openId,
        wxUnionId: options.unionId,
        uuidV2: options.openId,
      },
      cityInfo: { cityId: '795', locCityId: '795' },
      fingerprint: { fingerprint: options.finger },
      systemInfo: {
        version: '',
        systemVersion: '',
        device: '',
        platform: cfg.systemPlatform,
        IS_MT: true,
        IS_DP: false,
        IS_TICKET: false,
        isMRN: false,
        isWeb: true,
        isWeChatMiniProgram: false,
        mpAppId: 'wxde8ac0a21135c07d',
        mpAppVersion: '9.27.2',
        envInWeb: {
          isWebInApp: false,
          isWebInMtApp: false,
          isWebInDpApp: false,
          isWebInWeChatMiniProgram: true,
          isWebInTicketWeChatMiniProgram: false,
          isWebInMtWeChatMiniProgram: true,
          isWebInDpWeChatMiniProgram: false,
          isWebInHotelWeChatMiniProgram: false,
          isWebInToutiaoMiniProgram: false,
          isWebInKSMiniProgram: false,
          isWebInBaiduMiniProgram: false,
          isWebInDpBaiduMiniProgram: false,
          isWebInMtBaiduMiniProgram: false,
          isWebInHarmonyMSCMiniProgram: false,
        },
        isDebug: false,
        userAgent: cfg.userAgent,
      },
      storage: { deliveryAddrCacheJson: '' },
      isPreview: true,
      isUpdate: false,
      isSubmit: false,
    },
    prevData: {},
    nodeDataMap: {},
    updatePropMap: {},
    payload: {},
    cacheDynamicComponent: { protocolVersion: '0001' },
    pageId: '12299',
    pageProtocolId: '0192',
  }

  // 普通单不带 Cookie Header（与 mt-qrcode-web 一致；DEFAULT_COOKIES 仅用于签名）
  const headers = {
    Host: 'apimobile.meituan.com',
    Connection: 'keep-alive',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': cfg.userAgent,
    Origin: 'https://awp.meituan.com',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Referer: 'https://awp.meituan.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Content-Type': 'application/json',
  }

  const maxRetries = 3
  let lastError = null

  debugLog(
    `[Backend API] getNormalCouponList orderId=${orderIdStr}, platform=${platform}, UA=${(cfg.userAgent || '').substring(0, 60)}...`
  )

  try {
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const signedUrl = getSignedUrl({ method: 'POST', url: baseUrl, body: payload, cookies: DEFAULT_COOKIES })
        debugLog(`[Backend API] 普通单请求 orderId=${orderIdStr}, retry=${retry + 1}/${maxRetries}`)

        const response = await axiosClient.post(signedUrl, payload, { headers })
        debugLog(`[Backend API] Response status: ${response.status}`)
        debugLog(`\n====== 美团接口原始响应 ======`)
        debugLog(JSON.stringify(response.data, null, 2))
        debugLog(`=============================\n`)

        const yodaResult = createYodaWindControlResult(response.data)
        if (yodaResult) return yodaResult

        if (isWindControlResponse(response.data)) {
          lastError = new Error('WIND_CONTROL')
          reinitOnWindControl()
          if (retry < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, 1000 * (retry + 1)))
            continue
          }
          return { success: false, error: 'WIND_CONTROL', isWindControl: true, coupons: [] }
        }

        const coupons = parseCouponResponse(response.data, '')
        const extractedShopLocation = extractShopLocation(response.data)

        if (isAllPlaceholderCoupons(coupons) && !options._shopLocationRetried) {
          if (extractedShopLocation?.lat && extractedShopLocation?.lng) {
            debugLog(`[Backend API] 占位券码，店铺位置重查: lat=${extractedShopLocation.lat}, lng=${extractedShopLocation.lng}`)
            await new Promise((r) => setTimeout(r, 300))

            const shopResult = await getNormalCouponList(token, orderIdStr, {
              ...options,
              longitude: extractedShopLocation.lng,
              latitude: extractedShopLocation.lat,
              _shopLocationRetried: true,
            })
            if (shopResult.success && shopResult.coupons.length > 0 && !isAllPlaceholderCoupons(shopResult.coupons)) {
              return shopResult
            }

            const lngNum = parseFloat(extractedShopLocation.lng)
            const latNum = parseFloat(extractedShopLocation.lat)
            if (Number.isFinite(lngNum) && Number.isFinite(latNum)) {
              const tweakedLongitude = (lngNum + 0.00001).toFixed(6)
              const tweakedLatitude = (latNum + 0.00001).toFixed(6)
              debugLog(`[Backend API] 坐标微调重查: lat=${tweakedLatitude}, lng=${tweakedLongitude}`)
              await new Promise((r) => setTimeout(r, 200))
              const tweakedResult = await getNormalCouponList(token, orderIdStr, {
                ...options,
                longitude: tweakedLongitude,
                latitude: tweakedLatitude,
                _shopLocationRetried: true,
              })
              if (tweakedResult.success && tweakedResult.coupons.length > 0 && !isAllPlaceholderCoupons(tweakedResult.coupons)) {
                return tweakedResult
              }
            }
          } else {
            debugLog('[Backend API] 占位券码但未提取到店铺经纬度')
          }

          // 与对照项目一致：全部占位则不返回占位码
          return { success: true, coupons: [], giftId: '', shopLocation: extractedShopLocation }
        }

        if (isAllPlaceholderCoupons(coupons)) {
          return { success: true, coupons: [], giftId: '', shopLocation: extractedShopLocation }
        }

        if (coupons.length === 0 && retry < maxRetries - 1) {
          lastError = new Error('NO_COUPON_DATA')
          reinitOnWindControl()
          await new Promise((r) => setTimeout(r, 1000 * (retry + 1)))
          continue
        }

        return {
          success: true,
          coupons: stripPlaceholderCoupons(coupons),
          giftId: '',
          shopLocation: extractedShopLocation,
        }
      } catch (error) {
        const yodaResult = createYodaWindControlResult(error)
        if (yodaResult) return yodaResult

        lastError = error
        if (error.response?.status === 403 || error.response?.status === 418) {
          lastError = new Error('WIND_CONTROL')
          reinitOnWindControl()
        }
        if (retry < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (retry + 1)))
          continue
        }
      }
    }

    const isWindControl = lastError && ['WIND_CONTROL', 'NO_COUPON_DATA'].includes(lastError.message)
    return {
      success: false,
      error: lastError?.message || 'UNKNOWN',
      isWindControl: Boolean(isWindControl),
      coupons: [],
    }
  } catch (error) {
    console.error('[Backend API] Error:', error.message)
    const yodaResult = createYodaWindControlResult(error)
    if (yodaResult) return yodaResult

    const isWindControl = error.response?.status === 418
      || error.response?.status === 403
      || String(error.message).includes('418')
      || String(error.message).includes('WIND_CONTROL')
    return { success: false, error: error.message, isWindControl, coupons: [] }
  }
}

/**
 * 礼物订单查券（保留完整字段）
 */
async function getGiftCouponList(token, giftId, options = {}) {
  options = resolveAccountRequestOptions(options)
  const giftIdInput = String(giftId || '')
  const giftIdEncrypt = firstNonEmpty(
    options.giftIdEncrypt,
    options.gift_id_encrypt,
    options.giftIdEnc,
    isProbablyGiftIdEncrypt(giftIdInput) ? giftIdInput : ''
  )
  let resolvedGiftId = firstNonEmpty(
    options.giftId,
    options.gift_id,
    options.plainGiftId,
    isProbablyGiftIdEncrypt(giftIdInput) ? '' : giftIdInput
  )

  const platform = options.platform || DEFAULT_PLATFORM
  const cfg = getPlatformConfig(platform)
  const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/detail/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.0.2`

  const uuid = options.uuid
  const finger = options.finger
  const openId = options.openId

  debugLog(
    `[Backend API] getGiftCouponList giftId=${resolvedGiftId || giftIdInput}, platform=${platform}`
  )

  const payload = {
    pageQuery: {
      cityId: options.cityId || GIFT_REQUEST_PROFILE.cityId,
      locCityId: options.cityId || GIFT_REQUEST_PROFILE.cityId,
      lat: options.latitude,
      lng: options.longitude,
      finger,
      giftId: resolvedGiftId || undefined,
      rcf_uniqueid: options.rcf_uniqueid || GIFT_REQUEST_PROFILE.rcfUniqueId,
      rcf_token: options.rcf_token || GIFT_REQUEST_PROFILE.rcfToken,
      programName: 'mt',
      mina_name: 'mt-weapp',
      openId,
      token,
      userId: options.userId || '',
      uuid,
      utmMedium: 'WEIXINPROGRAM',
      appVersion: GIFT_REQUEST_PROFILE.appVersion,
      envPlatform: 'wx',
      platform: cfg.platform,
      uniPlatform: cfg.uniPlatform,
      expoId: options.expoId || '',
      utmTerm: '0',
      utmCampaign: '0',
      unionId: options.unionId || '',
      app_version: GIFT_REQUEST_PROFILE.appVersion,
      scene: '1256',
      __lxsdk_params: options.lxsdkParams || '',
      _lx_tag: options.lxTag || '',
      _lx_ver: '3.17.5',
    },
    commonParams: buildCommonParams({
      token,
      uuid,
      finger,
      userId: options.userId,
      openId,
      unionId: options.unionId,
      cityId: options.cityId || GIFT_REQUEST_PROFILE.cityId,
      latitude: options.latitude,
      longitude: options.longitude,
      platform,
    }),
    prevData: {},
    nodeDataMap: {},
    updatePropMap: {},
    payload: {},
    cacheDynamicComponent: { protocolVersion: '0001' },
    pageId: '12299',
    pageProtocolId: '0346',
    minifyHttpResponse: '1',
  }
  payload.commonParams.storage = { deliveryAddrCacheJson: '' }

  const headers = {
    Host: 'apimobile.meituan.com',
    Connection: 'keep-alive',
    'User-Agent': cfg.userAgent,
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://awp.meituan.com',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Referer: 'https://awp.meituan.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Content-Type': 'application/json',
  }
  applyAccountCredentialHeaders(headers, options)
  applyAccountCredentialHeaders(headers, options)

  try {
    if (!resolvedGiftId && giftIdEncrypt) {
      const receiveOrderId = firstNonEmpty(options.orderId, options.order_id, options.orderViewId, options.order_view_id)
      resolvedGiftId = await resolveGiftIdFromReceivePreview({
        token,
        giftIdEncrypt,
        orderId: receiveOrderId,
        options,
        uuid,
        finger,
        headers,
      })
      if (resolvedGiftId) {
        payload.pageQuery.giftId = resolvedGiftId
        payload.pageQuery.giftIdEncrypt = giftIdEncrypt
      }
    }

    if (!payload.pageQuery.giftId) {
      return { success: false, error: '无法解析 giftId', coupons: [] }
    }

    const maxRetries = 3
    let lastError = null

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const signedUrl = getSignedUrl({ method: 'POST', url: baseUrl, body: payload, cookies: DEFAULT_COOKIES })
        debugLog(`[Backend API] 礼物单请求 giftId=${payload.pageQuery.giftId}, retry=${retry + 1}/${maxRetries}`)

        const response = await axiosClient.post(signedUrl, payload, { headers })
        debugLog(`\n====== 美团礼物接口原始响应 ======`)
        debugLog(JSON.stringify(response.data, null, 2))
        debugLog(`=============================\n`)

        const yodaResult = createYodaWindControlResult(response.data)
        if (yodaResult) return yodaResult

        if (isWindControlResponse(response.data)) {
          lastError = new Error('WIND_CONTROL')
          reinitOnWindControl()
          if (retry < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, 1000 * (retry + 1)))
            continue
          }
          return { success: false, error: 'WIND_CONTROL', isWindControl: true, coupons: [] }
        }

        const coupons = parseCouponResponse(response.data, resolvedGiftId || payload.pageQuery.giftId || '')
        const extractedShopLocation = extractShopLocation(response.data)
        const giftIdForRetry = resolvedGiftId || payload.pageQuery.giftId || ''

        if (isAllPlaceholderCoupons(coupons) && !options._shopLocationRetried) {
          debugLog('[Backend API] 礼物占位券码，尝试店铺位置重查')

          if (extractedShopLocation?.lat && extractedShopLocation?.lng && giftIdForRetry) {
            debugLog(`[Backend API] 礼物占位券码，店铺位置重查: lat=${extractedShopLocation.lat}, lng=${extractedShopLocation.lng}`)
            await new Promise((r) => setTimeout(r, 300))
            const shopResult = await getGiftCouponList(token, giftIdForRetry, {
              ...options,
              giftId: giftIdForRetry,
              longitude: extractedShopLocation.lng,
              latitude: extractedShopLocation.lat,
              _shopLocationRetried: true,
            })
            if (shopResult.success && shopResult.coupons.length > 0 && !isAllPlaceholderCoupons(shopResult.coupons)) {
              return { ...shopResult, shopLocation: extractedShopLocation }
            }

            const lngNum = parseFloat(extractedShopLocation.lng)
            const latNum = parseFloat(extractedShopLocation.lat)
            if (Number.isFinite(lngNum) && Number.isFinite(latNum)) {
              const tweakedLongitude = (lngNum + 0.00001).toFixed(6)
              const tweakedLatitude = (latNum + 0.00001).toFixed(6)
              debugLog(`[Backend API] 礼物坐标微调重查: lat=${tweakedLatitude}, lng=${tweakedLongitude}`)
              await new Promise((r) => setTimeout(r, 200))
              const tweakedResult = await getGiftCouponList(token, giftIdForRetry, {
                ...options,
                giftId: giftIdForRetry,
                longitude: tweakedLongitude,
                latitude: tweakedLatitude,
                _shopLocationRetried: true,
              })
              if (tweakedResult.success && tweakedResult.coupons.length > 0 && !isAllPlaceholderCoupons(tweakedResult.coupons)) {
                return { ...tweakedResult, shopLocation: extractedShopLocation }
              }
            }
          } else {
            debugLog('[Backend API] 礼物占位券码但未提取到店铺经纬度')
          }

          return {
            success: true,
            coupons: [],
            giftId: giftIdForRetry,
            shopLocation: extractedShopLocation,
          }
        }

        if (isAllPlaceholderCoupons(coupons)) {
          return {
            success: true,
            coupons: [],
            giftId: giftIdForRetry,
            shopLocation: extractedShopLocation,
          }
        }

        if (coupons.length === 0 && retry < maxRetries - 1) {
          lastError = new Error('NO_COUPON_DATA')
          reinitOnWindControl()
          await new Promise((r) => setTimeout(r, 1000 * (retry + 1)))
          continue
        }

        return {
          success: true,
          coupons: stripPlaceholderCoupons(coupons),
          giftId: giftIdForRetry,
          shopLocation: extractedShopLocation,
        }
      } catch (error) {
        const yodaResult = createYodaWindControlResult(error)
        if (yodaResult) return yodaResult

        lastError = error
        if (error.response?.status === 403 || error.response?.status === 418) {
          lastError = new Error('WIND_CONTROL')
          reinitOnWindControl()
        }
        if (retry < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (retry + 1)))
          continue
        }
      }
    }

    const isWindControl = lastError && ['WIND_CONTROL', 'NO_COUPON_DATA'].includes(lastError.message)
    return {
      success: false,
      error: lastError?.message || 'UNKNOWN',
      isWindControl: Boolean(isWindControl),
      coupons: [],
    }
  } catch (error) {
    console.error('[Backend API] Gift Error:', error.message)
    const yodaResult = createYodaWindControlResult(error)
    if (yodaResult) return yodaResult

    const isWindControl = error.response?.status === 418
      || error.response?.status === 403
      || String(error.message).includes('418')
      || String(error.message).includes('WIND_CONTROL')
    return { success: false, error: error.message, isWindControl, coupons: [] }
  }
}

/**
 * 解析券码响应
 */
function parseCouponResponse(res, giftId = '') {
  const couponsInfoList = []

  try {
    const nodeDataMap = res?.data?.nodeDataMap || {}

    const getNodeProps = (nodeName) => {
      const node = nodeDataMap[nodeName]
      if (!node) return null
      return node.p || node.props || null
    }

    // 1. 解析核销记录
    const verifyMap = {}
    try {
      const verifyModule = getNodeProps('FoodOrderDetailVerifyRecord1')
      const verifyRecords = verifyModule?.verifyRecords || []

      for (const record of verifyRecords) {
        const verifyTime = record.verifyTime ? new Date(record.verifyTime * 1000).toLocaleString('zh-CN') : ''
        const poiName = record.poiName || ''
        const verifyStatusText = record.verifyStatusText || ''

        for (const couponCode of (record.verifyCoupons || [])) {
          const cleanCode = couponCode.replace('优惠码:', '')
          verifyMap[cleanCode] = {
            verifyTime,
            verifyPoiName: poiName,
            verifyStatusText
          }
        }
      }
    } catch (e) {
      console.error('[Parse] verifyRecords error:', e.message)
    }

    // 2. 解析券码
    try {
      const couponModule = getNodeProps('CouponModule1')
      const coupons = couponModule?.coupons || []

      for (const coupon of coupons) {
        const couponCode = (coupon.code || '').replace('优惠码:', '')
        const verifyInfo = verifyMap[couponCode]

        let statusText = ''
        let verifyTime = ''
        let verifyPoiName = ''

        if (verifyInfo) {
          statusText = verifyInfo.verifyStatusText || '已使用'
          verifyTime = verifyInfo.verifyTime
          verifyPoiName = verifyInfo.verifyPoiName
        } else {
          statusText = coupon.statusText || (coupon.useStatus === 1 ? '待使用' : coupon.useStatus === 3 ? '已使用' : '')
        }

        couponsInfoList.push({
          coupon: couponCode,
          encode: coupon.encode || '',
          couponId: coupon.id || '',
          giftId: giftId || coupon.giftId || coupon.gift_id || '',
          gift_id: giftId || coupon.giftId || coupon.gift_id || '',
          order_status: statusText,
          useStatus: coupon.useStatus,
          verifyTime: verifyTime,
          verifyPoiName: verifyPoiName
        })
      }
    } catch (e) {
      console.error('[Parse] CouponModule1 error:', e.message)
    }
  } catch (e) {
    console.error('[Parse] Response error:', e.message)
  }

  return couponsInfoList
}

// 主入口
async function handleAction(action, params) {
  switch (action) {
    case 'getCouponList':
      return await getCouponList(params.token, params.orderId, params.options || {})
    default:
      return { success: false, error: `Unknown action: ${action}` }
  }
}

async function runWorker() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  })

  for await (const line of rl) {
    const trimmed = String(line || '').trim()
    if (!trimmed) {
      continue
    }

    let response
    try {
      const request = JSON.parse(trimmed)
      const result = await handleAction(request.action, request.params || {})
      response = {
        request_id: request.request_id ?? null,
        result
      }
    } catch (error) {
      response = {
        request_id: null,
        result: { success: false, error: error.message }
      }
    }

    process.stdout.write(`${JSON.stringify(response)}\n`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const action = args[0]

  if (action === 'serve') {
    await runWorker()
    return
  }

  if (args.length < 2) {
    console.log(JSON.stringify({ success: false, error: 'Usage: node meituanBackendApi.cjs <action> <args_json>' }))
    process.exit(1)
  }

  const params = JSON.parse(args[1])

  try {
    const result = await handleAction(action, params)
    console.log(JSON.stringify(result))
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }))
  }
}

main()
