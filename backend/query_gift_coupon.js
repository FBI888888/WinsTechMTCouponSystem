/**
 * 独立查询礼物号券码脚本 (JS版本)
 *
 * 使用方式：
 * 1. 修改下方的 TOKEN / USERID / GIFT_ID
 * 2. 在 backend 目录执行：node query_gift_coupon.js
 */

const axios = require('axios')
const path = require('path')
const fs = require('fs')
const vm = require('vm')

// ====== 你自己填写 ======
const TOKEN = 'AgE8IxcqrfOqfKicX8NxGw-j6VHPYuEzd9-MWkfsOdWWxL4xddhm6EXxARQBq8cNMJtskfH7PQDk3gAAAAAnMwAAmu7y_L1n42FHlWLRp9lcRHfzMXeOd00ofIlne_gbioOiG05Cv_IAaVCgDeUye8C_'
const USERID = '4360236367'
const GIFT_ID = '20078597718041774871896'
// ======================

// 加载 H5guard.js 签名服务
let getVerifyFunc = null

function initH5guard() {
  if (getVerifyFunc) return true

  try {
    const jsPath = path.join(__dirname, 'app', 'services', 'meituan', 'H5guard.js')
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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
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
    console.error('[Sign] H5guard not initialized, using unsigned URL')
    return url
  }

  try {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
    const result = getVerifyFunc(url, dataStr)
    if (result?.url) {
      console.error('[Sign] Signature generated successfully')
      return result.url
    }
    return url
  } catch (e) {
    console.error('[Sign] Failed:', e.message)
    return url
  }
}

