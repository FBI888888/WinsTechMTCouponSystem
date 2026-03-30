/**
 * 代理服务模块 - 用于礼物监控抓包
 */
const http = require('http')
const https = require('https')
const net = require('net')
const tls = require('tls')
const zlib = require('zlib')
const { execSync } = require('child_process')
const forge = require('node-forge')
const path = require('path')
const fs = require('fs')
const MeituanAPI = require('./meituanAPI')

class ProxyService {
  constructor() {
    this.giftMonitorServer = null
    this.giftMonitorCallback = null
    this.capturedCoupons = new Set()
    this.caKey = null
    this.caCert = null
    // Token抓取相关
    this.tokenCaptureServer = null
    this.tokenCaptureResolve = null
    this.tokenCaptureStopped = false
  }

  getCertDir() {
    // 使用用户目录，避免打包后process.cwd()指向只读的安装目录
    const userDir = process.env.USERPROFILE || process.env.HOME
    const certDir = path.join(userDir, '.mtqrcode-certs')
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true })
    }
    return certDir
  }

  generateCA() {
    if (this.caKey && this.caCert) return

    const certDir = this.getCertDir()
    const caKeyPath = path.join(certDir, 'ca.key')
    const caCertPath = path.join(certDir, 'ca.crt')

    if (fs.existsSync(caKeyPath) && fs.existsSync(caCertPath)) {
      try {
        const keyPem = fs.readFileSync(caKeyPath, 'utf8')
        const certPem = fs.readFileSync(caCertPath, 'utf8')
        this.caKey = forge.pki.privateKeyFromPem(keyPem)
        this.caCert = forge.pki.certificateFromPem(certPem)
        return
      } catch (e) { }
    }

    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)

    const attrs = [
      { name: 'commonName', value: 'MtQrcodeTools CA' },
      { name: 'organizationName', value: 'MtQrcodeTools' }
    ]

    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true }
    ])

    cert.sign(keys.privateKey, forge.md.sha256.create())

    this.caKey = keys.privateKey
    this.caCert = cert

    fs.writeFileSync(caKeyPath, forge.pki.privateKeyToPem(keys.privateKey))
    fs.writeFileSync(caCertPath, forge.pki.certificateToPem(cert))
  }

  installCACert() {
    const certDir = this.getCertDir()
    const caCertPath = path.join(certDir, 'ca.crt')

    if (!fs.existsSync(caCertPath)) {
      return false
    }

    // 计算当前CA证书的指纹
    const currentCertPem = fs.readFileSync(caCertPath, 'utf8')
    const currentCert = forge.pki.certificateFromPem(currentCertPem)
    const currentFingerprint = forge.md.sha1.create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(currentCert)).getBytes())
      .digest().toHex().toUpperCase()

    try {
      const checkResult = execSync(
        `certutil -store -user ROOT "MtQrcodeTools CA"`,
        { stdio: 'pipe', windowsHide: true, encoding: 'utf8' }
      )
      if (checkResult.includes('MtQrcodeTools CA')) {
        // 检查系统中证书的指纹是否与当前CA匹配
        if (checkResult.includes(currentFingerprint.replace(/(.{2})/g, '$1 ').trim())) {
          return true // 证书匹配，无需重新安装
        }
        // 指纹不匹配，需要删除旧证书
        console.log('[证书] 检测到证书不匹配，正在更新...')
        try {
          execSync(
            `certutil -delstore -user ROOT "MtQrcodeTools CA"`,
            { stdio: 'pipe', windowsHide: true }
          )
        } catch (e) { }
      }
    } catch (e) { }

    try {
      execSync(
        `certutil -addstore -user -f "ROOT" "${caCertPath}"`,
        { stdio: 'pipe', windowsHide: true }
      )
      console.log('[证书] CA证书已安装到系统')
      return true
    } catch (e) {
      console.error('证书安装失败:', e.message)
      return false
    }
  }

  resetCertificates() {
    // 停止监控
    this.stopGiftMonitor()

    // 清除内存中的证书
    this.caKey = null
    this.caCert = null

    const certDir = this.getCertDir()
    const caKeyPath = path.join(certDir, 'ca.key')
    const caCertPath = path.join(certDir, 'ca.crt')

    // 先从系统中删除证书
    try {
      execSync(
        `certutil -delstore -user ROOT "MtQrcodeTools CA"`,
        { stdio: 'pipe', windowsHide: true }
      )
      console.log('[证书] 已从系统中删除旧证书')
    } catch (e) {
      // 可能不存在，忽略
    }

    // 删除本地证书文件
    try {
      if (fs.existsSync(caKeyPath)) fs.unlinkSync(caKeyPath)
      if (fs.existsSync(caCertPath)) fs.unlinkSync(caCertPath)
      console.log('[证书] 已删除本地证书文件')
    } catch (e) {
      console.error('[证书] 删除本地文件失败:', e.message)
    }

    // 重新生成并安装
    this.generateCA()
    const installed = this.installCACert()

    return { success: installed, certPath: caCertPath }
  }

  generateCertForHost(hostname) {
    this.generateCA()

    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = Date.now().toString(16)
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

    cert.setSubject([{ name: 'commonName', value: hostname }])
    cert.setIssuer(this.caCert.subject.attributes)
    cert.setExtensions([
      { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }
    ])

    cert.sign(this.caKey, forge.md.sha256.create())

    return {
      key: forge.pki.privateKeyToPem(keys.privateKey),
      cert: forge.pki.certificateToPem(cert)
    }
  }

  startGiftMonitor(port, callback) {
    return new Promise((resolve, reject) => {
      let settled = false
      const safeResolve = (v) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      const safeReject = (e) => {
        if (settled) return
        settled = true
        reject(e)
      }

      this.giftMonitorCallback = callback
      this.capturedCoupons.clear()

      if (this.giftMonitorServer) {
        this.stopGiftMonitor()
      }

      try {
        this.log('开始初始化证书...')
        this.generateCA()
        this.log('证书生成/加载完成，开始安装到系统...')
        const certInstalled = this.installCACert()
        if (certInstalled) {
          this.log('CA证书已安装到系统')
        } else {
          this.log('警告: CA证书安装失败，HTTPS抓包可能无法正常工作')
        }
        this.log('证书初始化完成')
      } catch (e) {
        safeReject(new Error(`证书配置失败: ${e.message}`))
        return
      }

      const certCache = {}

      this.giftMonitorServer = http.createServer()

      this.giftMonitorServer.on('connect', (req, clientSocket, head) => {
        const [hostname, portStr] = req.url.split(':')
        const targetPort = parseInt(portStr) || 443

        const isMeituanDomain = hostname.includes('meituan.com') || hostname.includes('dianping.com')

        if (isMeituanDomain) {
          console.log(`[礼物监控] 拦截: ${hostname}`)

          if (!certCache[hostname]) {
            certCache[hostname] = this.generateCertForHost(hostname)
          }
          const { key, cert } = certCache[hostname]

          // 连接到真实服务器
          const serverSocket = tls.connect({
            host: hostname,
            port: targetPort,
            rejectUnauthorized: false
          }, () => {
            // 服务器连接成功后，通知客户端并建立TLS
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

            const tlsSocket = new tls.TLSSocket(clientSocket, {
              isServer: true,
              key: key,
              cert: cert
            })

            // 用于收集响应并解析礼物数据
            let currentRequestIsGiftDetail = false
            let responseChunks = []
            let parseTimer = null
            let connectionClosed = false

            // 安全写入函数
            const safeWrite = (socket, data) => {
              if (connectionClosed || socket.destroyed || !socket.writable) return false
              try {
                socket.write(data)
                return true
              } catch (e) {
                return false
              }
            }

            const tryParseResponse = () => {
              if (responseChunks.length === 0) return

              try {
                const fullResponse = Buffer.concat(responseChunks)
                const fullResponseStr = fullResponse.toString()
                const headerEnd = fullResponseStr.indexOf('\r\n\r\n')

                if (headerEnd > 0) {
                  const headers = fullResponseStr.substring(0, headerEnd).toLowerCase()
                  let bodyBuffer = fullResponse.slice(headerEnd + 4)

                  const isGzip = headers.includes('content-encoding: gzip')

                  if (headers.includes('transfer-encoding: chunked')) {
                    bodyBuffer = this.parseChunkedBuffer(bodyBuffer)
                  }

                  let body = ''

                  if (isGzip) {
                    try {
                      body = zlib.gunzipSync(bodyBuffer).toString('utf8')
                    } catch (e) {
                      return
                    }
                  } else {
                    body = bodyBuffer.toString('utf8')
                  }

                  this.parseGiftData(body)
                }
              } catch (e) {
                console.error('[礼物监控] 解析响应失败:', e.message)
              }

              // 重置状态
              responseChunks = []
              currentRequestIsGiftDetail = false
            }

            // 客户端 -> 服务器
            tlsSocket.on('data', (data) => {
              if (connectionClosed) return

              const reqStr = data.toString()

              // 检查是否是新的HTTP请求（以HTTP方法开头）
              if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s/.test(reqStr)) {
                // 先处理上一个请求的响应
                if (currentRequestIsGiftDetail && responseChunks.length > 0) {
                  if (parseTimer) clearTimeout(parseTimer)
                  tryParseResponse()
                }

                // 检查新请求是否是礼物详情接口
                currentRequestIsGiftDetail = reqStr.includes('foodtrade/order/api/detail/preview')
                if (currentRequestIsGiftDetail) {
                  console.log('[礼物监控] 检测到礼物详情请求')
                }
                responseChunks = []
              }

              safeWrite(serverSocket, data)
            })

            // 服务器 -> 客户端
            serverSocket.on('data', (serverData) => {
              if (connectionClosed) return

              safeWrite(tlsSocket, serverData)

              if (currentRequestIsGiftDetail) {
                responseChunks.push(serverData)
                if (parseTimer) clearTimeout(parseTimer)
                parseTimer = setTimeout(tryParseResponse, 300)
              }
            })

            const cleanup = () => {
              connectionClosed = true
              if (parseTimer) clearTimeout(parseTimer)
              if (currentRequestIsGiftDetail) {
                tryParseResponse()
              }
            }

            tlsSocket.on('end', () => {
              cleanup()
              if (!serverSocket.destroyed) serverSocket.end()
            })

            serverSocket.on('end', () => {
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.end()
            })

            tlsSocket.on('close', () => {
              cleanup()
              if (!serverSocket.destroyed) serverSocket.destroy()
            })

            serverSocket.on('close', () => {
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.destroy()
            })

            tlsSocket.on('error', (e) => {
              // 忽略常见的连接中断错误
              if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
                console.error('[礼物监控] TLS客户端错误:', e.message)
              }
              cleanup()
              if (!serverSocket.destroyed) serverSocket.destroy()
            })

            serverSocket.on('error', (e) => {
              // 忽略常见的连接中断错误
              if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
                console.error('[礼物监控] TLS服务器错误:', e.message)
              }
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.destroy()
            })
          })

          serverSocket.on('error', (e) => {
            // 忽略常见的连接中断错误
            if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
              console.error('[礼物监控] 连接服务器失败:', e.message)
            }
            if (!clientSocket.destroyed) clientSocket.destroy()
          })
        } else {
          // 非美团域名直接透传
          const serverSocket = net.connect(targetPort, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            serverSocket.write(head)
            serverSocket.pipe(clientSocket)
            clientSocket.pipe(serverSocket)
          })
          serverSocket.on('error', () => clientSocket.end())
        }
      })

      this.giftMonitorServer.on('error', (err) => {
        this.error(`代理错误: ${err.message}`)
        safeReject(err)
      })

      this.giftMonitorServer.listen(port, '127.0.0.1', () => {
        this.log(`HTTPS代理已启动，端口: ${port}`)
        this.setSystemProxy(port, true)
        this.log('系统代理已设置，请在美团APP中打开礼物订单详情...')
        safeResolve({ success: true })
      })
    })
  }

  parseChunkedBuffer(buffer) {
    try {
      const chunks = []
      let offset = 0
      const str = buffer.toString()

      while (offset < buffer.length) {
        const lineEnd = str.indexOf('\r\n', offset)
        if (lineEnd === -1) break

        const sizeStr = str.substring(offset, lineEnd).trim()
        const chunkSize = parseInt(sizeStr, 16)

        if (isNaN(chunkSize) || chunkSize === 0) break

        const dataStart = lineEnd + 2
        const dataEnd = dataStart + chunkSize

        if (dataEnd > buffer.length) break

        chunks.push(buffer.slice(dataStart, dataEnd))
        offset = dataEnd + 2
      }

      return chunks.length > 0 ? Buffer.concat(chunks) : buffer
    } catch (e) {
      return buffer
    }
  }

  parseGiftData(body) {
    try {
      const data = JSON.parse(body)
      console.log('[礼物监控] 开始解析数据，keys:', Object.keys(data))

      const innerData = data.data || {}
      const nodeDataMap = innerData.nodeDataMap || {}

      // 提取giftid - 从多个可能的位置尝试
      let giftid = ''

      // 尝试从OrderDetailNavBar1获取
      const navProps = nodeDataMap.OrderDetailNavBar1?.props || {}
      const giftInfo = navProps.giftInfo || {}
      giftid = giftInfo.giftId || ''

      console.log(`[礼物监控] giftid: ${giftid}`)

      // 提取coupons列表 - 从CouponModule1获取
      const couponModule = nodeDataMap.CouponModule1 || {}
      const couponProps = couponModule.props || {}
      let coupons = couponProps.coupons || []

      console.log(`[礼物监控] coupons数量: ${coupons.length}`)

      if (!coupons.length) {
        console.log('[礼物监控] ⚠️ 未找到coupons列表，尝试旧结构')
        // 尝试从旧数据结构获取（向后兼容）
        coupons = data.coupons || []

        if (coupons.length) {
          console.log(`[礼物监控] 从旧结构中找到 ${coupons.length} 个券码`)
          // 同时尝试从旧结构获取giftid
          if (!giftid) {
            giftid = data.giftid || data.giftId || ''
          }
        } else {
          return
        }
      }

      // 检查是否全部为占位券码 (000000000000)
      const allPlaceholder = coupons.length > 0 && coupons.every(c => {
        const code = String(c.code || c.encode || '').replace(/\s/g, '')
        return code === '000000000000'
      })

      if (allPlaceholder) {
        console.log('[礼物监控] ⚠️ 检测到全部券码为000000000000，尝试提取店铺位置重新查询...')
        this.log('检测到占位券码，正在使用店铺位置重新获取真实券码...')

        // 提取店铺位置
        const shopLocation = MeituanAPI.extractShopLocation(data)

        // 提取token - 从多个可能的位置尝试
        let token = ''
        // 从 MeishiBizOrderDetailPage1.props.pageQuery.token 获取
        const pageProps = nodeDataMap.MeishiBizOrderDetailPage1?.props || {}
        token = pageProps.pageQuery?.token || ''
        // 兜底：从 OrderDetailNavBar1.props.shopInfo 相关的 valLab 中获取
        if (!token) {
          token = navProps.lxCommonParams?.valLab?.token || ''
        }
        // 再兜底：尝试从 commonParams 获取
        if (!token) {
          token = pageProps.pageQuery?.token || ''
        }

        console.log(`[礼物监控] 提取到token: ${token ? token.substring(0, 20) + '...' : '无'}`)
        console.log(`[礼物监控] 提取到shopLocation: ${shopLocation ? `lat=${shopLocation.lat}, lng=${shopLocation.lng}` : '无'}`)

        if (shopLocation && shopLocation.lat && shopLocation.lng && token && giftid) {
          // 异步发起重新查询，不阻塞代理流程
          this.retryWithShopLocation(token, giftid, shopLocation)
            .catch(e => console.error('[礼物监控] 使用店铺位置重新查询失败:', e.message))
          return // 不发送占位券码，等待重新查询结果
        } else {
          console.log('[礼物监控] ⚠️ 无法提取到足够的信息进行重新查询，将发送占位券码')
          this.log('无法自动重新查询（缺少token或店铺位置），显示占位券码')
        }
      }

      for (const couponItem of coupons) {
        const couponCode = couponItem.code || couponItem.encode || ''

        if (couponCode && !this.capturedCoupons.has(couponCode)) {
          this.capturedCoupons.add(couponCode)

          const record = {
            giftid: giftid,
            coupon: couponCode,
            statusText: couponItem.statusText || '',
            timestamp: new Date().toLocaleString('zh-CN')
          }

          console.log(`[礼物监控] ✅ 捕获新券码: ${couponCode}`)

          if (this.giftMonitorCallback) {
            this.giftMonitorCallback({
              type: 'gift',
              data: record
            })
          }
        } else {
          console.log(`[礼物监控] ⏭️ 券码已存在或无效，跳过: ${couponCode}`)
        }
      }
    } catch (e) {
      console.error('[礼物监控] 解析礼物数据失败:', e.message)
    }
  }

  /**
   * 使用店铺位置重新发起请求获取真实券码
   * @param {string} token - 用户token
   * @param {string} giftId - 礼物ID
   * @param {object} shopLocation - { lat, lng }
   */
  async retryWithShopLocation(token, giftId, shopLocation) {
    try {
      console.log(`[礼物监控] 🔄 使用店铺位置重新查询: giftId=${giftId}, lat=${shopLocation.lat}, lng=${shopLocation.lng}`)
      this.log(`使用店铺位置(${shopLocation.lat}, ${shopLocation.lng})重新签名查询中...`)

      // 短暂延迟避免请求过于频繁
      await new Promise(r => setTimeout(r, 500))

      // 使用 MeituanAPI.getGiftCouponList 进行带签名的重新查询
      const result = await MeituanAPI.getGiftCouponList(token, giftId, {
        longitude: shopLocation.lng,
        latitude: shopLocation.lat,
        _shopLocationRetried: true // 标记已经使用店铺位置重试，避免无限递归
      })

      const retryCoupons = result.coupons || []
      console.log(`[礼物监控] 重新查询结果数量: ${retryCoupons.length}`)

      // 检查重试结果是否仍然是占位券码
      const stillPlaceholder = MeituanAPI.isAllPlaceholderCoupons(retryCoupons)

      if (retryCoupons.length > 0 && !stillPlaceholder) {
        console.log('[礼物监控] ✅ 使用店铺位置重新查询成功，获取到真实券码')
        this.log('成功获取到真实券码！')

        for (const couponInfo of retryCoupons) {
          const couponCode = couponInfo.coupon || ''
          if (couponCode && !this.capturedCoupons.has(couponCode)) {
            this.capturedCoupons.add(couponCode)

            const record = {
              giftid: giftId,
              coupon: couponCode,
              statusText: couponInfo.order_status || couponInfo.status || '',
              timestamp: new Date().toLocaleString('zh-CN')
            }

            console.log(`[礼物监控] ✅ 捕获真实券码: ${couponCode}`)

            if (this.giftMonitorCallback) {
              this.giftMonitorCallback({
                type: 'gift',
                data: record
              })
            }
          }
        }
      } else {
        console.log('[礼物监控] ⚠️ 使用店铺位置重新查询仍为占位券码')
        this.log('使用店铺位置重新查询仍为占位券码，请手动查看')

        // 仍然发送占位券码（已经无法自动修复）
        const placeholderRecord = {
          giftid: giftId,
          coupon: '000000000000',
          statusText: '占位券码(自动重试失败)',
          timestamp: new Date().toLocaleString('zh-CN')
        }

        if (!this.capturedCoupons.has('000000000000')) {
          this.capturedCoupons.add('000000000000')
          if (this.giftMonitorCallback) {
            this.giftMonitorCallback({
              type: 'gift',
              data: placeholderRecord
            })
          }
        }
      }
    } catch (e) {
      console.error('[礼物监控] 使用店铺位置重新查询异常:', e.message)
      this.log(`使用店铺位置重新查询失败: ${e.message}`)

      // 失败时发送占位券码
      const placeholderRecord = {
        giftid: giftId,
        coupon: '000000000000',
        statusText: `占位券码(重试失败: ${e.message})`,
        timestamp: new Date().toLocaleString('zh-CN')
      }

      if (!this.capturedCoupons.has('000000000000')) {
        this.capturedCoupons.add('000000000000')
        if (this.giftMonitorCallback) {
          this.giftMonitorCallback({
            type: 'gift',
            data: placeholderRecord
          })
        }
      }
    }
  }

  stopGiftMonitor() {
    if (this.giftMonitorServer) {
      try {
        this.giftMonitorServer.close()
      } catch (e) { }
      this.giftMonitorServer = null
      this.setSystemProxy(0, false)
      this.log('代理已停止')
    }
  }

  // ==================== Token抓取功能 ====================
  startTokenCapture(port = 8898) {
    return new Promise((resolve, reject) => {
      this.tokenCaptureStopped = false
      this.tokenCaptureResolve = resolve

      if (this.tokenCaptureServer) {
        // 先清理旧服务器，但不触发resolve
        try {
          this.tokenCaptureServer.close()
        } catch (e) { }
        this.tokenCaptureServer = null
        this.setSystemProxy(0, false)
      }

      try {
        this.generateCA()
        this.installCACert()
      } catch (e) {
        this.setSystemProxy(0, false) // 确保代理被关闭
        reject(new Error(`证书配置失败: ${e.message}`))
        return
      }

      const certCache = {}

      this.tokenCaptureServer = http.createServer()

      this.tokenCaptureServer.on('connect', (req, clientSocket, head) => {
        const [hostname, portStr] = req.url.split(':')
        const targetPort = parseInt(portStr) || 443

        // 只拦截peppermall.meituan.com进行MITM
        const isPeppermall = hostname === 'peppermall.meituan.com'

        if (isPeppermall) {
          console.log(`[Token抓取] 拦截: ${hostname}`)

          if (!certCache[hostname]) {
            certCache[hostname] = this.generateCertForHost(hostname)
          }
          const { key, cert } = certCache[hostname]

          const serverSocket = tls.connect({
            host: hostname,
            port: targetPort,
            rejectUnauthorized: false
          }, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

            const tlsSocket = new tls.TLSSocket(clientSocket, {
              isServer: true,
              key: key,
              cert: cert
            })

            let connectionClosed = false

            const safeWrite = (socket, data) => {
              if (connectionClosed || socket.destroyed || !socket.writable) return false
              try {
                socket.write(data)
                return true
              } catch (e) {
                return false
              }
            }

            // 客户端 -> 服务器
            tlsSocket.on('data', (data) => {
              if (connectionClosed || this.tokenCaptureStopped) return

              const reqStr = data.toString()

              // 检查是否是HTTP请求
              if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s/.test(reqStr)) {
                // 解析请求头，查找csecuserid和token
                const headerLines = reqStr.split('\r\n')
                let csecuserid = ''
                let token = ''

                for (const line of headerLines) {
                  const lowerLine = line.toLowerCase()
                  if (lowerLine.startsWith('csecuserid:')) {
                    csecuserid = line.substring(11).trim()
                  } else if (lowerLine.startsWith('token:')) {
                    token = line.substring(6).trim()
                  }
                }

                if (csecuserid && token) {
                  console.log(`[Token抓取] ✅ 找到Token! csecuserid=${csecuserid}`)

                  // 构建URL
                  const resultUrl = `https://i.meituan.com/mttouch/page/account?cevent=imt%2Fhomepage%2Fmine&userId=${csecuserid}&token=${token}`

                  // 先保存resolve引用，再清理
                  const resolveFunc = this.tokenCaptureResolve
                  this.tokenCaptureResolve = null

                  // 停止抓包（不会再触发resolve因为已经置空）
                  this.stopTokenCapture()

                  // 返回结果
                  if (resolveFunc) {
                    resolveFunc({ success: true, url: resultUrl })
                  }
                  return
                }
              }

              safeWrite(serverSocket, data)
            })

            // 服务器 -> 客户端
            serverSocket.on('data', (serverData) => {
              if (connectionClosed) return
              safeWrite(tlsSocket, serverData)
            })

            const cleanup = () => {
              connectionClosed = true
            }

            tlsSocket.on('end', () => {
              cleanup()
              if (!serverSocket.destroyed) serverSocket.end()
            })

            serverSocket.on('end', () => {
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.end()
            })

            tlsSocket.on('close', () => {
              cleanup()
              if (!serverSocket.destroyed) serverSocket.destroy()
            })

            serverSocket.on('close', () => {
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.destroy()
            })

            tlsSocket.on('error', (e) => {
              if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
                console.error('[Token抓取] TLS客户端错误:', e.message)
              }
              cleanup()
              if (!serverSocket.destroyed) serverSocket.destroy()
            })

            serverSocket.on('error', (e) => {
              if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
                console.error('[Token抓取] TLS服务器错误:', e.message)
              }
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.destroy()
            })
          })

          serverSocket.on('error', (e) => {
            if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
              console.error('[Token抓取] 连接服务器失败:', e.message)
            }
            if (!clientSocket.destroyed) clientSocket.destroy()
          })
        } else {
          // 非目标域名直接TCP透传（不做MITM，避免证书问题）
          const serverSocket = net.connect(targetPort, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            serverSocket.write(head)
            serverSocket.pipe(clientSocket)
            clientSocket.pipe(serverSocket)
          })
          serverSocket.on('error', (e) => {
            if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
              console.error(`[Token抓取] 透传连接失败 ${hostname}: ${e.message}`)
            }
            if (!clientSocket.destroyed) clientSocket.end()
          })
          clientSocket.on('error', (e) => {
            if (!['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(e.code)) {
              console.error(`[Token抓取] 客户端连接错误 ${hostname}: ${e.message}`)
            }
            if (!serverSocket.destroyed) serverSocket.end()
          })
        }
      })

      // 处理普通HTTP请求（直接透传）
      this.tokenCaptureServer.on('request', (req, res) => {
        const targetUrl = req.url
        console.log(`[Token抓取] HTTP请求: ${req.method} ${targetUrl}`)

        try {
          const parsedUrl = new URL(targetUrl)
          const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 80,
            path: parsedUrl.pathname + parsedUrl.search,
            method: req.method,
            headers: req.headers
          }

          const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers)
            proxyRes.pipe(res)
          })

          proxyReq.on('error', (e) => {
            console.error(`[Token抓取] HTTP代理错误: ${e.message}`)
            res.writeHead(502)
            res.end('Bad Gateway')
          })

          req.pipe(proxyReq)
        } catch (e) {
          res.writeHead(400)
          res.end('Bad Request')
        }
      })

      this.tokenCaptureServer.on('error', (err) => {
        console.error(`[Token抓取] 代理错误: ${err.message}`)
        reject(err)
      })

      this.tokenCaptureServer.listen(port, '127.0.0.1', () => {
        console.log(`[Token抓取] HTTPS代理已启动，端口: ${port}`)
        this.setSystemProxy(port, true)
        console.log('[Token抓取] 系统代理已设置，请打开美团联盟任意链接...')
      })
    })
  }

  stopTokenCapture() {
    this.tokenCaptureStopped = true
    if (this.tokenCaptureServer) {
      try {
        this.tokenCaptureServer.close()
      } catch (e) { }
      this.tokenCaptureServer = null
      this.setSystemProxy(0, false)
      console.log('[Token抓取] 代理已停止')
    }
    // 只有当resolve还存在时才调用（用户手动停止的情况）
    if (this.tokenCaptureResolve) {
      this.tokenCaptureResolve({ stopped: true })
      this.tokenCaptureResolve = null
    }
  }

  stop() {
    this.stopGiftMonitor()
    this.stopTokenCapture()
  }

  // 确保代理被禁用（应用启动时调用，清理可能残留的代理设置）
  ensureProxyDisabled() {
    this.setSystemProxy(0, false)
  }

  setSystemProxy(port, enable) {
    if (process.platform === 'win32') {
      try {
        if (enable) {
          execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`, { stdio: 'pipe', windowsHide: true })
          execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:${port}" /f`, { stdio: 'pipe', windowsHide: true })
        } else {
          execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`, { stdio: 'pipe', windowsHide: true })
        }
      } catch (e) {
        console.error('设置系统代理失败:', e.message)
      }
    }
  }

  log(message) {
    console.log(`[礼物监控] ${message}`)
    if (this.giftMonitorCallback) {
      this.giftMonitorCallback({ type: 'log', message })
    }
  }

  error(message) {
    if (this.giftMonitorCallback) {
      this.giftMonitorCallback({ type: 'error', message })
    }
  }
}

module.exports = ProxyService
