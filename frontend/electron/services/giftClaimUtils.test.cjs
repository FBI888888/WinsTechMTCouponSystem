const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeCredential,
  buildPlainGiftRequest,
  extractGiftCardsFromResponse,
  classifyReceiveGiftResponse
} = require('./giftClaimUtils.cjs')
const axios = require('axios')
const MeituanAPI = require('./meituanAPI.cjs')
const giftOrderFixture = require('./fixtures/gift-order-detail.fixture.json')

test('normalizes a credential and requires a supported platform', () => {
  assert.deepEqual(
    normalizeCredential({ userId: ' 123 ', token: ' abc ', platform: 'WINDOWS' }),
    { userId: ' 123 ', userid: '123', token: 'abc', platform: 'windows' }
  )
  assert.throws(() => normalizeCredential({ userId: '1', token: 'x', platform: '' }), /平台/)
})

test('builds the verified plain gift endpoint without encrypted-flow parameters', () => {
  const request = buildPlainGiftRequest('token+/=', '22603138918251785391837')
  const url = new URL(request.url)
  assert.equal(url.pathname, '/api/foodorder/receiveGift')
  assert.equal(url.searchParams.get('giftId'), '22603138918251785391837')
  assert.equal(url.searchParams.get('token'), 'token+/=')
  assert.equal(url.searchParams.get('useNewProcess'), 'true')
  assert.equal(url.searchParams.has('orderId'), false)
  assert.equal(url.searchParams.has('giftIdEncrypt'), false)
  assert.deepEqual(request.body, { token: 'token+/=', useNewProcess: true })
})

test('extracts and deduplicates giftExtra gift IDs from repeated coupon nodes', () => {
  const gifts = extractGiftCardsFromResponse(giftOrderFixture, '5035054672665838166')
  assert.equal(gifts.length, 2)
  assert.equal(gifts[0].gift_id, '22603138918251785391837')
  assert.equal(gifts[0].source_order_id, '5035054672665838166')
  assert.equal(gifts[0].claimable, true)
  assert.equal(gifts[0].status_text, '待好友领取')
  assert.equal(gifts[1].gift_id, '22603138919251785391831')
  assert.equal(gifts[1].claimable, true)
})

test('classifies success, retry, pause, continue and risk responses', () => {
  assert.equal(classifyReceiveGiftResponse({ result: 0, success: true, failed: false }).category, 'success')
  assert.equal(classifyReceiveGiftResponse({ result: 1011, success: false }).category, 'limit')
  assert.equal(classifyReceiveGiftResponse({ result: 1003, success: false }).category, 'transient')
  assert.equal(classifyReceiveGiftResponse({ result: 5083, success: false }).category, 'self_gift')
  assert.equal(classifyReceiveGiftResponse({ result: 5084, success: false }).category, 'unavailable')
  assert.equal(classifyReceiveGiftResponse({}, 418).category, 'risk')
  assert.equal(classifyReceiveGiftResponse({ yodaCode: 406, customData: { generalPageUrl: 'https://verify.meituan.com/x' } }).category, 'risk')
})

test('plain gift service re-signs 1011 and uses the verified legacy Windows request profile', async () => {
  const originalPost = axios.post
  const calls = []
  axios.post = async (url, body, config) => {
    calls.push({ url, body, config })
    if (calls.length <= 5) {
      return { status: 200, data: { result: 1011, success: false, failed: true } }
    }
    return {
      status: 200,
      data: { result: 0, success: true, failed: false, data: { mainText: '领取成功' } }
    }
  }
  try {
    const result = await MeituanAPI.receivePlainGift(
      { token: 'token-test', platform: 'windows' },
      'gift-test',
      { retryDelayMs: 0, wait: async () => {} }
    )
    assert.equal(calls.length, 6)
    assert.equal(result.success, true)
    assert.equal(result.attempts, 6)
    assert.equal(calls[0].body, '{"token": "token-test", "useNewProcess": true}')
    assert.match(calls[0].config.headers.Cookie, /^WEBDFPID=/)
    assert.doesNotMatch(calls[0].config.headers.Cookie, /token=/)
    assert.match(calls[0].config.headers['User-Agent'], /Windows/)
    assert.match(calls[0].url, /giftId=gift-test/)
    assert.match(calls[0].url, /mtgsig=/)
  } finally {
    axios.post = originalPost
  }
})