async function queryGiftCoupon(token, userid, giftId) {
  const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/detail/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.2.0`

  // 使用你提供的完整payload结构
  const payload = {
    "pageQuery": {
      "cityId": "603",
      "locCityId": "603",
      "lat": "41.748709",
      "lng": "86.159215",
      "finger": "33yz16x59z375z1x05521u0yuy2u4u1w80w61uwu23w97978957yv3uv",
      "giftId": giftId,
      "rcf_uniqueid": "rcff1d5.60cb98145e36a.acc1d6caf-6c86.24fc73c32-4209.bb9bcae89-7db1.66a67ddd2-9315.cb595a134-default-" + Date.now(),
      "rcf_token": "5cac67121c9d446c8c2d7b93",
      "programName": "mt",
      "mina_name": "mt-weapp",
      "openId": "oJVP50DRAdtKlPFyi66xw2Uw03Is",
      "token": token,
      "userId": userid,
      "uuid": "19d38fdf436c8-35cea366b6a598-0-0-19d38fdf436c8",
      "utmMedium": "WEIXINPROGRAM",
      "appVersion": "10.12.1",
      "envPlatform": "wx",
      "platform": "ANDROID",
      "uniPlatform": "windows",
      "expoId": "AwQAAABJAgAAAAEAAAAyAAAAPLgC95WH3MyqngAoyM/hf1hEoKrGdo0pJ5DI44e1wGF9AT3PH7Wes03actC2n/GVnwfURonD78PewMUppAAAADjb199ud7BPBuj3hu6J2Zz3Fj8fKPV1FzhxRGUwbKl+cq4xDsO2/KEz0RkXXNyQa70wbtQGVQ5uWQ",
      "utmTerm": "0",
      "utmCampaign": "0",
      "unionId": "oNQu9t8NB_8JXj78m2GynFJJsRTo",
      "app_version": "10.12.1",
      "scene": "1256",
      "__lxsdk_params": "bHhjdWlkOjE5ZDM4ZmRmNDM2YzgtMzVjZWEzNjZiNmE1OTgtMC0wLTE5ZDM4ZmRmNDM2Yzg7YXBwOjEwLjEyLjE7YXBwbm06Z3JvdXBfd3hhcHA7bXNpZDoxOWQzZDQyYzU2NC1mNjlhLTIzYjAtNWM2O3d4aWQ6b0pWUDUwRFJBZHRLbFBGeWk2Nnh3MlV3MDNJcztzY2VuZToxMjU2O2xjaDpncm91cF93eGFwcDt1dG1fY29udGVudDowO3V0bV9jYW1wYWlnbjowO3V1aWQ6MTlkMzhmZGY0MzZjOC0zNWNlYTM2NmI2YTU5OC0wLTAtMTlkMzhmZGY0MzZjODt3eHVuaW9uaWQ6b05RdTl0OE5CXzhKWGo3OG0yR3luRkpKc1JUbztjaXR5aWQ6NjAzO29uZWlkX21pbmlfcHJvZ3JhbTp7Im9uZWlkX3BsYXRmb3JtIjoid2VjaGF0Iiwib25laWRfYXBwX3ZlcnNpb24iOiIxMC4xMi4wIiwib25laWRfc2RrX3ZlcnNpb24iOiIwLjAuMjIiLCJvbmVpZF93ZWNoYXRfbG9jYWxpZCI6IjE5ZDM4ZmRmNGE4YzgtMjFlMDkxMWU3ZjkyZGEtMC0wLTE5ZDM4ZmRmNGE4YzgiLCJvbmVpZF93ZWNoYXRfb3BlbmlkIjoib0pWUDUwRFJBZHRLbFBGeWk2Nnh3MlV3MDNJcyIsIm9uZWlkX3dlY2hhdF91bmlvbmlkIjoib05RdTl0OE5CXzhKWGo3OG0yR3luRkpKc1JUbyIsIm9uZWlkX2JhY2tmaWxsIjoiMCIsIm9uZWlkX2lzd3hpZCI6IjAifTtwbjp3eGRlOGFjMGEyMTEzNWMwN2Q7d2k6NDA5NTk7d2Y6ZzQ4ZzBpO2ppOjY2ODIyO2pmOjE1OWIxNTtzZGtfZW52Om9ubGluZQ..",
      "_lx_tag": "eyJncm91cCI6eyJjX3FhbjUwNjAwIjp7ImJpZCI6ImJfMXN2M3lwdDEiLCJpbmRleCI6MywiYnV0dG9uX25hbWUiOiLmiJHnmoQiLCJ0YWJfbmFtZSI6IuaIkeeahCIsImNsaWNrX3R5cGUiOiIwIiwiZXhjaGFuZ2VfcmVzb3VyY2VfaWQiOiIyNDc0MzAiLCJlbGVtZW50X2lkIjoiLTk5OSIsImNhdF9pZCI6Ii05OTkiLCJseF90YWdfdG0iOjE3NzQ4NDkyOTAyNTd9LCJjX3M1N2hsM3IyIjp7ImJpZCI6ImJfZ3JvdXBfcWwwMHh4em1fbWMiLCJvcGVuX2lkIjoib0pWUDUwRFJBZHRLbFBGeWk2Nnh3MlV3MDNJcyIsImluZGV4IjowLCJvcmRlcl9pZCI6IjE5NTA5MDExNTU3NzAxNzc0Nzg1NzkyIiwib3JkZXJfdHlwZSI6IuekvOeJqeW*heS9v*eUqCIsInBhcnRuZXJfaWQiOjE2NywidGFiX25hbWUiOiLlhajpg6giLCJseF90YWdfdG0iOjE3NzQ4NDkyOTkwNjl9fX0.",
      "_lx_ver": "3.17.5"
    },
    "commonParams": {
      "location": {
        "lat": 41.748709,
        "lng": 86.159215,
        "accuracy": 0
      },
      "userInfo": {
        "userId": userid,
        "token": token,
        "uuid": "19d38fdf436c8-35cea366b6a598-0-0-19d38fdf436c8",
        "openId": "oJVP50DRAdtKlPFyi66xw2Uw03Is",
        "wxUnionId": "oNQu9t8NB_8JXj78m2GynFJJsRTo",
        "uuidV2": "oJVP50DRAdtKlPFyi66xw2Uw03Is"
      },
      "cityInfo": {
        "cityId": "603",
        "locCityId": "603"
      },
      "fingerprint": {
        "fingerprint": "33yz16x59z375z1x05521u0yuy2u4u1w80w61uwu23w97978957yv3uv"
      },
      "systemInfo": {
        "version": "",
        "systemVersion": "",
        "device": "",
        "platform": "android",
        "IS_MT": true,
        "IS_DP": false,
        "IS_TICKET": false,
        "IS_HOTEL": false,
        "isMRN": false,
        "isWeb": true,
        "isWeChatMiniProgram": false,
        "mpAppId": "wxde8ac0a21135c07d",
        "mpAppVersion": "10.12.1",
        "envInWeb": {
          "isWebInApp": false,
          "isWebInMtApp": false,
          "isWebInDpApp": false,
          "isWebInWeChatMiniProgram": true,
          "isWebInTicketWeChatMiniProgram": false,
          "isWebInMtWeChatMiniProgram": true,
          "isWebInDpWeChatMiniProgram": false,
          "isWebInHotelWeChatMiniProgram": false,
          "isWebInToutiaoMiniProgram": false,
          "isWebInKSMiniProgram": false,
          "isWebInBaiduMiniProgram": false,
          "isWebInDpBaiduMiniProgram": false,
          "isWebInMtBaiduMiniProgram": false,
          "isWebInHarmonyMSCMiniProgram": false
        },
        "isDebug": false,
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d"
      },
      "storage": {},
      "isPreview": true,
      "isUpdate": false,
      "isSubmit": false,
      "isCheck": false
    },
    "prevData": {},
    "nodeDataMap": {},
    "updatePropMap": {},
    "payload": {},
    "cacheDynamicComponent": {
      "protocolVersion": "0001"
    },
    "pageId": "12299",
    "pageProtocolId": "0340",
    "minifyHttpResponse": "1"
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
    'Cookie': 'WEBDFPID=1774785612766KQUUAEQfd79fef3d01d5e9aadc18ccd4d0c95074632-1774785612766-1774785612766KQUUAEQfd79fef3d01d5e9aadc18ccd4d0c95074632; _lxsdk_cuid=19d39774dd6c8-00737215ee8cab-683f067d-144000-19d39774dd7c8; _lx_utm=utm_content%3D0%26utm_campaign%3D0; _lxsdk=19d38fdf436c8-35cea366b6a598-0-0-19d38fdf436c8; _lxsdk_s=19d3d43286b-194-3e1-2fd%7C%7CNaN',
    'Content-Type': 'application/json'
  }

  try {
    console.error(`[Query] Gift ID: ${giftId}`)
    console.error(`[Query] User ID: ${userid}`)

    const payloadStr = JSON.stringify(payload)
    const signedUrl = getSignedUrl(baseUrl, payloadStr)

    console.error(`[Query] Signed URL length: ${signedUrl.length}`)

    const response = await axios.post(signedUrl, payload, { headers, timeout: 30000 })

    console.error(`[Query] Response status: ${response.status}`)

    // 打印完整原始响应
    console.log('\n====== 美团接口原始响应 ======')
    console.log(JSON.stringify(response.data, null, 2))
    console.log('=============================\n')

    // 解析券码
    const coupons = parseCouponResponse(response.data)

    console.log('====== 解析后的券码信息 ======')
    if (coupons.length === 0) {
      console.log('未找到券码信息')
    } else {
      coupons.forEach((c, i) => {
        console.log(`\n[${i + 1}]`)
        console.log(`  券码: ${c.coupon || c.encode || '-'}`)
        console.log(`  状态: ${c.order_status || '-'}`)
        console.log(`  核销时间: ${c.verifyTime || '-'}`)
        console.log(`  核销门店: ${c.verifyPoiName || '-'}`)
      })
    }
    console.log('==============================\n')

    return { success: true, coupons }
  } catch (error) {
    console.error('[Query] Error:', error.message)
    if (error.response) {
      console.error('[Query] Response status:', error.response.status)
      console.error('[Query] Response data:', error.response.data)
    }
    return { success: false, error: error.message, coupons: [] }
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
  if (!TOKEN || !USERID || !GIFT_ID) {
    console.error('请先填写 TOKEN / USERID / GIFT_ID')
    process.exit(1)
  }

  await queryGiftCoupon(TOKEN, USERID, GIFT_ID)
}

main()
