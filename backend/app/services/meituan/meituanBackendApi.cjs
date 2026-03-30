/**
 * 后端美团API服务 - 供Python通过subprocess调用
 * 用法: node meituanBackendApi.cjs <action> <args_json>
 */

const axios = require('axios')
const path = require('path')
const fs = require('fs')
const vm = require('vm')

// 加载 H5guard.js
let h5guardContext = null
let getVerifyFunc = null

function initH5guard() {
  if (getVerifyFunc) return true

  try {
    const jsPath = path.join(__dirname, 'H5guard.js')
    if (!fs.existsSync(jsPath)) {
      console.error('[H5guard] H5guard.js not found:', jsPath)
      return false
    }

    const jsCode = fs.readFileSync(jsPath, 'utf8')

    const locationObj = {
      href: "https://awp.meituan.com/h5/order/detail/index.html",
      origin: "https://awp.meituan.com",
      protocol: "https:",
      host: "awp.meituan.com",
      hostname: "awp.meituan.com",
      port: "",
      pathname: "/h5/order/detail/index.html",
      search: "",
      hash: ""
    }

    const documentObj = {
      cookie: '_lxsdk_cuid=test; _lxsdk=test',
      body: {},
      documentElement: {},
      getElementsByTagName: () => [],
      createElement: () => ({ appendChild: () => { } }),
      head: { appendChild: () => { } }
    }

    const navigatorObj = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      platform: 'Win32',
      language: 'zh-CN'
    }

    const sandbox = {
      window: null,
      self: null,
      top: null,
      global: null,
      globalThis: null,
      location: locationObj,
      document: documentObj,
      navigator: navigatorObj,
      screen: { width: 1440, height: 900 },
      localStorage: { getItem: () => null, setItem: () => { } },
      sessionStorage: { getItem: () => null, setItem: () => { } },
      setTimeout: setTimeout,
      setInterval: () => 0,
      clearTimeout: clearTimeout,
      clearInterval: () => { },
      console: console,
      Date: Date,
      Math: Math,
      JSON: JSON,
      Object: Object,
      Array: Array,
      String: String,
      Number: Number,
      Boolean: Boolean,
      RegExp: RegExp,
      Error: Error,
      Promise: Promise,
      Buffer: Buffer,
      Uint8Array: Uint8Array,
      Uint16Array: Uint16Array,
      Uint32Array: Uint32Array,
      Int8Array: Int8Array,
      Int16Array: Int16Array,
      Int32Array: Int32Array,
      Float32Array: Float32Array,
      Float64Array: Float64Array,
      ArrayBuffer: ArrayBuffer,
      DataView: DataView,
      TextEncoder: TextEncoder,
      TextDecoder: TextDecoder,
      URL: URL,
      URLSearchParams: URLSearchParams,
      btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
      atob: (str) => Buffer.from(str, 'base64').toString('binary'),
      parseInt: parseInt,
      parseFloat: parseFloat,
      isNaN: isNaN,
      isFinite: isFinite,
      encodeURIComponent: encodeURIComponent,
      decodeURIComponent: decodeURIComponent,
      encodeURI: encodeURI,
      decodeURI: decodeURI,
      escape: escape,
      unescape: unescape,
      performance: { now: () => Date.now() },
      crypto: {
        getRandomValues: (arr) => {
          for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
          return arr
        }
      },
      module: { exports: {} },
      exports: {},
      require: () => ({})
    }

    sandbox.window = sandbox
    sandbox.self = sandbox
    sandbox.top = sandbox
    sandbox.global = sandbox
    sandbox.globalThis = sandbox

    vm.createContext(sandbox)

    let modifiedCode = jsCode
      .replace(/^window\s*=\s*self\s*=\s*top\s*=\s*global\s*;?\s*/m, '')
      .replace(/^delete\s+global\s*;?\s*/m, '')

    vm.runInContext(modifiedCode, sandbox, { filename: 'H5guard.js', timeout: 10000 })

    getVerifyFunc = sandbox.module.exports.getVerify || sandbox.getVerify

    if (getVerifyFunc) {
      h5guardContext = sandbox
      return true
    }

    return false
  } catch (e) {
    console.error('Init H5guard failed:', e.message)
    return false
  }
}

function getSignedUrl(url, data) {
  if (!initH5guard() || !getVerifyFunc) {
    return url
  }

  try {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
    const result = getVerifyFunc(url, dataStr)
    return result?.url || url
  } catch (e) {
    console.error('Sign failed:', e.message)
    return url
  }
}

/**
 * 获取订单券码信息
 */
async function getCouponList(token, orderId, options = {}) {
  const orderIdStr = String(orderId)
  const isGift = /^[a-zA-Z]/.test(orderIdStr) || orderIdStr.length > 20

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
      giftId: isGift ? orderIdStr : undefined,
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
    const payloadStr = JSON.stringify(payload)
    const signedUrl = getSignedUrl(baseUrl, payloadStr)

    console.error(`[Backend API] Querying order: ${orderIdStr}, isGift: ${isGift}`)

    const response = await axios.post(signedUrl, payload, { headers, timeout: 15000 })

    console.error(`[Backend API] Response status: ${response.status}`)
    console.error(`[Backend API] Response data keys: ${Object.keys(response.data || {})}`)
    console.error(`[Backend API] nodeDataMap keys: ${Object.keys(response.data?.data?.nodeDataMap || {}).join(', ')}`)
    console.error(`\n====== 美团接口原始响应 ======`)
    console.error(JSON.stringify(response.data, null, 2))
    console.error(`=============================\n`)

    // 解析响应
    const coupons = parseCouponResponse(response.data)

    return { success: true, coupons }
  } catch (error) {
    console.error('[Backend API] Error:', error.message)
    const isWindControl = error.response?.status === 418 || String(error.message).includes('418')
    return { success: false, error: error.message, isWindControl, coupons: [] }
  }
}

/**
 * 解析券码响应
 */
function parseCouponResponse(res) {
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
async function main() {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.log(JSON.stringify({ success: false, error: 'Usage: node meituanBackendApi.cjs <action> <args_json>' }))
    process.exit(1)
  }

  const action = args[0]
  const params = JSON.parse(args[1])

  try {
    let result

    switch (action) {
      case 'getCouponList':
        result = await getCouponList(params.token, params.orderId, params.options || {})
        break
      default:
        result = { success: false, error: `Unknown action: ${action}` }
    }

    console.log(JSON.stringify(result))
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }))
  }
}

main()
