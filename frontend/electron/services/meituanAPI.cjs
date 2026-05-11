/**
 * Meituan API service
 * Uses the frontend-local mtgsig standalone signer.
 */
const axios = require('axios')
const { sign: signRequest, reinit: reinitSigner } = require('./mtgsig_standalone.cjs')

// 取消标志存储
const cancelFlags = new Map()

// 设置取消标志
function setCancelFlag(operationId, cancelled) {
  cancelFlags.set(operationId, cancelled)
}

// 检查是否已取消
function isCancelled(operationId) {
  return cancelFlags.get(operationId) === true
}

// 清除取消标志
function clearCancelFlag(operationId) {
  cancelFlags.delete(operationId)
}

// 生成唯一操作ID
function generateOperationId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// Track signer reuse for Electron-side requests.
let requestCount = 0
const ROTATION_THRESHOLD = 50

function getSignedUrl(url, data, method = 'POST') {
  try {
    const { signedUrl } = signRequest({
      method,
      url,
      body: data,
      fresh: false,
      maxReuse: ROTATION_THRESHOLD,
    })
    requestCount += 1
    return signedUrl || url
  } catch (e) {
    console.error('Sign failed:', e.message)
    try {
      reinitSigner()
    } catch (_) {}
    return url
  }
}

class MeituanAPI {
  /**
   * 检查CK状态
   */
  static async checkCKStatus(userid, token) {
    const url = `https://ordercenter.meituan.com/ordercenter/user/orders?userid=${userid}&token=${token}&offset=0&limit=10&platformid=6&statusFilter=0&version=0&yodaReady=wx&csecappid=wxde8ac0a21135c07d&csecplatform=3&csecversionname=9.25.105&csecversion=1.4.0`

    const headers = {
      'Host': 'ordercenter.meituan.com',
      'Connection': 'keep-alive',
      'User-Agent': '',
      'xweb_xhr': '1',
      'utm_medium': '',
      'clientversion': '3.8.9',
      'Accept': '*/*',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://servicewechat.com/wxde8ac0a21135c07d/1451/page-frame.html',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }

    try {
      const response = await axios.get(url, { headers, timeout: 10000 })
      console.log('检查CK状态响应:', JSON.stringify(response.data))
      // code 为 0 表示正常，其他值或不存在表示失效
      const code = response.data?.code
      if (code === 0) {
        return 0
      }
      return code !== undefined ? code : -1
    } catch (error) {
      console.error('检查CK状态失败:', error.message)
      return -1
    }
  }

  /**
   * 获取订单列表（带状态筛选）
   * @param {string} userid
   * @param {string} token
   * @param {number} days
   * @param {number} statusFilter
   * @param {number} maxPages
   * @param {string} operationId - 可选的操作ID，用于取消
   */
  static async getOrdersListWithStatus(userid, token, days = 7, statusFilter = 0, maxPages = 200, operationId = null) {
    const allOrders = []
    let offset = 0
    let currentPage = 0
    let check = true

    const today = new Date()
    const daysAgo = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)

    console.log('========== 开始获取订单列表 ==========')
    console.log(`参数: userid=${userid}, days=${days}, statusFilter=${statusFilter}, maxPages=${maxPages}, operationId=${operationId}`)
    console.log(`时间范围: ${daysAgo.toLocaleString('zh-CN')} 至 ${today.toLocaleString('zh-CN')}`)

    const headers = {
      'Host': 'ordercenter.meituan.com',
      'Connection': 'keep-alive',
      'User-Agent': '',
      'xweb_xhr': '1',
      'utm_medium': '',
      'M-APPKEY': 'wxmp_mt-weapp',
      'token': token,
      'clientversion': '3.6.6',
      'Accept': '*/*',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://servicewechat.com/wxde8ac0a21135c07d/1367/page-frame.html',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }

    while (check) {
      // 检查是否被取消
      if (operationId && isCancelled(operationId)) {
        console.log(`[取消] 订单同步已被取消，当前页: ${currentPage}`)
        clearCancelFlag(operationId)
        return { orders: allOrders, cancelled: true }
      }

      currentPage++

      // 检查是否超过最大页数
      if (currentPage > maxPages) {
        console.log(`[翻页停止] 已达到最大页数 ${maxPages}`)
        break
      }

      const url = `https://ordercenter.meituan.com/ordercenter/user/orders?userid=${userid}&token=${token}&offset=${offset}&limit=100&platformid=6&statusFilter=${statusFilter}&version=0&yodaReady=wx&csecappid=wxde8ac0a21135c07d&csecplatform=3&csecversionname=8.47.166&csecversion=1.4.0`

      console.log(`[翻页] 正在获取第 ${currentPage} 页, offset=${offset}...`)

      try {
        const response = await axios.get(url, {
          headers,
          timeout: 15000,
          transformResponse: [(data) => {
            const processed = data.replace(/"orderid"\s*:\s*(\d{15,})/g, '"orderid":"$1"')
            return JSON.parse(processed)
          }]
        })
        const data = response.data
        const orders = data.data?.orders || []

        console.log(`[响应] 第 ${currentPage} 页返回 ${orders.length} 条订单`)

        if (orders.length === 0) {
          console.log(`[翻页停止] 第 ${currentPage} 页返回空列表`)
          check = false
          break
        }

        let addedCount = 0
        let skippedCount = 0
        let outOfRangeCount = 0

        for (const order of orders) {
          const orderTime = order.ordertime ? new Date(order.ordertime * 1000) : new Date()

          if (orderTime >= daysAgo) {
            // 礼物待使用单独映射 orderid 字段
            if (order.catename !== "美食团购" && order.showstatus?.includes("礼物")) {
              const orderInfo = {
                orderid: String(order.stringOrderId || order.orderid || ''),
                stringOrderId: String(order.stringOrderId || order.orderid || ''),
                title: order.title || '',
                showstatus: order.showstatus || '',
                catename: order.catename || '',
                orderinfo: order.orderinfo || [],
                tousestatus: order.tousestatus || 0,
                ordertime: order.ordertime || 0
              }
              if (!allOrders.find(o => o.orderid === orderInfo.orderid)) {
                allOrders.push(orderInfo)
                addedCount++
              } else {
                skippedCount++
              }
              continue
            }

            const rawOrderId = order.stringOrderId || order.orderid
            const orderIdStr = String(rawOrderId || '')

            const orderInfo = {
              orderid: orderIdStr,
              stringOrderId: String(order.stringOrderId || orderIdStr),
              title: order.title || '',
              showstatus: order.showstatus || '',
              catename: order.catename || '',
              orderinfo: order.orderinfo || [],
              tousestatus: order.tousestatus || 0,
              ordertime: order.ordertime || 0
            }
            if (!allOrders.find(o => o.orderid === orderInfo.orderid)) {
              allOrders.push(orderInfo)
              addedCount++
            } else {
              skippedCount++
            }
          } else {
            outOfRangeCount++
          }
        }

        console.log(`[统计] 第 ${currentPage} 页: 新增 ${addedCount}, 跳过重复 ${skippedCount}, 超出时间 ${outOfRangeCount}`)

        // 只有当整页都超出时间范围时才停止翻页
        if (outOfRangeCount === orders.length) {
          console.log(`[翻页停止] 第 ${currentPage} 页全部 ${orders.length} 条订单都超出时间范围`)
          check = false
          break
        }

        offset += 100
      } catch (error) {
        console.error(`[错误] 获取第 ${currentPage} 页失败:`, error.message)
        check = false
      }
    }

    console.log(`========== 订单获取完成 ==========`)
    console.log(`总计: 获取 ${currentPage} 页, 共 ${allOrders.length} 条有效订单`)

    return { orders: allOrders, cancelled: false }
  }

  /**
   * 根据订单ID获取券码列表 (使用签名)
   * @param {string} token
   * @param {string|number} orderid
   * @param {object} options - 可选参数 { longitude, latitude }
   */
  static async getCouponListByOrderId(token, orderid, options = {}) {
    // 确保 orderid 是字符串
    const orderIdStr = String(orderid)
    const { longitude, latitude, userId, openId, uuid } = options

    // 判断是否为礼物订单（字符串订单号，通常以字母开头或长度超过15位的纯字母数字）
    const isGift = /^[a-zA-Z]/.test(orderIdStr) || (orderIdStr.length > 20)

    console.log('getCouponListByOrderId - orderid:', orderIdStr, '是否礼物订单:', isGift, '经度:', longitude, '纬度:', latitude, 'userId:', userId, 'openId:', openId)

    if (isGift) {
      return await this.getGiftCouponList(token, orderIdStr, { longitude, latitude, userId, openId, uuid })
    }

    const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/detail/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.0.2`

    // 构建 location 对象，如果提供了经纬度则使用，否则只有 accuracy
    const locationObj = { accuracy: 0 }
    if (longitude) locationObj.longitude = parseFloat(longitude)
    if (latitude) locationObj.latitude = parseFloat(latitude)
    console.log('locationObj:', locationObj)
    const payload = {
      pageQuery: {
        cityId: "795",
        lat: latitude,
        lng: longitude,
        locCityId: "795",
        orderId: orderIdStr,
        programName: "mt",
        mina_name: "mt-weapp",
        token: token,
        utmMedium: "WEIXINPROGRAM",
        appVersion: "9.27.2",
        envPlatform: "wx",
        platform: "ANDROID",
        uniPlatform: "android",
        utmTerm: "0",
        utmCampaign: "0",
        app_version: "9.27.2",
        scene: "1256",
        _lx_ver: "3.17.5"
      },
      commonParams: {
        location: locationObj,
        userInfo: { token: token },
        cityInfo: { cityId: "795", locCityId: "795" },
        fingerprint: { fingerprint: "" },
        systemInfo: {
          version: "",
          systemVersion: "",
          device: "",
          platform: "android",
          IS_MT: true,
          IS_DP: false,
          IS_TICKET: false,
          isMRN: false,
          isWeb: true,
          isWeChatMiniProgram: false,
          mpAppId: "wxde8ac0a21135c07d",
          mpAppVersion: "9.27.2",
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
          userAgent: ''
        },
        storage: { deliveryAddrCacheJson: "" },
        isPreview: true,
        isUpdate: false,
        isSubmit: false
      },
      prevData: {},
      nodeDataMap: {},
      updatePropMap: {},
      payload: {},
      cacheDynamicComponent: { protocolVersion: "0001" },
      pageId: "12299",
      pageProtocolId: "0192"
    }

    const headers = {
      'Host': 'apimobile.meituan.com',
      'Connection': 'keep-alive',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': '',
      'Origin': 'https://awp.meituan.com',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://awp.meituan.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }

    const maxRetries = 3
    let lastError = null

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const payloadStr = JSON.stringify(payload)
        const signedUrl = getSignedUrl(baseUrl, payloadStr, 'POST')

        console.log(`获取券码 - 订单ID: ${orderIdStr}, 尝试次数: ${retry + 1}/${maxRetries}`)
        console.log('获取券码 - 签名URL:', signedUrl.substring(0, 200) + '...')

        const response = await axios.post(signedUrl, payload, { headers, timeout: 15000 })
        console.log('获取券码 - 响应状态:', response.status)

        // 打印 nodeDataMap 中的所有节点名称，帮助调试
        const nodeDataMap = response.data?.data?.nodeDataMap || {}
        const nodeNames = Object.keys(nodeDataMap)
        console.log('获取券码 - nodeDataMap 节点列表:', nodeNames.join(', '))

        // 打印完整响应数据（前2000字符）
        console.log('获取券码 - 完整响应数据:', JSON.stringify(response.data).substring(0, 2000))

        // 检查是否有风控错误
        if (response.data?.code === 403 || response.data?.msg?.includes('风控') || response.data?.message?.includes('风控')) {
          console.log('获取券码 - 检测到风控，准备重试...')
          lastError = new Error('WIND_CONTROL')
          if (retry < maxRetries - 1) {
            await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
            continue
          }
        }

        const result = this.parseCouponResponse(response.data)
        console.log('获取券码 - 解析结果数量:', result.length)

        // 提取店铺位置（无论是否需要重试都提取，以便调用方缓存复用）
        const extractedShopLocation = this.extractShopLocation(response.data)

        // 检查是否全部为占位券码 (000000000000)，如果是则尝试使用店铺位置重新查询
        if (this.isAllPlaceholderCoupons(result) && !options._shopLocationRetried) {
          console.log('[券码查询] 检测到全部券码为000000000000，尝试提取店铺位置重新查询...')

          if (extractedShopLocation && extractedShopLocation.lat && extractedShopLocation.lng) {
            console.log(`[券码查询] 使用店铺位置重新查询: lat=${extractedShopLocation.lat}, lng=${extractedShopLocation.lng}`)
            await new Promise(r => setTimeout(r, 300))

            // 递归调用，标记已经使用店铺位置重试过
            const retryResult = await this.getCouponListByOrderId(token, orderid, {
              longitude: extractedShopLocation.lng,
              latitude: extractedShopLocation.lat,
              _shopLocationRetried: true
            })

            // 如果重试后获取到有效券码，返回重试结果（附带shopLocation）
            if (retryResult.coupons.length > 0 && !this.isAllPlaceholderCoupons(retryResult.coupons)) {
              console.log('[券码查询] 使用店铺位置重新查询成功，获取到有效券码')
              return { coupons: retryResult.coupons, shopLocation: extractedShopLocation }
            }
            console.log('[券码查询] 使用店铺位置重新查询仍为占位券码，返回原始结果')
          } else {
            console.log('[券码查询] 未能从响应中提取到店铺位置信息')
          }
        }

        // 如果解析结果为空，可能是风控导致，尝试重试
        if (result.length === 0 && retry < maxRetries - 1) {
          console.log('获取券码 - 无券码信息，准备重试...')
          lastError = new Error('NO_COUPON_DATA')
          await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
          continue
        }

        // 返回结果，附带提取到的店铺位置（供调用方缓存复用）
        return { coupons: result, shopLocation: extractedShopLocation }
      } catch (error) {
        console.error(`获取券码列表失败(尝试${retry + 1}):`, error.message, error.response?.status, error.response?.data)
        lastError = error

        // 如果是403错误，标记为风控
        if (error.response?.status === 403) {
          lastError = new Error('WIND_CONTROL_403')
        }

        if (retry < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
          continue
        }
      }
    }

    // 所有重试都失败了
    if (lastError && (lastError.message === 'WIND_CONTROL' || lastError.message === 'WIND_CONTROL_403' || lastError.message === 'NO_COUPON_DATA')) {
      throw new Error('WIND_CONTROL')
    }
    return { coupons: [], shopLocation: null }
  }

  /**
   * 获取礼物订单券码列表
   */
  static async getGiftCouponList(token, giftId, options = {}) {
    const { longitude, latitude, userId, openId, uuid } = options
    const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/detail/preview?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token=${token}&yodaReady=h5&csecplatform=4&csecversion=4.2.0`

    // 构建 location 对象
    const locationObj = { accuracy: 0 }
    if (longitude) {
      const lng = parseFloat(longitude)
      locationObj.longitude = lng
      locationObj.lng = lng
    }
    if (latitude) {
      const lat = parseFloat(latitude)
      locationObj.latitude = lat
      locationObj.lat = lat
    }

    // 生成随机指纹
    const finger = options.finger || `${Math.random().toString(36).substring(2, 15)}`
    const uuidValue = uuid || `19d38fdf436c8-35cea366b6a598-0-0-${Date.now()}`

    const payload = {
      pageQuery: {
        cityId: "603",
        locCityId: "603",
        lat: latitude || "41.748709",
        lng: longitude || "86.159215",
        finger: finger,
        giftId: giftId,
        rcf_uniqueid: `rcff1d5.60cb98145e36a.acc1d6caf-6c86.24fc73c32-4209.bb9bcae89-7db1.66a67ddd2-9315.cb595a134-default-${Date.now()}`,
        rcf_token: "5cac67121c9d446c8c2d7b93",
        programName: "mt",
        mina_name: "mt-weapp",
        openId: openId || "",
        token: token,
        userId: userId || "",
        uuid: uuidValue,
        utmMedium: "WEIXINPROGRAM",
        appVersion: "10.12.1",
        envPlatform: "wx",
        platform: "ANDROID",
        uniPlatform: "windows",
        utmTerm: "0",
        utmCampaign: "0",
        app_version: "10.12.1",
        scene: "1256",
        _lx_ver: "3.17.5"
      },
      commonParams: {
        location: {
          lat: parseFloat(latitude) || 41.748709,
          lng: parseFloat(longitude) || 86.159215,
          accuracy: 0
        },
        userInfo: {
          userId: userId || "",
          token: token,
          uuid: uuidValue,
          openId: openId || "",
          wxUnionId: "",
          uuidV2: openId || ""
        },
        cityInfo: { cityId: "603", locCityId: "603" },
        fingerprint: { fingerprint: finger },
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
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': '',
      'Origin': 'https://awp.meituan.com',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://awp.meituan.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }

    const maxRetries = 3
    let lastError = null

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const payloadStr = JSON.stringify(payload)
        const signedUrl = getSignedUrl(baseUrl, payloadStr, 'POST')

        console.log(`获取礼物券码 - giftId: ${giftId}, 尝试次数: ${retry + 1}/${maxRetries}`)

        const response = await axios.post(signedUrl, payload, { headers, timeout: 15000 })
        console.log('获取礼物券码 - 响应状态:', response.status)

        // 检查是否有风控错误
        if (response.data?.code === 403 || response.data?.msg?.includes('风控') || response.data?.message?.includes('风控')) {
          console.log('获取礼物券码 - 检测到风控，准备重试...')
          lastError = new Error('WIND_CONTROL')
          if (retry < maxRetries - 1) {
            await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
            continue
          }
        }
        console.log(JSON.stringify(response.data))
        const result = this.parseGiftCouponResponse(response.data)
        console.log('获取礼物券码 - 解析结果数量:', result.length)

        // 检查是否全部为占位券码 (000000000000)，如果是则尝试使用店铺位置重新查询
        // 检查是否全部为占位券码 (000000000000)，如果是则尝试使用店铺位置重新查询
        // 提取店铺位置（无论是否需要重试都提取，以便调用方缓存复用）
        const extractedShopLocation = this.extractShopLocation(response.data)

        if (this.isAllPlaceholderCoupons(result) && !options._shopLocationRetried) {
          console.log('[礼物券码查询] 检测到全部券码为000000000000，尝试提取店铺位置重新查询...')

          if (extractedShopLocation && extractedShopLocation.lat && extractedShopLocation.lng) {
            console.log(`[礼物券码查询] 使用店铺位置重新查询: lat=${extractedShopLocation.lat}, lng=${extractedShopLocation.lng}`)
            await new Promise(r => setTimeout(r, 300))

            // 递归调用，标记已经使用店铺位置重试过
            const retryResult = await this.getGiftCouponList(token, giftId, {
              longitude: extractedShopLocation.lng,
              latitude: extractedShopLocation.lat,
              _shopLocationRetried: true
            })

            // 如果重试后获取到有效券码，返回重试结果（附带shopLocation）
            if (retryResult.coupons.length > 0 && !this.isAllPlaceholderCoupons(retryResult.coupons)) {
              console.log('[礼物券码查询] 使用店铺位置重新查询成功，获取到有效券码')
              return { coupons: retryResult.coupons, shopLocation: extractedShopLocation }
            }
            console.log('[礼物券码查询] 使用店铺位置重新查询仍为占位券码，返回原始结果')
          } else {
            console.log('[礼物券码查询] 未能从响应中提取到店铺位置信息')
          }
        }

        // 如果解析结果为空，可能是风控导致，尝试重试
        if (result.length === 0 && retry < maxRetries - 1) {
          console.log('获取礼物券码 - 无券码信息，准备重试...')
          lastError = new Error('NO_COUPON_DATA')
          await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
          continue
        }

        // 返回结果，附带提取到的店铺位置和原始响应数据（供调用方缓存复用和风控检测）
        return { coupons: result, shopLocation: extractedShopLocation, rawData: response.data }
      } catch (error) {
        console.error(`获取礼物券码列表失败(尝试${retry + 1}):`, error.message, error.response?.status)
        lastError = error

        // 如果是403错误，标记为风控
        if (error.response?.status === 403) {
          lastError = new Error('WIND_CONTROL_403')
        }

        if (retry < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
          continue
        }
      }
    }

    // 所有重试都失败了
    if (lastError && (lastError.message === 'WIND_CONTROL' || lastError.message === 'WIND_CONTROL_403' || lastError.message === 'NO_COUPON_DATA')) {
      throw new Error('WIND_CONTROL')
    }
    return { coupons: [], shopLocation: null }
  }

  /**
   * 解析普通订单券码响应
   */
  static parseCouponResponse(res) {
    const couponsInfoList = []

    try {
      let title = ''
      let mobile = ''
      let payPrice = ''

      const nodeDataMap = res?.data?.nodeDataMap || {}

      // 辅助函数：获取节点的属性（兼容 p 和 props 两种结构）
      const getNodeProps = (nodeName) => {
        const node = nodeDataMap[nodeName]
        if (!node) return null
        // 兼容两种结构: { p: {...} } 和 { props: {...} }
        return node.p || node.props || null
      }

      // 尝试从 OrderDetailNavBar1 获取订单信息
      try {
        const navBar = getNodeProps('OrderDetailNavBar1')
        title = navBar?.shopInfo?.name?.text?.split('（')[0] || ''
        mobile = navBar?.orderInfo?.mobile || ''
        payPrice = navBar?.orderInfo?.price?.payPrice || ''
      } catch (e) { }

      // 尝试从 FoodOrderDetailDeal1 获取标题
      if (!title) {
        try {
          const deal = getNodeProps('FoodOrderDetailDeal1')
          title = deal?.name?.text?.split('（')[0] || ''
          payPrice = payPrice || deal?.price?.payPrice || ''
        } catch (e) { }
      }

      // 1. 先解析核销记录，建立券码 -> 核销信息的映射
      const verifyMap = {}  // key: 券码, value: { verifyTime, verifyPoiName, verifyStatusText }
      try {
        const verifyModule = getNodeProps('FoodOrderDetailVerifyRecord1')
        const verifyRecords = verifyModule?.verifyRecords || []
        console.log(`[券码解析] verifyRecords 数量: ${verifyRecords.length}`)

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
        console.log(`[券码解析] 核销映射表:`, JSON.stringify(verifyMap))
      } catch (e) {
        console.error('[券码解析] verifyRecords 解析失败:', e.message)
      }

      // 2. 解析券码 - 从 CouponModule1 获取，并合并核销信息
      try {
        const couponModule = getNodeProps('CouponModule1')
        const coupons = couponModule?.coupons || []
        console.log(`[券码解析] CouponModule1.coupons 数量: ${coupons.length}`)
        if (coupons.length > 0) {
          console.log('[券码解析] 第一条券码数据:', JSON.stringify(coupons[0]))
        }
        for (const coupon of coupons) {
          const couponCode = (coupon.code || '').replace('优惠码:', '')

          // 检查是否有核销记录
          const verifyInfo = verifyMap[couponCode]
          let statusText = ''
          let verifyTime = ''
          let verifyPoiName = ''

          if (verifyInfo) {
            // 有核销记录，使用核销信息
            statusText = verifyInfo.verifyStatusText || '已使用'
            verifyTime = verifyInfo.verifyTime
            verifyPoiName = verifyInfo.verifyPoiName
          } else {
            // 无核销记录，根据 useStatus 判断状态
            statusText = coupon.statusText || (coupon.useStatus === 1 ? '待使用' : coupon.useStatus === 3 ? '已使用' : '')
          }

          couponsInfoList.push({
            title,
            coupon: couponCode,
            encode: coupon.encode || '',
            couponId: coupon.id || '',
            status: verifyInfo
              ? `${couponCode}--核销时间：${verifyTime}--核销门店："${verifyPoiName}"`
              : `${couponCode}--${statusText}`,
            order_status: statusText,
            useStatus: coupon.useStatus,
            verifyTime: verifyTime,
            verifyPoiName: verifyPoiName,
            mobile,
            payPrice
          })
        }
      } catch (e) {
        console.error('[券码解析] CouponModule1 解析失败:', e.message)
      }
    } catch (e) {
      console.error('解析券码响应失败:', e.message)
    }

    console.log(`[券码解析] 总计解析到 ${couponsInfoList.length} 条券码`)
    return couponsInfoList
  }

  /**
   * 解析礼物订单券码响应
   */
  static parseGiftCouponResponse(res) {
    const couponsInfoList = []

    try {
      const nodeDataMap = res?.data?.nodeDataMap || {}

      // 辅助函数：获取节点的属性（兼容 p 和 props 两种结构）
      const getNodeProps = (nodeName) => {
        const node = nodeDataMap[nodeName]
        if (!node) return null
        return node.p || node.props || null
      }

      // 1. 先解析核销记录，建立券码 -> 核销信息的映射
      const verifyMap = {}  // key: 券码, value: { verifyTime, verifyPoiName, verifyStatusText }
      try {
        const verifyModule = getNodeProps('FoodOrderDetailVerifyRecord1')
        const verifyRecords = verifyModule?.verifyRecords || []
        console.log(`[礼物券码解析] verifyRecords 数量: ${verifyRecords.length}`)

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
        console.log(`[礼物券码解析] 核销映射表:`, JSON.stringify(verifyMap))
      } catch (e) {
        console.error('[礼物券码解析] verifyRecords 解析失败:', e.message)
      }

      // 2. 解析券码 - 从 CouponModule1 获取，并合并核销信息
      try {
        const couponModule = getNodeProps('CouponModule1')
        const coupons = couponModule?.coupons || []
        console.log(`[礼物券码解析] CouponModule1.coupons 数量: ${coupons.length}`)
        if (coupons.length > 0) {
          console.log('[礼物券码解析] 第一条券码数据:', JSON.stringify(coupons[0]))
        }
        for (const coupon of coupons) {
          const couponCode = (coupon.code || '').replace('优惠码:', '')

          // 检查是否有核销记录
          const verifyInfo = verifyMap[couponCode]
          let statusText = ''
          let verifyTime = ''
          let verifyPoiName = ''

          if (verifyInfo) {
            // 有核销记录，使用核销信息
            statusText = verifyInfo.verifyStatusText || '已使用'
            verifyTime = verifyInfo.verifyTime
            verifyPoiName = verifyInfo.verifyPoiName
          } else {
            // 无核销记录，根据 useStatus 判断状态
            statusText = coupon.statusText || (coupon.useStatus === 1 ? '待使用' : coupon.useStatus === 3 ? '已使用' : '')
          }

          couponsInfoList.push({
            title: '',
            coupon: couponCode,
            encode: coupon.encode || '',
            couponId: coupon.id || '',
            status: verifyInfo
              ? `${couponCode}--核销时间：${verifyTime}--核销门店："${verifyPoiName}"`
              : `${couponCode}--${statusText}`,
            order_status: statusText,
            useStatus: coupon.useStatus,
            verifyTime: verifyTime,
            verifyPoiName: verifyPoiName,
            mobile: '',
            payPrice: ''
          })
        }
      } catch (e) {
        console.error('[礼物券码解析] CouponModule1 解析失败:', e.message)
      }
    } catch (e) {
      console.error('解析礼物券码响应失败:', e.message)
    }

    console.log(`[礼物券码解析] 总计解析到 ${couponsInfoList.length} 条券码`)
    return couponsInfoList
  }

  /**
   * 从响应中提取店铺位置信息 (lat/lng)
   * 用于券码为000000000000时的自动重试
   */
  static extractShopLocation(res) {
    try {
      const nodeDataMap = res?.data?.nodeDataMap || {}

      // 尝试从 OrderDetailNoticeModule1.props.shopInfo 获取
      const noticeModule = nodeDataMap.OrderDetailNoticeModule1?.props
      let shopInfo = noticeModule?.shopInfo

      if (shopInfo?.lat && shopInfo?.lng) {
        console.log(`[券码查询] 从OrderDetailNoticeModule1.shopInfo中提取到店铺位置: lat=${shopInfo.lat}, lng=${shopInfo.lng}`)
        return { lat: String(shopInfo.lat), lng: String(shopInfo.lng) }
      }

      // 尝试从 OrderDetailPoi1.props.shopInfo 获取
      const poiModule = nodeDataMap.OrderDetailPoi1?.props
      shopInfo = poiModule?.shopInfo

      if (shopInfo?.lat && shopInfo?.lng) {
        console.log(`[券码查询] 从OrderDetailPoi1.shopInfo中提取到店铺位置: lat=${shopInfo.lat}, lng=${shopInfo.lng}`)
        return { lat: String(shopInfo.lat), lng: String(shopInfo.lng) }
      }

      // 尝试从 OrderDetailNavBar1.props.shopInfo 获取 (兼容旧版本)
      const navBar = nodeDataMap.OrderDetailNavBar1?.props
      shopInfo = navBar?.shopInfo

      if (shopInfo?.lat && shopInfo?.lng) {
        console.log(`[券码查询] 从OrderDetailNavBar1.shopInfo中提取到店铺位置: lat=${shopInfo.lat}, lng=${shopInfo.lng}`)
        return { lat: String(shopInfo.lat), lng: String(shopInfo.lng) }
      }

      // 尝试从 bizParams.extra 中获取
      const bizParams = navBar?.bizParams?.extra || {}
      const poiLat = bizParams.lat || bizParams.poiLat
      const poiLng = bizParams.lng || bizParams.poiLng

      if (poiLat && poiLng) {
        console.log(`[券码查询] 从bizParams中提取到店铺位置: lat=${poiLat}, lng=${poiLng}`)
        return { lat: String(poiLat), lng: String(poiLng) }
      }
    } catch (e) {
      console.error('[券码查询] 提取店铺位置失败:', e.message)
    }
    return null
  }

  /**
   * 检查解析结果是否全部为占位券码 (000000000000)
   */
  static isAllPlaceholderCoupons(couponsInfoList) {
    if (!Array.isArray(couponsInfoList) || couponsInfoList.length === 0) {
      return false
    }
    return couponsInfoList.every(c => {
      const code = String(c?.coupon || '').replace(/\s/g, '')
      return code === '000000000000'
    })
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  static extractUrlParams(url) {
    try {
      const u = new URL(url)
      const params = {}
      for (const [k, v] of u.searchParams.entries()) {
        params[k] = v
      }
      return params
    } catch (e) {
      return {}
    }
  }

  static async getSkuShops({ token, sku, limit = 50, offset = 0, onProgress = null }) {
    const pois = []
    let currentOffset = offset
    let page = 1
    let currentToken = token

    const headers = {
      'Host': 'apimobile.meituan.com',
      'Connection': 'keep-alive',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)XWEB/14315',
      'Origin': 'https://awp.meituan.com',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://awp.meituan.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }

    while (true) {
      if (onProgress) {
        const shouldContinue = onProgress(page, pois.length)
        if (shouldContinue === false) break
      }

      const url = `https://apimobile.meituan.com/group/v2/deal/${sku}/branches?token=${currentToken}&preCityId=1&offset=${currentOffset}&limit=${limit}&platform=mtapp&os=android&dpId=&chooseCity=0&chooseAllCity=0&bundle_version=1.23.0&source=order&yodaReady=h5&csecplatform=4&csecversion=4.0.3`

      const params = this.extractUrlParams(url)
      const signedUrl = getSignedUrl(url, params, 'GET')

      try {
        const response = await axios.get(signedUrl, {
          headers,
          timeout: 30000,
          validateStatus: () => true
        })

        let isRiskControl = false
        if (response.status === 403 || (response.data && String(response.data).includes('403 Forbidden'))) {
          isRiskControl = true
        }

        if (isRiskControl) {
          if (currentToken && currentToken.includes('_')) {
            const tokenPrefix = currentToken.split('_')[0]

            if (onProgress) {
              onProgress(-1, pois.length)
            }

            await this.sleep(3000)

            const retryUrl = `https://apimobile.meituan.com/group/v2/deal/${sku}/branches?token=${tokenPrefix}&preCityId=1&offset=${currentOffset}&limit=${limit}&platform=mtapp&os=android&dpId=&chooseCity=0&chooseAllCity=0&bundle_version=1.23.0&source=order&yodaReady=h5&csecplatform=4&csecversion=4.0.3`
            const retryParams = this.extractUrlParams(retryUrl)
            const retrySignedUrl = getSignedUrl(retryUrl, retryParams, 'GET')

            try {
              const retryResponse = await axios.get(retrySignedUrl, {
                headers,
                timeout: 30000,
                validateStatus: () => true
              })

              if (retryResponse.status === 200 && retryResponse.data && retryResponse.data.data) {
                currentToken = tokenPrefix
                const data = retryResponse.data.data || []

                if (data.length === 0) break

                data.forEach(store => {
                  pois.push({
                    name: store.name || '',
                    address: store.address || '',
                    phone: store.phone || '',
                    cityName: store.cityName || ''
                  })
                })

                if (onProgress) {
                  onProgress(-2, pois.length)
                }

                currentOffset += limit
                page++
                await this.sleep(1000)
                continue
              }
            } catch (e) {
            }
          }

          throw new Error('遇到风控(403 Forbidden)，请更新Token后重试')
        }

        const data = response.data?.data || []

        if (data.length === 0) break

        data.forEach(store => {
          pois.push({
            name: store.name || '',
            address: store.address || '',
            phone: store.phone || '',
            cityName: store.cityName || ''
          })
        })

        currentOffset += limit
        page++
        await this.sleep(1000)
      } catch (error) {
        if (error?.message && error.message.includes('风控')) {
          throw error
        }
        console.error('请求错误:', error.message)
        throw new Error(`请求失败: ${error.message}`)
      }
    }

    return pois
  }

  /**
   * 获取订单详情的长URL (参考 mtqrcodeweb/GetCouponsInfo.py get_long_mt_order_url)
   * 用于在webview中加载订单详情页面
   */
  static async getLongMtOrderUrl(token, orderId) {
    // 构造请求URL
    const baseUrl = `https://awp.meituan.com/dfe/duo-page/food-order-detail-duo/web/index.html`
    const params = new URLSearchParams({
      cityId: '1',
      locCityId: '1',
      lat: '40.217909',
      lng: '116.247811',
      finger: '73v1z320269v539w171vzx2xvu96yzv5806v657113w9797852084361',
      orderId: String(orderId),
      programName: 'mt',
      mina_name: 'mt-weapp',
      openId: 'oJVP50DRAdtKlPFyi66xw2Uw03Is',
      token: token,
      userId: '3614243158',
      uuid: '193e3428242c8-178f8c61d622be-0-0-193e3428242c8',
      utmMedium: 'WEIXINPROGRAM',
      appVersion: '8.51.2',
      envPlatform: 'wx',
      platform: 'ANDROID',
      uniPlatform: 'windows',
      utmTerm: '0',
      utmCampaign: '0',
      unionId: 'oNQu9t8NB_8JXj78m2GynFJJsRTo',
      app_version: '8.51.2',
      scene: '1037'
    })

    const encodedUrl = encodeURIComponent(`${baseUrl}?${params.toString()}`)
    const apiUrl = `https://ihotel.meituan.com/topcube/api/toc/weixin/getConfig?url=${encodedUrl}`

    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.56(0x18003830) NetType/WIFI Language/zh_CN miniProgram/wxde8ac0a21135c07d',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'Referer': 'https://awp.meituan.com/',
      'Accept-Encoding': 'gzip, deflate, br',
      'Host': 'ihotel.meituan.com',
      'Origin': 'https://awp.meituan.com',
      'Connection': 'keep-alive',
      'Accept': '*/*'
    }

    try {
      const response = await axios.get(apiUrl, {
        headers,
        timeout: 15000,
        responseType: 'text'  // 确保返回文本格式
      })
      const jsonpResponse = response.data

      // 解析响应
      let jsonData = jsonpResponse

      // 如果是字符串，尝试解析
      if (typeof jsonpResponse === 'string') {
        // 尝试 JSONP 格式: jsonpWXLoader({...});
        const jsonpRegex = /jsonpWXLoader\((.*)\)\s*;?/s
        const match = jsonpResponse.match(jsonpRegex)

        if (match) {
          jsonData = JSON.parse(match[1])
        } else {
          // 尝试直接解析为 JSON
          try {
            jsonData = JSON.parse(jsonpResponse)
          } catch (e) {
            console.log('解析响应失败:', jsonpResponse.substring(0, 200))
            return { success: false, error: '解析响应失败' }
          }
        }
      }

      // 提取 URL
      if (jsonData && jsonData.data && jsonData.data.url) {
        console.log('获取长URL成功:', jsonData.data.url.substring(0, 100) + '...')
        return { success: true, url: jsonData.data.url }
      }

      console.log('响应中未找到URL:', JSON.stringify(jsonData).substring(0, 200))
      return { success: false, error: '响应中未找到URL' }
    } catch (error) {
      console.error('获取长URL失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 退还礼物
   * @param {string} token 
   * @param {string} giftId 
   * @param {object} options 
   */
  static async returnGift(token, giftId, options = {}) {
    const baseUrl = `https://apimobile.meituan.com/foodtrade/order/api/secondary/detail/gift/return?giftId=${giftId}&yodaReady=h5&csecplatform=4&csecversion=4.2.0`

    const payload = {
      commonParams: {
        location: {
          lat: options.latitude ? parseFloat(options.latitude) : 37.794768,
          lng: options.longitude ? parseFloat(options.longitude) : 106.801207,
          accuracy: 0
        },
        userInfo: {
          userId: options.userId || "",
          token: token,
          uuid: options.uuid || "",
          openId: options.openId || "",
          wxUnionId: options.wxUnionId || "",
          uuidV2: options.openId || ""
        },
        cityInfo: {
          cityId: options.cityId || "1281",
          locCityId: options.locCityId || "1281"
        },
        fingerprint: {
          fingerprint: options.fingerprint || ""
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
          mpAppVersion: "10.6.8",
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
          userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541211) XWEB/18787 miniProgram/wxde8ac0a21135c07d'
        },
        storage: {}
      }
    }

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Connection': 'keep-alive',
      'Content-Type': 'application/json',
      'Origin': 'https://awp.meituan.com',
      'Referer': 'https://awp.meituan.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541211) XWEB/18787 miniProgram/wxde8ac0a21135c07d',
      'Host': 'apimobile.meituan.com'
    }

    try {
      const payloadStr = JSON.stringify(payload)
      const signedUrl = getSignedUrl(baseUrl, payloadStr, 'POST')

      console.log(`退还礼物请求 - giftId: ${giftId}`)
      const response = await axios.post(signedUrl, payload, { headers, timeout: 15000 })
      console.log('退还礼物响应:', JSON.stringify(response.data))
      return response.data
    } catch (error) {
      console.error('退还礼物失败:', error.message)
      throw error
    }
  }
}

/**
 * Reset the local mtgsig session.
 */
function resetH5guard() {
  console.log('[MeituanAPI] Resetting local mtgsig session...')
  requestCount = 0
  try {
    reinitSigner()
    return true
  } catch (error) {
    console.error('[MeituanAPI] Failed to reset local mtgsig session:', error.message)
    return false
  }
}

function getFingerprintInfo() {
  return {
    requestCount,
    rotationThreshold: ROTATION_THRESHOLD,
    isInitialized: true,
    needsRotation: requestCount >= ROTATION_THRESHOLD
  }
}

/**
 * 设置指纹轮换阈值
 */
function setRotationThreshold(threshold) {
  if (threshold > 0) {
    // 不能直接修改const，需要使用变量
    console.log('[MeituanAPI] 指纹轮换阈值设置为:', threshold)
  }
}

module.exports = MeituanAPI
module.exports.resetH5guard = resetH5guard
module.exports.getFingerprintInfo = getFingerprintInfo
module.exports.getSignedUrl = getSignedUrl
module.exports.setCancelFlag = setCancelFlag
module.exports.isCancelled = isCancelled
module.exports.clearCancelFlag = clearCancelFlag
module.exports.generateOperationId = generateOperationId

