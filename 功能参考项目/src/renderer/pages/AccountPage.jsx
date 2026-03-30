import React, { useState, useEffect, useRef } from 'react'
import { Users, Plus, Trash2, Download, Upload, Search, RefreshCw, CheckCircle, XCircle, Edit, Fingerprint, Radio, Store } from 'lucide-react'

function AccountPage({ accounts, onAccountsChange }) {
  const [remark, setRemark] = useState('')
  const [url, setUrl] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [fingerprintLoading, setFingerprintLoading] = useState(false)
  const [tokenCapturing, setTokenCapturing] = useState(false)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 })
  const contextMenuRef = useRef(null)

  const [shopTestOpen, setShopTestOpen] = useState(false)
  const [shopTestToken, setShopTestToken] = useState('')
  const [shopTestSkuId, setShopTestSkuId] = useState('')
  const [shopTestLoading, setShopTestLoading] = useState(false)
  const [shopTestResultText, setShopTestResultText] = useState('')

  const openShopTest = () => {
    const { token } = parseUserUrl(url)
    if (token && !shopTestToken) {
      setShopTestToken(token)
    }
    setShopTestResultText('')
    setShopTestOpen(true)
  }

  const closeShopTest = () => {
    setShopTestOpen(false)
    setShopTestLoading(false)
  }

  const handleShopTestFetch = async () => {
    if (!shopTestToken.trim() || !shopTestSkuId.trim()) {
      showMessage('error', '请填写 token 与 skuid')
      return
    }

    setShopTestLoading(true)
    setShopTestResultText('')
    try {
      const result = await window.electronAPI.apiGetSkuShops({
        token: shopTestToken.trim(),
        sku: shopTestSkuId.trim(),
        limit: 50,
        offset: 0
      })

      if (result?.success) {
        setShopTestResultText(JSON.stringify(result.data, null, 2))
      } else {
        setShopTestResultText(JSON.stringify(result, null, 2))
      }
    } catch (error) {
      setShopTestResultText(JSON.stringify({ success: false, error: error.message }, null, 2))
    } finally {
      setShopTestLoading(false)
    }
  }

  // 重置设备指纹（遇到风控时使用）
  const handleResetFingerprint = async () => {
    if (!window.confirm('确定要重置设备指纹吗？这将生成新的设备标识，可用于解除风控限制。')) {
      return
    }
    setFingerprintLoading(true)
    try {
      const result = await window.electronAPI.resetFingerprint()
      if (result.success) {
        showMessage('success', '设备指纹已重置，请继续使用')
      } else {
        showMessage('error', result.error || '指纹重置失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setFingerprintLoading(false)
    }
  }

  // 解析URL中的userId和token
  const parseUserUrl = (urlStr) => {
    try {
      const url = new URL(urlStr)
      const userid = url.searchParams.get('userId') || url.searchParams.get('userid') || ''
      const token = url.searchParams.get('token') || ''
      return { userid, token }
    } catch {
      return { userid: '', token: '' }
    }
  }

  // 显示消息
  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
  }

  // 添加/更新账号
  const handleAddOrUpdate = async () => {
    if (!remark.trim() || !url.trim()) {
      showMessage('error', '请填写备注名与完整URL')
      return
    }

    const { userid, token } = parseUserUrl(url)
    if (!userid || !token) {
      showMessage('error', 'URL 未能解析出 userId/token')
      return
    }

    // 检查账号状态
    let status = '未检测'
    try {
      const result = await window.electronAPI.accountsCheckStatus({ userid, token })
      status = result.success && result.code === 0 ? '正常' : '失效'
    } catch {
      status = '失效'
    }

    const newAccount = {
      remark: remark.trim(),
      userid,
      token,
      url: url.trim(),
      status
    }

    // 更新账号列表
    const existingIndex = accounts.findIndex(a => a.remark === newAccount.remark || a.userid === newAccount.userid)
    let newAccounts
    if (existingIndex >= 0) {
      newAccounts = [...accounts]
      newAccounts[existingIndex] = newAccount
    } else {
      newAccounts = [...accounts, newAccount]
    }

    await window.electronAPI.accountsSave(newAccounts)
    onAccountsChange()
    setRemark('')
    setUrl('')
    showMessage('success', '已添加/更新账号')
  }

  // 删除选中账号
  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) {
      showMessage('error', '请先选择要删除的记录')
      return
    }

    if (!window.confirm(`将删除 ${selectedRows.size} 条记录，是否继续？`)) {
      return
    }

    const newAccounts = accounts.filter((_, index) => !selectedRows.has(index))
    await window.electronAPI.accountsSave(newAccounts)
    onAccountsChange()
    setSelectedRows(new Set())
    showMessage('success', '删除完成')
  }

  // 导入JSON
  const handleImport = async () => {
    const result = await window.electronAPI.accountsImport()
    if (result.success && result.data) {
      await window.electronAPI.accountsSave(result.data)
      onAccountsChange()
      showMessage('success', '导入成功')
    } else if (!result.cancelled) {
      showMessage('error', result.error || '导入失败')
    }
  }

  // 导出JSON
  const handleExport = async () => {
    const result = await window.electronAPI.accountsExport(accounts)
    if (result.success) {
      showMessage('success', '导出成功')
    } else if (!result.cancelled) {
      showMessage('error', result.error || '导出失败')
    }
  }

  // 检查全部账号
  const handleCheckAll = async () => {
    if (accounts.length === 0) {
      showMessage('error', '暂无账号')
      return
    }

    setLoading(true)
    let okCount = 0
    const newAccounts = [...accounts]

    for (let i = 0; i < newAccounts.length; i++) {
      try {
        const result = await window.electronAPI.accountsCheckStatus({
          userid: newAccounts[i].userid,
          token: newAccounts[i].token
        })
        newAccounts[i].status = result.success && result.code === 0 ? '正常' : '失效'
        if (newAccounts[i].status === '正常') okCount++
      } catch {
        newAccounts[i].status = '失效'
      }
    }

    await window.electronAPI.accountsSave(newAccounts)
    onAccountsChange()
    setLoading(false)
    showMessage('success', `检查完成：正常 ${okCount} / 共 ${accounts.length}`)
  }

  // 搜索
  const handleSearch = () => {
    if (!searchKeyword.trim()) {
      showMessage('error', '请输入搜索关键词')
      return
    }
    const keyword = searchKeyword.toLowerCase()
    const index = accounts.findIndex(a => 
      a.remark.toLowerCase().includes(keyword) ||
      a.userid.toLowerCase().includes(keyword) ||
      a.token.toLowerCase().includes(keyword) ||
      a.url.toLowerCase().includes(keyword)
    )
    if (index >= 0) {
      document.getElementById(`row-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      showMessage('success', `已定位到第 ${index + 1} 行`)
    } else {
      showMessage('error', '未找到匹配结果')
    }
  }

  // 双击填充编辑框
  const handleRowDoubleClick = (account) => {
    setRemark(account.remark)
    setUrl(account.url)
  }

  // 抓取Token
  const handleCaptureToken = async () => {
    if (tokenCapturing) {
      // 停止抓包
      try {
        await window.electronAPI.stopTokenCapture()
        setTokenCapturing(false)
        showMessage('success', '已停止抓取')
      } catch (error) {
        showMessage('error', error.message)
      }
      return
    }

    setTokenCapturing(true)
    showMessage('success', '开始抓取Token，请打开美团联盟任意小程序链接...')
    
    try {
      const result = await window.electronAPI.startTokenCapture()
      if (result.success && result.url) {
        setUrl(result.url)
        showMessage('success', '抓取成功，URL已填入输入框')
      } else if (result.stopped) {
        showMessage('success', '已停止抓取')
      } else {
        showMessage('error', result.error || '抓取失败')
      }
    } catch (error) {
      showMessage('error', error.message)
    } finally {
      setTokenCapturing(false)
    }
  }

  // 右键菜单处理
  const handleContextMenu = (e, index) => {
    e.preventDefault()
    // 如果右键的行未被选中，则选中该行
    if (!selectedRows.has(index)) {
      setSelectedRows(new Set([index]))
    }
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY
    })
  }

  // 关闭右键菜单
  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0 })
  }

  // 点击其他地方关闭菜单
  useEffect(() => {
    const handleClick = () => closeContextMenu()
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // 选择行
  const toggleRowSelection = (index) => {
    const newSelected = new Set(selectedRows)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedRows(newSelected)
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* 标题 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <Users className="w-5 h-5 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">美团账号管理</h1>
      </div>

      {/* 消息提示 */}
      {message.text && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* 添加/编辑区域 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="备注名"
            className="flex-1 min-w-[120px] px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="完整URL，包含 userId 与 token"
            className="flex-[3] min-w-[300px] px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button onClick={handleAddOrUpdate} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2">
            <Plus className="w-4 h-4" /> 添加
          </button>
          <button 
            onClick={handleCaptureToken} 
            className={`px-4 py-2 ${tokenCapturing ? 'bg-red-500 hover:bg-red-600' : 'bg-cyan-500 hover:bg-cyan-600'} text-white rounded-lg flex items-center gap-2`}
          >
            <Radio className={`w-4 h-4 ${tokenCapturing ? 'animate-pulse' : ''}`} /> {tokenCapturing ? '停止抓取' : '抓取Token'}
          </button>
          <button onClick={handleImport} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2">
            <Upload className="w-4 h-4" /> 导入
          </button>
          <button onClick={handleExport} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2">
            <Download className="w-4 h-4" /> 导出
          </button>
          <button onClick={handleCheckAll} disabled={loading} className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 检查全部
          </button>
          <button 
            onClick={handleResetFingerprint} 
            disabled={fingerprintLoading} 
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 flex items-center gap-2 disabled:opacity-50"
            title="遇到风控限制时，点击重置设备指纹"
          >
            <Fingerprint className={`w-4 h-4 ${fingerprintLoading ? 'animate-spin' : ''}`} /> 重置指纹
          </button>

          <button
            onClick={openShopTest}
            className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 flex items-center gap-2"
            title="输入 token 和 skuid，测试获取门店列表"
          >
            <Store className="w-4 h-4" /> 店铺测试
          </button>
        </div>
      </div>

      {/* 搜索区域 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索 备注名/userId/token/url"
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button onClick={handleSearch} className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center gap-2">
            <Search className="w-4 h-4" /> 搜索
          </button>
        </div>
      </div>

      {/* 表格区域 */}
      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRows(new Set(accounts.map((_, i) => i)))
                      } else {
                        setSelectedRows(new Set())
                      }
                    }}
                    checked={selectedRows.size === accounts.length && accounts.length > 0}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">userId</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">token</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">完整URL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">状态</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {accounts.map((account, index) => (
                <tr 
                  key={index}
                  id={`row-${index}`}
                  className={`hover:bg-gray-50 cursor-pointer ${selectedRows.has(index) ? 'bg-orange-50' : ''}`}
                  onDoubleClick={() => handleRowDoubleClick(account)}
                  onContextMenu={(e) => handleContextMenu(e, index)}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(index)}
                      onChange={() => toggleRowSelection(index)}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{account.remark}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{account.userid}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono truncate max-w-[150px]" title={account.token}>
                    {account.token.substring(0, 20)}...
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[300px]" title={account.url}>
                    {account.url}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      account.status === '正常' 
                        ? 'bg-green-100 text-green-800' 
                        : account.status === '失效'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {account.status || '未检测'}
                    </span>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                    暂无账号，请添加账号
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              handleDeleteSelected()
              closeContextMenu()
            }}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> 删除选中 ({selectedRows.size})
          </button>
        </div>
      )}

      {shopTestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeShopTest} />
          <div className="relative bg-white rounded-xl shadow-lg w-[900px] max-w-[95vw] max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="font-semibold text-gray-800">店铺测试</div>
              <button
                onClick={closeShopTest}
                className="px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                关闭
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">token</div>
                  <input
                    type="text"
                    value={shopTestToken}
                    onChange={(e) => setShopTestToken(e.target.value)}
                    placeholder="请输入 token"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">skuid</div>
                  <input
                    type="text"
                    value={shopTestSkuId}
                    onChange={(e) => setShopTestSkuId(e.target.value)}
                    placeholder="请输入 skuid"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleShopTestFetch}
                  disabled={shopTestLoading}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {shopTestLoading ? '获取中...' : '获取'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shopTestResultText || '')
                      showMessage('success', '已复制结果')
                    } catch (e) {
                      showMessage('error', '复制失败')
                    }
                  }}
                  disabled={!shopTestResultText}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
                >
                  复制结果
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500">返回内容</div>
                <textarea
                  value={shopTestResultText}
                  readOnly
                  placeholder="点击“获取”后，这里会显示返回的 JSON"
                  className="w-full h-[420px] p-3 font-mono text-xs focus:outline-none resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountPage
