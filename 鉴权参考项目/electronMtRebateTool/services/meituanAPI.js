const axios = require('axios')

class MeituanAPI {
  static async checkCKStatus(userid, token) {
    const url = `https://ordercenter.meituan.com/ordercenter/user/orders?userid=${userid}&token=${token}&offset=0&limit=10&platformid=6&statusFilter=0&version=0&yodaReady=wx&csecappid=wxde8ac0a21135c07d&csecplatform=3&csecversionname=9.25.105&csecversion=1.4.0`

    const headers = {
      Host: 'ordercenter.meituan.com',
      Connection: 'keep-alive',
      'User-Agent': '',
      xweb_xhr: '1',
      utm_medium: '',
      clientversion: '3.8.9',
      Accept: '*/*',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      Referer: 'https://servicewechat.com/wxde8ac0a21135c07d/1451/page-frame.html',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }

    try {
      const response = await axios.get(url, { headers, timeout: 10000 })
      const code = response.data?.code
      if (code === 0) return 0
      return code !== undefined ? code : -1
    } catch (error) {
      return -1
    }
  }
}

module.exports = MeituanAPI
