const fs = require('fs')
const vm = require('vm')

class MtGsigClient {
  static _instance = null

  static getInstance(mtgsigFilePath) {
    if (!this._instance) {
      this._instance = new MtGsigClient(mtgsigFilePath)
    }
    return this._instance
  }

  constructor(mtgsigFilePath) {
    this.mtgsigFilePath = mtgsigFilePath
    this._ctx = null
  }

  _ensureContext() {
    if (this._ctx) return

    const code = fs.readFileSync(this.mtgsigFilePath, 'utf-8')

    const sandbox = {
      console,
      fetch: global.fetch,
      Headers: global.Headers,
      Request: global.Request,
      Response: global.Response,
      URL,
      URLSearchParams,
      Buffer,
      module: { exports: {} },
      exports: {},
      require: () => ({}),
      setTimeout,
      clearTimeout
    }

    vm.createContext(sandbox)
    vm.runInContext(code, sandbox, { filename: 'mtgsig.js', timeout: 15000 })

    if (typeof sandbox.get_mt_order_rebate_info !== 'function') {
      throw new Error('mtgsig.js 未暴露 get_mt_order_rebate_info 函数')
    }

    this._ctx = sandbox
  }

  async getOrderRebateInfo({ orderViewId, token, userid, csecuuid, openId, openIdCipher }) {
    this._ensureContext()

    return await this._ctx.get_mt_order_rebate_info(orderViewId, token, userid, {
      csecuuid,
      openId,
      openIdCipher
    })
  }
}

module.exports = MtGsigClient