test('plain gift service re-signs transient 1003 twice before returning', async () => {
  const originalPost = axios.post
  const calls = []
  axios.post = async (url, body, config) => {
    calls.push({ url, body, config })
    return {
      status: 200,
      data: { result: 1003, success: false, failed: true, message: '小美大脑短路了，请稍后重试' }
    }
  }
  try {
    const result = await MeituanAPI.receivePlainGift(
      { token: 'token-test', platform: 'harmony' },
      'gift-transient',
      { transientRetryDelayMs: 0, wait: async () => {} }
    )
    assert.equal(calls.length, 3)
    assert.equal(result.success, false)
    assert.equal(result.category, 'transient')
    assert.equal(result.code, 1003)
    assert.equal(result.attempts, 3)
    assert.notEqual(calls[0].url, calls[1].url)
    assert.match(calls[0].config.headers['User-Agent'], /WindowsWechat/)
    assert.doesNotMatch(calls[0].config.headers['User-Agent'], /HarmonyWechat/)
  } finally {
    axios.post = originalPost
  }
})

test('plain gift service does not retry timeout or non-JSON responses', async () => {
  const originalPost = axios.post
  let calls = 0
  try {
    axios.post = async () => {
      calls += 1
      const error = new Error('timeout of 15000ms exceeded')
      error.code = 'ECONNABORTED'
      throw error
    }
    const timeoutResult = await MeituanAPI.receivePlainGift(
      { token: 'token-test', platform: 'android' },
      'gift-timeout',
      { retryDelayMs: 0, wait: async () => {} }
    )
    assert.equal(calls, 1)
    assert.equal(timeoutResult.category, 'unknown')

    calls = 0
    axios.post = async () => {
      calls += 1
      return { status: 200, data: '<html>gateway response</html>' }
    }
    const nonJsonResult = await MeituanAPI.receivePlainGift(
      { token: 'token-test', platform: 'ios' },
      'gift-non-json',
      { retryDelayMs: 0, wait: async () => {} }
    )
    assert.equal(calls, 1)
    assert.equal(nonJsonResult.category, 'unknown')
  } finally {
    axios.post = originalPost
  }
})

test('gift claim order source requests all statuses without a date limit', async () => {
  const original = MeituanAPI.getOrdersListWithStatus
  let receivedArgs
  MeituanAPI.getOrdersListWithStatus = async (...args) => {
    receivedArgs = args
    return { orders: [], cancelled: false }
  }
  try {
    await MeituanAPI.getGiftOrders(
      { userid: 'user-1', token: 'token-1', platform: 'android' },
      300
    )
    assert.equal(receivedArgs[0], 'user-1')
    assert.equal(receivedArgs[2], null)
    assert.equal(receivedArgs[3], 0)
    assert.equal(receivedArgs[4], 200)
  } finally {
    MeituanAPI.getOrdersListWithStatus = original
  }
})

test('gift order pagination performs exactly one remote request per requested page', async () => {
  const originalGet = axios.get
  const urls = []
  axios.get = async (url) => {
    urls.push(new URL(url))
    const offset = Number(new URL(url).searchParams.get('offset'))
    return {
      data: {
        code: 0,
        data: {
          orders: [
            { orderid: String(1000 + offset), title: `order-${offset}` },
            { orderid: String(1001 + offset), title: `order-${offset + 1}` }
          ]
        }
      }
    }
  }
  try {
    const credential = { userid: 'user-1', token: 'token-1', platform: 'windows' }
    const first = await MeituanAPI.getGiftOrdersPage(credential, 1, 2)
    assert.equal(urls.length, 1)
    assert.equal(urls[0].searchParams.get('offset'), '0')
    assert.equal(urls[0].searchParams.get('limit'), '2')
    assert.equal(urls[0].searchParams.get('statusFilter'), '0')
    assert.equal(first.page, 1)
    assert.equal(first.hasMore, true)

    const second = await MeituanAPI.getGiftOrdersPage(credential, 2, 2)
    assert.equal(urls.length, 2)
    assert.equal(urls[1].searchParams.get('offset'), '2')
    assert.equal(second.page, 2)
  } finally {
    axios.get = originalGet
  }
})
