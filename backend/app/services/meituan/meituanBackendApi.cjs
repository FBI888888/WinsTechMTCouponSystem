/**
 * 后端美团API服务 - 供Python通过subprocess调用
 * 用法: node meituanBackendApi.cjs <action> <args_json>
 */

const axios = require('axios')
const http = require('http')
const https = require('https')
const readline = require('readline')
const { sign: signRequest, reinit: reinitSigner } = require('./mtgsig_standalone')

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

// Backend-local mtgsig standalone signer
function getSignedUrl(url, data, method = 'POST') {
  try {
    const { signedUrl } = signRequest({
      method,
      url,
      body: data,
      fresh: false,
      maxReuse: 100,
    })
    return signedUrl || url
  } catch (e) {
    console.error('Sign failed:', e.message)
    try {
      reinitSigner()
    } catch (_) {}
    return url
  }
}

function isAllPlaceholderCoupons(couponsInfoList) {
  if (!Array.isArray(couponsInfoList) || couponsInfoList.length === 0) {
    return false
  }
  return couponsInfoList.every(c => {
    const code = String(c?.coupon || '').replace(/\s/g, '')
    return code === '000000000000'
  })
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
 * 用于券码为000000000000时的自动重试
 */
function extractShopLocation(res) {
  try {
    const nodeDataMap = res?.data?.nodeDataMap || {}

    // 尝试从 OrderDetailNoticeModule1.props.shopInfo 获取
    let shopInfo = nodeDataMap.OrderDetailNoticeModule1?.props?.shopInfo
    if (shopInfo?.lat && shopInfo?.lng) {
      debugLog(`[Backend API] 从OrderDetailNoticeModule1.shopInfo中提取到店铺位置: lat=${shopInfo.lat}, lng=${shopInfo.lng}`)
      return { lat: String(shopInfo.lat), lng: String(shopInfo.lng) }
    }

    // 尝试从 OrderDetailPoi1.props.shopInfo 获取
    shopInfo = nodeDataMap.OrderDetailPoi1?.props?.shopInfo
    if (shopInfo?.lat && shopInfo?.lng) {
      debugLog(`[Backend API] 从OrderDetailPoi1.shopInfo中提取到店铺位置: lat=${shopInfo.lat}, lng=${shopInfo.lng}`)
      return { lat: String(shopInfo.lat), lng: String(shopInfo.lng) }
    }

    // 尝试从 OrderDetailNavBar1.props.shopInfo 获取 (兼容旧版本)
    shopInfo = nodeDataMap.OrderDetailNavBar1?.props?.shopInfo
    if (shopInfo?.lat && shopInfo?.lng) {
      debugLog(`[Backend API] 从OrderDetailNavBar1.shopInfo中提取到店铺位置: lat=${shopInfo.lat}, lng=${shopInfo.lng}`)
      return { lat: String(shopInfo.lat), lng: String(shopInfo.lng) }
    }

    // 尝试从 bizParams.extra 中获取
    const bizParams = nodeDataMap.OrderDetailNavBar1?.props?.bizParams?.extra || {}
    const poiLat = bizParams.lat || bizParams.poiLat
    const poiLng = bizParams.lng || bizParams.poiLng
    if (poiLat && poiLng) {
      debugLog(`[Backend API] 从bizParams中提取到店铺位置: lat=${poiLat}, lng=${poiLng}`)
      return { lat: String(poiLat), lng: String(poiLng) }
    }
  } catch (e) {
    console.error('[Backend API] 提取店铺位置失败:', e.message)
  }
  return null
}

function buildCommonParams({ token, uuid, finger, userId, openId, unionId, cityId, latitude, longitude, userAgent }) {
  return {
    location: {
      lat: parseFloat(latitude) || 41.748709,
      lng: parseFloat(longitude) || 86.159215,
      accuracy: 0
    },
    userInfo: {
      userId: userId || '',
      token,
      uuid,
      openId: openId || '',
      wxUnionId: unionId || '',
      uuidV2: openId || ''
    },
    cityInfo: {
      cityId: cityId || '603',
      locCityId: cityId || '603'
    },
    fingerprint: {
      fingerprint: finger
    },
    systemInfo: {
      version: '',
      systemVersion: '',
      device: '',
      platform: 'android',
      IS_MT: true,
      IS_DP: false,
      IS_TICKET: false,
      IS_HOTEL: false,
      isMRN: false,
      isWeb: true,
      isWeChatMiniProgram: false,
      mpAppId: 'wxde8ac0a21135c07d',
      mpAppVersion: '10.12.1',
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
      userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d'
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

  const latitude = options.latitude || options.lat || '41.748709'
  const longitude = options.longitude || options.lng || '86.159215'
  const cityId = String(options.cityId || '603')
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
    userAgent: options.userAgent
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
      rcf_token: options.rcf_token || '5cac67121c9d446c8c2d7b93',
      rcf_uniqueid: options.rcf_uniqueid || `rcf-default-${Date.now()}`,
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

  const payloadStr = JSON.stringify(payload)
  const signedUrl = getSignedUrl(baseUrl, payloadStr, 'POST')
  const response = await axiosClient.post(signedUrl, payload, { headers })
  const giftId = extractGiftIdFromGiftReceiveResponse(response.data)
  debugLog(`[Backend API] gift receive preview resolved giftId: ${giftId || '-'}`)
  return giftId
}

/**
 * 获取订单券码信息
 */
async function getCouponList(token, orderId, options = {}) {
  const orderIdStr = String(orderId)
  const giftIdEncrypt = firstNonEmpty(
    options.giftIdEncrypt,
    options.gift_id_encrypt,
    options.giftIdEnc,
    isProbablyGiftIdEncrypt(orderIdStr) ? orderIdStr : ''
  )
  let resolvedGiftId = firstNonEmpty(options.giftId, options.gift_id, options.plainGiftId)
  let isGift = Boolean(resolvedGiftId) || isPlainGiftId(orderIdStr)

  const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/detail/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.2.0`

  // 生成随机 UUID
  const generateUuid = () => {
    const hex = () => Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0')
    return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`
  }
  const uuid = options.uuid || generateUuid()
  const finger = options.finger || `${Math.random().toString(36).substring(2, 15)}`

  const payload = {
    pageQuery: {
      cityId: options.cityId || "603",
      locCityId: options.cityId || "603",
      lat: options.latitude || "41.748709",
      lng: options.longitude || "86.159215",
      finger: finger,
      orderId: isGift ? undefined : orderIdStr,
      giftId: isGift ? (resolvedGiftId || orderIdStr) : undefined,
      rcf_uniqueid: `rcff1d5.60cb98145e36a.acc1d6caf-6c86.24fc73c32-4209.bb9bcae89-7db1.66a67ddd2-9315.cb595a134-default-${Date.now()}`,
      rcf_token: "5cac67121c9d446c8c2d7b93",
      programName: "mt",
      mina_name: "mt-weapp",
      openId: options.openId || "",
      token: token,
      userId: options.userId || "",
      uuid: uuid,
      utmMedium: "WEIXINPROGRAM",
      appVersion: "10.12.1",
      envPlatform: "wx",
      platform: "ANDROID",
      uniPlatform: "windows",
      expoId: options.expoId || "",
      utmTerm: "0",
      utmCampaign: "0",
      unionId: options.unionId || "",
      app_version: "10.12.1",
      scene: "1256",
      __lxsdk_params: options.lxsdkParams || "",
      _lx_tag: options.lxTag || "",
      _lx_ver: "3.17.5"
    },
    commonParams: {
      location: {
        lat: parseFloat(options.latitude) || 41.748709,
        lng: parseFloat(options.longitude) || 86.159215,
        accuracy: 0
      },
      userInfo: {
        userId: options.userId || "",
        token: token,
        uuid: uuid,
        openId: options.openId || "",
        wxUnionId: options.unionId || "",
        uuidV2: options.openId || ""
      },
      cityInfo: {
        cityId: options.cityId || "603",
        locCityId: options.cityId || "603"
      },
      fingerprint: {
        fingerprint: finger
      },
      systemInfo: {
        version: "",
        systemVersion: "",
        device: "",
        platform: "android",
        IS_MT: true,
        IS_DP: false,
        IS_TICKET: false,
        IS_HOTEL: false,
        isMRN: false,
        isWeb: true,
        isWeChatMiniProgram: false,
        mpAppId: "wxde8ac0a21135c07d",
        mpAppVersion: "10.12.1",
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
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d'
      },
      storage: {},
      isPreview: true,
      isUpdate: false,
      isSubmit: false,
      isCheck: false
    },
    prevData: {},
    nodeDataMap: {},
    updatePropMap: {},
    payload: {},
    cacheDynamicComponent: { protocolVersion: "0001" },
    pageId: "12299",
    pageProtocolId: "0340",
    minifyHttpResponse: "1"
  }

  const headers = {
    'Host': 'apimobile.meituan.com',
    'Connection': 'keep-alive',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://awp.meituan.com',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Referer': 'https://awp.meituan.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie': options.cookie || `WEBDFPID=${Date.now()}KQUUAEQfd79fef3d01d5e9aadc18ccd4d0c95074632-${Date.now()}-${Date.now()}KQUUAEQfd79fef3d01d5e9aadc18ccd4d0c95074632; _lxsdk_cuid=${uuid}; _lxsdk=${uuid}`,
    'Content-Type': 'application/json'
  }

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
        headers
      })
      if (resolvedGiftId) {
        isGift = true
        delete payload.pageQuery.orderId
        payload.pageQuery.giftId = resolvedGiftId
        payload.pageQuery.giftIdEncrypt = giftIdEncrypt
      }
    }

    const payloadStr = JSON.stringify(payload)
    const signedUrl = getSignedUrl(baseUrl, payloadStr, 'POST')

    debugLog(`[Backend API] Querying order: ${orderIdStr}, isGift: ${isGift}, giftId: ${resolvedGiftId || '-'}`)

    const response = await axiosClient.post(signedUrl, payload, { headers })

    debugLog(`[Backend API] Response status: ${response.status}`)
    debugLog(`[Backend API] Response data keys: ${Object.keys(response.data || {})}`)
    debugLog(`[Backend API] nodeDataMap keys: ${Object.keys(response.data?.data?.nodeDataMap || {}).join(', ')}`)
    debugLog(`\n====== 美团接口原始响应 ======`)
    debugLog(JSON.stringify(response.data, null, 2))
    debugLog(`=============================\n`)

    // 解析响应
    const coupons = parseCouponResponse(response.data, resolvedGiftId || payload.pageQuery.giftId || '')

    // 检查是否全部为占位券码 (000000000000)，如果是则尝试使用店铺位置重新查询
    if (isAllPlaceholderCoupons(coupons) && !options._shopLocationRetried) {
      debugLog('[Backend API] 检测到全部券码为000000000000，尝试提取店铺位置重新查询...')

      const extractedShopLocation = extractShopLocation(response.data)

      if (extractedShopLocation && extractedShopLocation.lat && extractedShopLocation.lng) {
        debugLog(`[Backend API] 使用店铺位置重新查询: lat=${extractedShopLocation.lat}, lng=${extractedShopLocation.lng}`)

        // 等待300ms后重试
        await new Promise(r => setTimeout(r, 300))

        // 使用店铺位置重新构建payload
        const retryPayload = JSON.parse(JSON.stringify(payload))
        retryPayload.pageQuery.lat = extractedShopLocation.lat
        retryPayload.pageQuery.lng = extractedShopLocation.lng
        retryPayload.pageQuery.latitude = extractedShopLocation.lat
        retryPayload.pageQuery.longitude = extractedShopLocation.lng
        retryPayload.commonParams.location.lat = parseFloat(extractedShopLocation.lat)
        retryPayload.commonParams.location.lng = parseFloat(extractedShopLocation.lng)

        const retryPayloadStr = JSON.stringify(retryPayload)
        const retrySignedUrl = getSignedUrl(baseUrl, retryPayloadStr, 'POST')

        debugLog(`[Backend API] 重新查询订单: ${orderIdStr}`)

        const retryResponse = await axiosClient.post(retrySignedUrl, retryPayload, { headers })

        debugLog(`[Backend API] 重试响应状态: ${retryResponse.status}`)
        debugLog(`\n====== 美团接口重试响应 ======`)
        debugLog(JSON.stringify(retryResponse.data, null, 2))
        debugLog(`=============================\n`)

        const retryCoupons = parseCouponResponse(retryResponse.data, resolvedGiftId || retryPayload.pageQuery.giftId || '')

        // 如果重试后获取到有效券码，返回重试结果
        if (retryCoupons.length > 0 && !isAllPlaceholderCoupons(retryCoupons)) {
          debugLog('[Backend API] 使用店铺位置重新查询成功，获取到有效券码')
          return { success: true, coupons: retryCoupons, giftId: resolvedGiftId || retryPayload.pageQuery.giftId || '' }
        }
        debugLog('[Backend API] 使用店铺位置重新查询仍为占位券码，返回原始结果')
      } else {
        debugLog('[Backend API] 未能从响应中提取到店铺位置信息')
      }
    }

    return { success: true, coupons, giftId: resolvedGiftId || payload.pageQuery.giftId || '' }
  } catch (error) {
    console.error('[Backend API] Error:', error.message)
    const isWindControl = error.response?.status === 418 || String(error.message).includes('418')
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
