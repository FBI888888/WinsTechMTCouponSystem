import React, { useState, useEffect } from 'react'
import { QrCode, Plus, X, Search, RefreshCw, Copy, Calendar, FileText, CheckCircle } from 'lucide-react'

function WorkTab({ accounts, tabId }) {
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
  const [toast, setToast] = useState({ show: false, message: '' })  // 右上角弹窗

  // 显示右上角弹窗
  const showToast = (message) => {
    setToast({ show: true, message })
    setTimeout(() => setToast({ show: false, message: '' }), 2000)
  }

  // 设置默认日期为今天
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
    setUnusedCoupons([])
    setUsedCoupons([])

    try {
      const result = await window.electronAPI.apiGetOrders({
        userid: account.userid,
        token: account.token,
        days: 30,
        statusFilter: 2 // 待使用
      })

      if (result.success) {
        const orderList = result.data || []
        setOrders(orderList)
        // 自动选中第一个订单
        if (orderList.length > 0) {
          setSelectedOrder(String(orderList[0].orderid))
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

  // 获取券码列表
  const handleGetCoupons = async () => {
    const account = getSelectedAccountData()
    if (!account) {
      showMessage('error', '请先选择账号')
      return
    }
    if (!selectedOrder) {
      showMessage('error', '请先选择订单')
      return
    }

    setLoading(prev => ({ ...prev, coupons: true }))
    setUnusedCoupons([])
    setUsedCoupons([])

    try {
      const result = await window.electronAPI.apiGetCoupons({
        token: account.token,
        orderid: selectedOrder
      })

      if (result.success) {
        const coupons = result.data || []
        const unused = []
        const used = []

        coupons.forEach(c => {
          const status = c.status || ''
          if (status.includes('未核销') || status.includes('待使用') || status.includes('未使用')) {
            unused.push(c.coupon)
          } else {
            used.push({ coupon: c.coupon, status })
          }
        })

        setUnusedCoupons(unused)
        setUsedCoupons(used)
        // 自动选中第一个未使用券码
        if (unused.length > 0) {
          setSelectedCoupon(unused[0])
        }
        // showMessage('success', `未使用: ${unused.length}, 已使用: ${used.length}`)
      } else {
        showMessage('error', result.error || '获取券码失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setLoading(prev => ({ ...prev, coupons: false }))
    }
  }

  // 搜索订单
  const handleSearchOrder = () => {
    if (!searchKeyword.trim()) {
      showMessage('error', '请输入关键词')
      return
    }
    const found = orders.find(o => 
      o.title?.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      o.orderid?.toString().includes(searchKeyword)
    )
    if (found) {
      setSelectedOrder(found.orderid)
      // showMessage('success', `已跳转到: ${found.title?.substring(0, 30)}...`)
    } else {
      showMessage('error', `未找到包含"${searchKeyword}"的订单`)
    }
  }

  // 格式化券码
  const formatVoucherCode = (code) => {
    if (!code) return ''
    const clean = code.replace(/\s/g, '')
    return clean.match(/.{1,4}/g)?.join(' ') || clean
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

    const order = orders.find(o => o.orderid === selectedOrder)
    const title = order?.title || '团购券'

    setLoading(prev => ({ ...prev, image: true }))

    try {
      const result = await window.electronAPI.generateQrcodeImage({
        title,
        couponCode: selectedCoupon,
        notes,
        dateText
      })

      if (result.success && result.renderInFrontend) {
        // 使用前端Canvas渲染图片
        const imageBase64 = await renderCouponImage(result)
        if (imageBase64) {
          setGeneratedImage(imageBase64)
          await copyImageToClipboard(imageBase64)
          showToast('制作成功，已复制到剪贴板')
        } else {
          showMessage('error', '图片渲染失败')
        }
      } else if (result.success && result.imageBase64) {
        setGeneratedImage(result.imageBase64)
        await copyImageToClipboard(result.imageBase64)
        showToast('制作成功，已复制到剪贴板')
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
      
      // 加载模板图片
      const templateImg = await loadImage(templateUrl)
      
      // 创建Canvas
      const canvas = document.createElement('canvas')
      canvas.width = templateImg.width
      canvas.height = templateImg.height
      const ctx = canvas.getContext('2d')
      
      // 绘制模板
      ctx.drawImage(templateImg, 0, 0)
      
      // 设置字体
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
        try {
          const qrcodeImg = await loadImage(qrcodeBase64)
          const qrcodePos = positions.qrcode
          ctx.drawImage(qrcodeImg, qrcodePos.x, qrcodePos.y, qrcodePos.width, qrcodePos.height)
        } catch (e) {
          console.error('绘制二维码失败:', e)
        }
      }
      
      // 绘制条形码
      if (barcodeBase64) {
        try {
          const barcodeImg = await loadImage(barcodeBase64)
          const barcodePos = positions.barcode
          ctx.drawImage(barcodeImg, barcodePos.x, barcodePos.y, barcodePos.width, barcodePos.height)
        } catch (e) {
          console.error('绘制条形码失败:', e)
        }
      }
      
      // 绘制备注
      if (notes) {
        const notesPos = positions.notes
        ctx.fillStyle = '#333333'
        ctx.font = 'bold 50px "Microsoft YaHei", sans-serif'
        ctx.fillText(notes, notesPos.x + notesPos.width / 2, notesPos.y + notesPos.height / 2)
      }
      
      // 转换为Base64
      return canvas.toDataURL('image/jpeg', 0.95)
    } catch (error) {
      console.error('渲染券码图片失败:', error)
      return null
    }
  }

  // 复制图片到剪贴板
  const copyImageToClipboard = async (imageBase64) => {
    try {
      // 将base64转换为blob
      const response = await fetch(imageBase64)
      const blob = await response.blob()
      
      // 复制到剪贴板
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ])
      console.log('图片已复制到剪贴板')
    } catch (e) {
      console.error('复制到剪贴板失败:', e)
      // 尝试使用canvas方式
      try {
        const img = new Image()
        img.onload = async () => {
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          canvas.toBlob(async (blob) => {
            if (blob) {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ])
            }
          }, 'image/png')
        }
        img.src = imageBase64
      } catch (e2) {
        console.error('备用复制方式也失败:', e2)
      }
    }
  }

  return (
    <div className="flex h-full gap-4 relative">
      {/* 右上角成功弹窗 */}
      {toast.show && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      {/* 左侧操作区 */}
      <div className="flex-[2] flex flex-col gap-4">
        {/* 消息提示 */}
        {message.text && (
          <div className={`p-3 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* 账号选择 */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">选择账号:</label>
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
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
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">选择订单:</label>
          <select
            value={selectedOrder}
            onChange={(e) => setSelectedOrder(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {orders.length === 0 ? (
              <option value="">请先获取订单列表</option>
            ) : (
              orders.map(o => (
                <option key={o.orderid} value={o.orderid}>{o.title} - {o.orderid}</option>
              ))
            )}
          </select>
          <button
            onClick={handleGetOrders}
            disabled={loading.orders}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading.orders ? 'animate-spin' : ''}`} />
            获取订单
          </button>
        </div>

        {/* 关键词搜索 */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">关键词搜索:</label>
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearchOrder()}
            placeholder="输入订单关键词"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            onClick={handleSearchOrder}
            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        {/* 未使用券码 */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">未使用券码:</label>
          <select
            value={selectedCoupon}
            onChange={(e) => setSelectedCoupon(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {unusedCoupons.length === 0 ? (
              <option value="">请先获取券码列表</option>
            ) : (
              unusedCoupons.map((c, i) => (
                <option key={i} value={c}>{c}</option>
              ))
            )}
          </select>
          <span className="text-sm text-orange-600 font-medium whitespace-nowrap">剩余 {unusedCoupons.length} 个</span>
          <button
            onClick={handleGetCoupons}
            disabled={loading.coupons}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading.coupons ? 'animate-spin' : ''}`} />
            获取券码
          </button>
        </div>

        {/* 已使用券码 */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">已使用券码:</label>
          <select className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
            {usedCoupons.length === 0 ? (
              <option value="">无已使用券码</option>
            ) : (
              usedCoupons.map((c, i) => (
                <option key={i} value={c.coupon}>{c.coupon} - {c.status}</option>
              ))
            )}
          </select>
          <span className="text-sm text-gray-500">共 {usedCoupons.length} 个</span>
        </div>

        {/* 有效期 */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">有效期:</label>
          <input
            type="text"
            value={dateText}
            onChange={(e) => setDateText(e.target.value)}
            placeholder="如: 2025/01/01 23:59"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {/* 图片备注 */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 w-20">图片备注:</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="输入图片备注（可选）"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {/* 制作按钮 */}
        <button
          onClick={handleMakeImage}
          disabled={loading.image}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-medium hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
        >
          {loading.image ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <QrCode className="w-5 h-5" />
          )}
          制作券码图片
        </button>
      </div>

      {/* 右侧预览区 */}
      <div className="flex-1 bg-gray-50 rounded-xl p-4 flex flex-col">
        <div className="flex-1 bg-white rounded-lg border border-gray-200 flex items-center justify-center min-h-[400px] overflow-auto">
          {generatedImage ? (
            <img 
              src={generatedImage} 
              alt="券码图片" 
              className="max-w-full h-auto"
              style={{ maxHeight: '600px' }}
            />
          ) : (
            <p className="text-gray-400 text-sm">图片将显示在这里</p>
          )}
        </div>
      </div>
    </div>
  )
}

function CKQrcodePage({ accounts, onAccountsChange }) {
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
            <QrCode className="w-5 h-5 text-orange-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">CK券码制作</h1>
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
      <div className="flex-1 bg-white rounded-xl shadow-sm p-4 overflow-hidden relative">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="absolute inset-0 p-4 overflow-auto"
            style={{ display: activeTab === tab.id ? 'block' : 'none' }}
          >
            <WorkTab accounts={accounts} tabId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default CKQrcodePage
