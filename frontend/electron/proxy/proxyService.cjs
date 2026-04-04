const http = require('http')
const net = require('net')
const tls = require('tls')
const { execSync } = require('child_process')
const forge = require('node-forge')
const path = require('path')
const fs = require('fs')

class ProxyService {
  constructor() {
    this.caKey = null
    this.caCert = null
    this.tokenCaptureServer = null
    this.tokenCaptureResolve = null
    this.tokenCaptureStopped = false
  }

  getCertDir() {
    const userDir = process.env.USERPROFILE || process.env.HOME
    const certDir = path.join(userDir, '.mtrebate-certs')
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true })
    }
    return certDir
  }

  async resetCertificates() {
    this.caKey = null
    this.caCert = null

    const certDir = this.getCertDir()
    const caKeyPath = path.join(certDir, 'ca.key')
    const caCertPath = path.join(certDir, 'ca.crt')

    try {
      execSync('certutil -delstore -user ROOT "MtRebateTools CA"', { stdio: 'pipe', windowsHide: true })
    } catch (e) {}

    try {
      if (fs.existsSync(caKeyPath)) fs.unlinkSync(caKeyPath)
      if (fs.existsSync(caCertPath)) fs.unlinkSync(caCertPath)
    } catch (e) {
      console.error('删除证书文件失败:', e)
      return { success: false, error: e.message }
    }

    return { success: true }
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
      } catch (e) {}
    }

    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)

    const attrs = [
      { name: 'commonName', value: 'MtRebateTools CA' },
      { name: 'organizationName', value: 'MtRebateTools' }
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

    const currentCertPem = fs.readFileSync(caCertPath, 'utf8')
    const currentCert = forge.pki.certificateFromPem(currentCertPem)
    const currentFingerprint = forge.md.sha1.create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(currentCert)).getBytes())
      .digest().toHex().toLowerCase()

    try {
      const checkResult = execSync(
        'certutil -store -user ROOT "MtRebateTools CA"',
        { stdio: 'pipe', windowsHide: true, encoding: 'utf8' }
      )
      if (checkResult.includes('MtRebateTools CA')) {
        const hashMatch = checkResult.match(/\(sha1\)\s*[:：]\s*([a-fA-F0-9\s]+)/i)
        if (hashMatch) {
          const systemFingerprint = hashMatch[1].replace(/\s+/g, '').toLowerCase()
          if (systemFingerprint === currentFingerprint) {
            console.log('[证书] 证书指纹匹配，无需重新安装')
            return true
          }
          console.log('[证书] 指纹不匹配')
          console.log('[证书] 系统:', systemFingerprint)
          console.log('[证书] 文件:', currentFingerprint)
        }
        console.log('[证书] 正在更新证书...')
        try {
          execSync('certutil -delstore -user ROOT "MtRebateTools CA"', { stdio: 'pipe', windowsHide: true })
        } catch (e) {}
      }
    } catch (e) {
      console.log('[证书] 系统中未找到证书，将进行安装')
    }

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
    cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }])

    cert.sign(this.caKey, forge.md.sha256.create())

    return {
      key: forge.pki.privateKeyToPem(keys.privateKey),
      cert: forge.pki.certificateToPem(cert)
    }
  }

  isTargetDomain(hostname = '') {
    return hostname.includes('meituan.com') ||
      hostname.includes('dianping.com') ||
      hostname.includes('maoyan.com') ||
      hostname.includes('neixin.cn')
  }

  safeDecode(value) {
    try {
      return decodeURIComponent(value)
    } catch (e) {
      return value
    }
  }

  extractUrlParamsFromRequestLine(firstLine = '') {
    const urlMatch = firstLine.match(/(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+(\S+)/)
    if (!urlMatch) {
      return {}
    }

    const requestPath = urlMatch[1]
    const queryIndex = requestPath.indexOf('?')
    if (queryIndex === -1) {
      return {}
    }

    const queryString = requestPath.substring(queryIndex + 1)
    const params = {}
    queryString.split('&').forEach((pair) => {
      const [rawKey, ...rest] = pair.split('=')
      if (!rawKey || rest.length === 0) {
        return
      }
      const rawValue = rest.join('=')
      params[this.safeDecode(rawKey)] = this.safeDecode(rawValue)
    })

    return params
  }

  extractAuthHeaders(lines = []) {
    const result = {
      token: '',
      openId: '',
      openIdCipher: '',
      csecuuid: '',
      userId: ''
    }

    lines.forEach((line) => {
      if (!line.includes(':')) {
        return
      }

      const colonIndex = line.indexOf(':')
      const headerName = line.substring(0, colonIndex).trim().toLowerCase()
      const headerValue = line.substring(colonIndex + 1).trim()
      if (!headerValue) {
        return
      }

      if (headerName === 'token') {
        result.token = headerValue
      } else if (headerName === 'openid') {
        result.openId = headerValue
      } else if (headerName === 'openidcipher') {
        result.openIdCipher = headerValue
      } else if (headerName === 'csecuuid') {
        result.csecuuid = headerValue
      } else if (headerName === 'csecuserid') {
        result.userId = headerValue
      }
    })

    return result
  }

  buildCaptureResult({ token = '', openId = '', openIdCipher = '', csecuuid = '', userId = '', urlParams = {} }) {
    const resolvedUserId = userId || urlParams.userId || urlParams.userid || ''
    const cityId = urlParams.ci || urlParams.cityId || urlParams.cityid || ''
    const position = (urlParams.lat && urlParams.lng) ? `${urlParams.lat},${urlParams.lng}` : ''

    return {
      success: true,
      url: `https://i.meituan.com/mttouch/page/account?cevent=imt%2Fhomepage%2Fmine&userId=${resolvedUserId}&token=${token}`,
      userid: resolvedUserId,
      token,
      csecuuid,
      openId,
      openIdCipher,
      uuid: urlParams.uuid || '',
      ci: cityId,
      mypos: position,
      authHeaders: {
        token,
        openId,
        openIdCipher,
        csecuuid,
        userId: resolvedUserId,
        uuid: urlParams.uuid || '',
        ci: cityId,
        mypos: position
      }
    }
  }

  async startCapture(port = 8898) {
    return new Promise((resolve, reject) => {
      this.tokenCaptureStopped = false
      this.tokenCaptureResolve = resolve

      if (this.tokenCaptureServer) {
        try {
          this.tokenCaptureServer.close()
        } catch (e) {}
        this.tokenCaptureServer = null
        this.setSystemProxy(0, false)
      }

      try {
        this.generateCA()
        this.installCACert()
      } catch (e) {
        this.setSystemProxy(0, false)
        reject(new Error(`证书配置失败: ${e.message}`))
        return
      }

      const certCache = {}
      this.tokenCaptureServer = http.createServer()

      this.tokenCaptureServer.on('connect', (req, clientSocket, head) => {
        const [hostname, portStr] = req.url.split(':')
        const targetPort = parseInt(portStr) || 443

        if (this.isTargetDomain(hostname)) {
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
              key,
              cert
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

            tlsSocket.on('data', (data) => {
              if (connectionClosed || this.tokenCaptureStopped) return

              const reqStr = data.toString()

              if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s/.test(reqStr)) {
                const headerEnd = reqStr.indexOf('\r\n\r\n')
                const headerSection = headerEnd >= 0 ? reqStr.substring(0, headerEnd) : reqStr
                const headerLines = headerSection.split('\r\n')
                const extracted = this.extractAuthHeaders(headerLines)

                if (extracted.token && extracted.token.length > 10) {
                  const result = this.buildCaptureResult({
                    token: extracted.token,
                    openId: extracted.openId,
                    openIdCipher: extracted.openIdCipher,
                    csecuuid: extracted.csecuuid,
                    userId: extracted.userId,
                    urlParams: this.extractUrlParamsFromRequestLine(headerLines[0] || '')
                  })

                  const resolveFunc = this.tokenCaptureResolve
                  this.tokenCaptureResolve = null
                  this.stopCapture()

                  if (resolveFunc) {
                    resolveFunc(result)
                  }
                  return
                }
              }

              safeWrite(serverSocket, data)
            })

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

            tlsSocket.on('error', () => {
              cleanup()
              if (!serverSocket.destroyed) serverSocket.destroy()
            })

            serverSocket.on('error', () => {
              cleanup()
              if (!tlsSocket.destroyed) tlsSocket.destroy()
            })
          })

          serverSocket.on('error', () => {
            if (!clientSocket.destroyed) clientSocket.destroy()
          })
        } else {
          const serverSocket = net.connect(targetPort, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            serverSocket.write(head)
            serverSocket.pipe(clientSocket)
            clientSocket.pipe(serverSocket)
          })
          serverSocket.on('error', () => clientSocket.end())
        }
      })

      this.tokenCaptureServer.on('request', (req, res) => {
        if (req.headers.token && !this.tokenCaptureStopped && this.tokenCaptureResolve) {
          const result = this.buildCaptureResult({
            token: String(req.headers.token || ''),
            openId: String(req.headers.openid || ''),
            openIdCipher: String(req.headers.openidcipher || ''),
            csecuuid: String(req.headers.csecuuid || ''),
            userId: String(req.headers.csecuserid || ''),
            urlParams: this.extractUrlParamsFromRequestLine(`${req.method} ${req.url}`)
          })

          const resolveFunc = this.tokenCaptureResolve
          this.tokenCaptureResolve = null
          this.stopCapture()

          if (resolveFunc) {
            resolveFunc(result)
          }
        }

        const targetUrl = req.url
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

          proxyReq.on('error', () => {
            try { res.writeHead(502); res.end('Bad Gateway') } catch (e) {}
          })

          req.pipe(proxyReq)
        } catch (e) {
          try { res.writeHead(400); res.end('Bad Request') } catch (e) {}
        }
      })

      this.tokenCaptureServer.on('error', (err) => {
        reject(err)
      })

      this.tokenCaptureServer.listen(port, '127.0.0.1', () => {
        this.setSystemProxy(port, true)
      })
    })
  }

  stopCapture() {
    this.tokenCaptureStopped = true
    if (this.tokenCaptureServer) {
      try {
        this.tokenCaptureServer.close()
      } catch (e) {}
      this.tokenCaptureServer = null
      this.setSystemProxy(0, false)
    }
    if (this.tokenCaptureResolve) {
      this.tokenCaptureResolve({ stopped: true })
      this.tokenCaptureResolve = null
    }
  }

  async start() {
    this.ensureProxyDisabled()
  }

  stop() {
    this.stopCapture()
  }

  ensureProxyDisabled() {
    this.setSystemProxy(0, false)
  }

  setSystemProxy(port, enable) {
    if (process.platform === 'win32') {
      try {
        if (enable) {
          execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f', { stdio: 'pipe', windowsHide: true })
          execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:${port}" /f`, { stdio: 'pipe', windowsHide: true })
        } else {
          execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f', { stdio: 'pipe', windowsHide: true })
        }
        this.notifyProxyChange()
      } catch (e) {
        console.error('[代理] 设置系统代理失败:', e.message)
      }
    }
  }

  notifyProxyChange() {
    try {
      execSync('netsh winhttp reset proxy', { stdio: 'pipe', windowsHide: true })
    } catch (e) {}

    try {
      execSync('powershell -Command "[System.Net.WebRequest]::DefaultWebProxy = $null"', { stdio: 'pipe', windowsHide: true, timeout: 3000 })
    } catch (e) {}
  }
}

module.exports = ProxyService
