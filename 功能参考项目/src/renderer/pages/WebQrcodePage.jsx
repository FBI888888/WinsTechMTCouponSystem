import React, { useState, useEffect, useRef } from 'react'
import { Globe, RefreshCw, Search, QrCode, Plus, X, CheckCircle } from 'lucide-react'

function WebWorkTab({ accounts, tabId }) {
  const [selectedAccount, setSelectedAccount] = useState('')
  const [orders, setOrders] = useState([])
  const [selectedOrder, setSelectedOrder] = useState('')
  const [unusedCoupons, setUnusedCoupons] = useState([])
  const [usedCoupons, setUsedCoupons] = useState([])
  const [selectedCoupon, setSelectedCoupon] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [dateText, setDateText] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState({ orders: false, coupons: false, image: false })
  const [message, setMessage] = useState({ type: '', text: '' })
  const [generatedImage, setGeneratedImage] = useState(null)
  const [webviewUrl, setWebviewUrl] = useState('')
  const [webviewLoading, setWebviewLoading] = useState(false)
  const [webTitle, setWebTitle] = useState('')  // 从网页提取的商品标题
  const [toast, setToast] = useState({ show: false, message: '' })  // 右上角弹窗
  const webviewRef = useRef(null)

  // 显示右上角弹窗
  const showToast = (message) => {
    setToast({ show: true, message })
    setTimeout(() => setToast({ show: false, message: '' }), 2000)
  }

  // 设置默认日期
  useEffect(() => {
    const today = new Date()
    const formatted = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')} 23:59`
    setDateText(formatted)
  }, [])

  // 自动选中第一个账号
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0].userid)
    }
  }, [accounts])

  // webview 加载完成后的处理
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleLoadStart = () => setWebviewLoading(true)
    const handleLoadStop = () => {
      setWebviewLoading(false)
      // showMessage('success', '订单详情加载完成')
    }
    const handleLoadFail = (e) => {
      setWebviewLoading(false)
      showMessage('error', '页面加载失败')
    }

    webview.addEventListener('did-start-loading', handleLoadStart)
    webview.addEventListener('did-stop-loading', handleLoadStop)
    webview.addEventListener('did-fail-load', handleLoadFail)

    return () => {
      webview.removeEventListener('did-start-loading', handleLoadStart)
      webview.removeEventListener('did-stop-loading', handleLoadStop)
      webview.removeEventListener('did-fail-load', handleLoadFail)
    }
  }, [webviewUrl])

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
  }

  const getSelectedAccountData = () => {
    return accounts.find(a => a.userid === selectedAccount)
  }

  // 获取订单列表
  const handleGetOrders = async () => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }

    setLoading(prev => ({ ...prev, orders: true }))
    setOrders([])
    setSelectedOrder('')

    try {
      // 获取待使用订单 (statusFilter=2)
      const result = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days: 90,
        statusFilter: 2
      })

      if (result.success) {
        const orderList = result.data || []
        setOrders(orderList)
        // 自动选中第一个订单
        if (orderList.length > 0) {
          const firstOrderId = String(orderList[0].orderid)
          setSelectedOrder(firstOrderId)
          // 触发加载
          handleOrderChange({ target: { value: firstOrderId } })
        }
        // showMessage('success', `获取到 ${orderList.length} 个订单`)
      } else {
        showMessage('error', result.error || '获取订单失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setLoading(prev => ({ ...prev, orders: false }))
    }
  }

  // 订单选择变化，自动加载H5页面
  const handleOrderChange = async (e) => {
    const orderid = e.target.value
    setSelectedOrder(orderid)
    setUnusedCoupons([])
    setUsedCoupons([])
    setSelectedCoupon('')

    if (!orderid) return

    const account = getSelectedAccountData()
    if (!account) return

    // 通过接口获取带签名的长URL (参考 mtqrcodeweb/GetCouponsInfo.py get_long_mt_order_url)
    try {
      const result = await window.electronAPI.apiGetLongOrderUrl({
        token: account.token,
        orderid: orderid
      })
      
      if (result.success && result.url) {
        // 设置 cookies
        const domain = '.meituan.com'
        const cookies = [
          { url: 'https://awp.meituan.com', name: 'isid', value: account.userid, domain },
          { url: 'https://awp.meituan.com', name: 'mt_c_token', value: account.token, domain },
          { url: 'https://awp.meituan.com', name: 'oops', value: account.token, domain },
          { url: 'https://awp.meituan.com', name: 'token', value: account.token, domain },
          { url: 'https://awp.meituan.com', name: 'p_token', value: account.token, domain }
        ]
        
        await window.electronAPI.webviewSetCookies({
          partition: 'persist:webview',
          cookies
        })
        
        // 使用接口返回的长URL
        setWebviewUrl(result.url)
      } else {
        showMessage('error', result.error || '获取订单详情URL失败')
      }
    } catch (error) {
      console.error('获取长URL失败:', error)
      showMessage('error', '加载订单详情失败')
    }
  }

  // 搜索订单
  const handleSearchOrder = () => {
    if (!searchKeyword.trim()) {
      showMessage('error', '请输入搜索关键词')
      return
    }

    const found = orders.find(o => 
      o.title?.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      String(o.orderid).includes(searchKeyword)
    )

    if (found) {
      setSelectedOrder(String(found.orderid))
      handleOrderChange({ target: { value: String(found.orderid) } })
      // showMessage('success', `已定位到: ${found.title?.substring(0, 20)}...`)
    } else {
      showMessage('error', `未找到包含"${searchKeyword}"的订单`)
    }
  }

  // 从webview DOM中获取券码
  const handleGetCoupons = async () => {
    const webview = webviewRef.current
    if (!webview || !selectedOrder) {
      showMessage('error', '请先选择并加载订单')
      return
    }

    setLoading(prev => ({ ...prev, coupons: true }))
    setUnusedCoupons([])
    setUsedCoupons([])

    // 从DOM中提取券码的JavaScript代码 (参考 mtqrcodeweb/mtqr.py print_html)
    const jsCode = `
      (function() {
        var result = {unused: [], used: [], title: ''};
        
        // 获取商品标题
        try {
          // 尝试多种选择器获取标题
          var titleEl = document.querySelector('.deal-title') || 
                        document.querySelector('[class*="title"]') ||
                        document.querySelector('h1') ||
                        document.querySelector('h2');
          if (titleEl) {
            result.title = titleEl.textContent.trim().split('（')[0];
          }
        } catch(e) {}
        
        // 方法1: mtqrcodeweb 方式 - 查找 div.__rax-text 中的14位格式券码 (xxxx xxxx xxxx)
        var targetDivs = document.querySelectorAll('div.__rax-text');
        targetDivs.forEach(function(div) {
          var text = div.textContent || div.innerText || '';
          // 检查是否是14位格式: "xxxx xxxx xxxx" (位置4和9是空格)
          if (text.length === 14 && text[4] === ' ' && text[9] === ' ') {
            var code = text.replace(/\\s/g, '');
            if (code.length === 12 && /^\\d+$/.test(code)) {
              result.unused.push(code);
            }
          }
        });
        
        // 方法2: 备用 - 查找ul.coupon-info中的券码
        if (result.unused.length === 0) {
          var couponList = document.querySelector('ul.coupon-info');
          if (couponList) {
            var items = couponList.querySelectorAll('li');
            items.forEach(function(item) {
              var codeDiv = item.querySelector('.coupon-code');
              if (!codeDiv) return;
              var codeText = codeDiv.textContent || codeDiv.innerText;
              var match = codeText.match(/密码[：:](\\d+)/);
              if (!match) return;
              var code = match[1];
              var statusSpan = item.querySelector('span.status');
              var status = statusSpan ? statusSpan.textContent.trim() : '';
              if (status === '未消费' || status === '') {
                result.unused.push(code);
              } else {
                result.used.push(code);
              }
            });
          }
        }
        
        // 方法3: 通用查找 - 在页面中搜索12位数字
        if (result.unused.length === 0) {
          var allText = document.body.innerText;
          var matches = allText.match(/\\b\\d{12}\\b/g);
          if (matches) {
            result.unused = [...new Set(matches)]; // 去重
          }
        }
        
        return result;
      })();
    `

    try {
      const result = await webview.executeJavaScript(jsCode)
      
      if (result) {
        setUnusedCoupons(result.unused || [])
        setUsedCoupons(result.used || [])
        
        // 保存从网页提取的标题
        if (result.title) {
          setWebTitle(result.title)
        }
        
        if (result.unused.length > 0) {
          setSelectedCoupon(result.unused[0])
        }
        
        if (result.unused.length === 0 && result.used.length === 0) {
          showMessage('error', '未找到券码信息，请确认页面已完全加载')
        }
      } else {
        showMessage('error', '未找到券码信息，请确认页面已完全加载')
      }
    } catch (error) {
      console.error('执行JavaScript失败:', error)
      showMessage('error', '获取券码失败: ' + error.message)
    } finally {
      setLoading(prev => ({ ...prev, coupons: false }))
    }
  }

  // 加载图片辅助函数
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  // 制作券码图片
  const handleMakeImage = async () => {
    if (!selectedCoupon) {
      showMessage('error', '请先选择未使用券码')
      return
    }

    // 优先使用从网页提取的标题，否则使用订单标题
    const order = orders.find(o => String(o.orderid) === selectedOrder)
    const title = webTitle || order?.title || '团购券'

    setLoading(prev => ({ ...prev, image: true }))

    try {
      const result = await window.electronAPI.generateQrcodeImage({
        title,
        couponCode: selectedCoupon,
        notes,
        dateText
      })

      if (result.success && result.renderInFrontend) {
        const imageBase64 = await renderCouponImage(result)
        if (imageBase64) {
          setGeneratedImage(imageBase64)
          await copyImageToClipboard(imageBase64)
          showToast('制作成功，已复制到剪贴板')
        } else {
          showMessage('error', '图片渲染失败')
        }
      } else {
        showMessage('error', result.error || '制作失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setLoading(prev => ({ ...prev, image: false }))
    }
  }

  // 使用Canvas渲染券码图片
  const renderCouponImage = async (data) => {
    try {
      const { templateUrl, positions, title, formattedCode, dateText, notes, qrcodeBase64, barcodeBase64 } = data
      
      const templateImg = await loadImage(templateUrl)
      const canvas = document.createElement('canvas')
      canvas.width = templateImg.width
      canvas.height = templateImg.height
      const ctx = canvas.getContext('2d')
      
      ctx.drawImage(templateImg, 0, 0)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      
      // 绘制标题
      const titlePos = positions.title
      ctx.fillStyle = '#333333'
      ctx.font = 'bold 61px "Microsoft YaHei", "SimHei", sans-serif'
      ctx.fillText(title, titlePos.x + titlePos.width / 2, titlePos.y + titlePos.height / 2)
      
      // 绘制有效期
      if (dateText) {
        const datePos = positions.date
        ctx.fillStyle = '#666666'
        ctx.font = '38px "Microsoft YaHei", sans-serif'
        ctx.fillText(dateText, datePos.x + datePos.width / 2, datePos.y + datePos.height / 2)
      }
      
      // 绘制券码文字
      const codePos = positions.code
      ctx.fillStyle = '#000000'
      ctx.font = '65px "Consolas", "Monaco", monospace'
      ctx.fillText(formattedCode, codePos.x + codePos.width / 2, codePos.y + codePos.height / 2)
      
      // 绘制二维码
      if (qrcodeBase64) {
        const qrcodeImg = await loadImage(qrcodeBase64)
        const qrcodePos = positions.qrcode
        ctx.drawImage(qrcodeImg, qrcodePos.x, qrcodePos.y, qrcodePos.width, qrcodePos.height)
      }
      
      // 绘制条形码
      if (barcodeBase64) {
        const barcodeImg = await loadImage(barcodeBase64)
        const barcodePos = positions.barcode
        ctx.drawImage(barcodeImg, barcodePos.x, barcodePos.y, barcodePos.width, barcodePos.height)
      }
      
      // 绘制备注
      if (notes) {
        const notesPos = positions.notes
        ctx.fillStyle = '#333333'
        ctx.font = 'bold 50px "Microsoft YaHei", sans-serif'
        ctx.fillText(notes, notesPos.x + notesPos.width / 2, notesPos.y + notesPos.height / 2)
      }
      
      return canvas.toDataURL('image/jpeg', 0.95)
    } catch (error) {
      console.error('渲染券码图片失败:', error)
      return null
    }
  }

  // 复制图片到剪贴板
  const copyImageToClipboard = async (imageBase64) => {
    try {
      // 将图片转换为PNG格式的blob（剪贴板更好支持PNG）
      const img = new Image()
      img.src = imageBase64
      await new Promise((resolve) => { img.onload = resolve })
      
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ])
            console.log('图片已复制到剪贴板')
          } catch (e) {
            console.error('复制到剪贴板失败:', e)
          }
        }
      }, 'image/png')
    } catch (e) {
      console.error('复制到剪贴板失败:', e)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 relative">
      {/* 右上角成功弹窗 */}
      {toast.show && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      {/* 消息提示 */}
      {message.text && (
        <div className={`p-3 rounded-lg text-sm mb-4 ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* 左侧操作区 */}
        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          {/* 账号选择 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">选择账号:</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              {accounts.length === 0 ? (
                <option value="">暂无账号</option>
              ) : (
                accounts.map(a => (
                  <option key={a.userid} value={a.userid}>{a.remark}</option>
                ))
              )}
            </select>
          </div>

          {/* 订单选择 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">选择订单:</label>
            <select
              value={selectedOrder}
              onChange={handleOrderChange}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              {orders.length === 0 ? (
                <option value="">请先获取订单</option>
              ) : (
                orders.map(o => (
                  <option key={o.orderid} value={o.orderid}>{o.title} - {o.orderid}</option>
                ))
              )}
            </select>
            <button
              onClick={handleGetOrders}
              disabled={loading.orders}
              className="px-3 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 text-sm"
            >
              {loading.orders ? <RefreshCw className="w-4 h-4 animate-spin" /> : '获取'}
            </button>
          </div>

          {/* 关键词搜索 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">关键词:</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearchOrder()}
              placeholder="输入订单关键词"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <button
              onClick={handleSearchOrder}
              className="px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 text-sm"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>

          {/* 未使用券码 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">未使用:</label>
            <select
              value={selectedCoupon}
              onChange={(e) => setSelectedCoupon(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              {unusedCoupons.length === 0 ? (
                <option value="">请先获取券码</option>
              ) : (
                unusedCoupons.map((c, i) => (
                  <option key={i} value={c}>{c}</option>
                ))
              )}
            </select>
            <span className="text-sm text-orange-600 whitespace-nowrap">{unusedCoupons.length}个</span>
            <button
              onClick={handleGetCoupons}
              disabled={loading.coupons}
              className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm"
            >
              {loading.coupons ? <RefreshCw className="w-4 h-4 animate-spin" /> : '获取'}
            </button>
          </div>

          {/* 已使用券码 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">已使用:</label>
            <select className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm">
              {usedCoupons.length === 0 ? (
                <option value="">无</option>
              ) : (
                usedCoupons.map((c, i) => (
                  <option key={i} value={c}>{c}</option>
                ))
              )}
            </select>
            <span className="text-sm text-gray-500">{usedCoupons.length}个</span>
          </div>

          {/* 有效期 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">有效期:</label>
            <input
              type="text"
              value={dateText}
              onChange={(e) => setDateText(e.target.value)}
              placeholder="如: 2025/01/01 23:59"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          {/* 备注 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-20">备注:</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="输入备注（可选）"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          {/* 制作按钮 */}
          <button
            onClick={handleMakeImage}
            disabled={loading.image}
            className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-medium hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading.image ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <QrCode className="w-5 h-5" />
            )}
            制作券码图片
          </button>

          {/* 图片预览 */}
          {generatedImage && (
            <div className="mt-2">
              <img src={generatedImage} alt="券码图片" className="w-full rounded-lg border" />
            </div>
          )}
        </div>

        {/* 右侧Web预览区 */}
        <div className="w-[350px] bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-3 bg-gray-50 border-b flex items-center gap-2">
            {webviewLoading && <RefreshCw className="w-4 h-4 animate-spin text-orange-500" />}
          </div>
          <div className="flex-1 relative">
            {webviewUrl ? (
              <webview
                ref={webviewRef}
                src={webviewUrl}
                partition="persist:webview"
                className="w-full h-full"
                style={{ width: '100%', height: '100%' }}
                useragent="Mozilla/5.0 (Linux; Android 12; M2102J2SC Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MMWEBID/2585 MicroMessenger/8.0.47.2560(0x28002F30) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center">
                  <Globe className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p>选择订单后将在这里显示订单详情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WebQrcodePage({ accounts, onAccountsChange }) {
  const [tabs, setTabs] = useState([{ id: 'home', name: '首页' }])
  const [activeTab, setActiveTab] = useState('home')
  const [tabCounter, setTabCounter] = useState(0)

  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`
    const newName = `工作页 ${tabCounter + 1}`
    setTabs([...tabs, { id: newId, name: newName }])
    setActiveTab(newId)
    setTabCounter(tabCounter + 1)
  }

  const handleCloseTab = (tabId) => {
    if (tabId === 'home') {
      return
    }
    setTabs(tabs.filter(t => t.id !== tabId))
    if (activeTab === tabId) {
      setActiveTab('home')
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* 标题和添加按钮 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
            <Globe className="w-5 h-5 text-orange-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">Web券码制作</h1>
        </div>
        <button
          onClick={handleAddTab}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> 添加页
        </button>
      </div>

      {/* 标签页导航 */}
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-2 cursor-pointer rounded-t-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white border border-b-white border-gray-200 -mb-px text-orange-600'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="text-sm font-medium">{tab.name}</span>
            {tab.id !== 'home' && (
              <button
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id) }}
                className="w-4 h-4 rounded-full hover:bg-gray-200 flex items-center justify-center"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 标签页内容 - 所有标签页同时渲染，通过display控制显示以保持状态 */}
      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden relative">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="absolute inset-0 overflow-auto"
            style={{ display: activeTab === tab.id ? 'block' : 'none' }}
          >
            <WebWorkTab accounts={accounts} tabId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default WebQrcodePage
