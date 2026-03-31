import { useState, useEffect, useMemo, useRef } from 'react'
import { Users, Plus, Trash2, Download, Upload, Search, RefreshCw, Radio, ShieldOff } from 'lucide-react'
import { accountsApi } from '../api'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { confirm } from '../stores/confirmStore'

function AccountPage() {
  // 全局缓存
  const { accounts, accountsLoaded, setAccounts, fetchAccounts } = useDataStore()
  const toast = useToastStore()

  const [remark, setRemark] = useState('')
  const [url, setUrl] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [tokenCapturing, setTokenCapturing] = useState(false)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 })
  const contextMenuRef = useRef(null)
  const [contextIndex, setContextIndex] = useState(-1)

  const [editOpen, setEditOpen] = useState(false)
  const [editUserid, setEditUserid] = useState('')
  const [editToken, setEditToken] = useState('')
  const [editCsecuuid, setEditCsecuuid] = useState('')
  const [editOpenId, setEditOpenId] = useState('')
  const [editOpenIdCipher, setEditOpenIdCipher] = useState('')
  const [editIndex, setEditIndex] = useState(-1)

  const [lastCaptured, setLastCaptured] = useState(null)
  const [resettingCerts, setResettingCerts] = useState(false)
  const [scanningAccountId, setScanningAccountId] = useState(null)
  const [checkingAccountId, setCheckingAccountId] = useState(null)  // 正在检查的账号ID

  // 扫描对话框状态
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  const [scanDialogAccountId, setScanDialogAccountId] = useState(null)
  const [scanStatusFilter, setScanStatusFilter] = useState(2) // 默认待使用

  // Load accounts from API
  const loadAccounts = async (forceRefresh = false) => {
    try {
      await fetchAccounts(accountsApi, forceRefresh)
    } catch (error) {
      console.error('Failed to load accounts:', error)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  const parseUserUrl = (urlStr) => {
    try {
      const u = new URL(urlStr)
      const userid = u.searchParams.get('userId') || u.searchParams.get('userid') || ''
      const token = u.searchParams.get('token') || ''
      return { userid, token }
    } catch {
      return { userid: '', token: '' }
    }
  }

  // 解析粘贴的文本格式
  // 支持多行格式：Token: xxx\nOpenId: xxx\n...
  // 支持单行格式：Token: xxx OpenId: xxx OpenIdCipher: xxx CsecUUID: xxx UserId: xxx
  const parsePastedText = (text) => {
    const result = {
      token: '',
      openId: '',
      openIdCipher: '',
      csecuuid: '',
      userid: ''
    }
    
    // 统一处理：将文本按空格或换行分割，然后匹配键值对
    // 使用正则匹配 "Key: Value" 格式，Value 可能包含空格直到下一个 Key: 或文本结束
    const patterns = [
      { key: 'token', regex: /Token\s*:\s*([^\s]+(?:\s+(?!(?:Token|OpenId|OpenIdCipher|CsecUUID|UserId)\s*:)[^\s]+)*)/i },
      { key: 'openId', regex: /OpenId\s*:\s*([^\s]+)/i },
      { key: 'openIdCipher', regex: /OpenIdCipher\s*:\s*([^\s]+)/i },
      { key: 'csecuuid', regex: /CsecUUID\s*:\s*([^\s]+)/i },
      { key: 'userid', regex: /UserId\s*:\s*([^\s]+)/i }
    ]
    
    for (const { key, regex } of patterns) {
      const match = text.match(regex)
      if (match) {
        result[key] = match[1].trim()
      }
    }
    
    // 必须有 token 和 userid 才算有效解析
    if (result.token && result.userid) {
      return result
    }
    return null
  }

  // 构建账号URL
  const buildAccountUrl = (userid, token) => {
    return `https://i.meituan.com/mttouch/page/account?cevent=imt%2Fhomepage%2Fmine&userId=${userid}&token=${token}`
  }

  const buildUpdatedUrl = (oldUrl, userid, token) => {
    try {
      const u = new URL(oldUrl)
      u.searchParams.set('userId', userid)
      u.searchParams.set('token', token)
      return u.toString()
    } catch {
      return oldUrl
    }
  }

  const showMessage = (type, text) => {
    if (type === 'error') {
      toast.error(text)
    } else {
      toast.success(text)
    }
  }

  const handleAddOrUpdate = async () => {
    let userid = ''
    let token = ''
    let openId = ''
    let openIdCipher = ''
    let csecuuid = ''
    let accountUrl = ''

    // 只支持粘贴文本格式（Token: xxx OpenId: xxx...）
    const pastedData = parsePastedText(url.trim())
    if (pastedData) {
      userid = pastedData.userid
      token = pastedData.token
      openId = pastedData.openId
      openIdCipher = pastedData.openIdCipher
      csecuuid = pastedData.csecuuid
      accountUrl = buildAccountUrl(userid, token)
    } else {
      showMessage('error', '请粘贴 Token/OpenId/OpenIdCipher/CsecUUID/UserId 格式的文本')
      return
    }

    // 检查账号是否已存在
    const existingAccount = accounts.find(a => a.userid === userid)
    
    // 如果账号不存在且没有填备注，提示填写
    if (!existingAccount && !remark.trim()) {
      showMessage('error', '新账号请填写备注名')
      return
    }

    // 检查账号有效性
    let status = 'unchecked'
    try {
      const result = await accountsApi.checkStatus([{ userid, token }])
      if (result.data && result.data[0]?.code === 0) {
        status = 'normal'
      } else {
        status = 'invalid'
      }
    } catch {
      status = 'unchecked'
    }

    // 如果是粘贴文本格式，使用解析出的数据；否则使用抓取的数据
    const capturedExtras = pastedData ? null : (lastCaptured && lastCaptured.userid === userid && lastCaptured.token === token ? lastCaptured : null)

    // 如果账号已存在，使用原有备注名
    const finalRemark = existingAccount ? (remark.trim() || existingAccount.remark) : remark.trim()

    const newAccount = {
      remark: finalRemark,
      userid,
      token,
      url: accountUrl,
      status,  // 添加检查后的状态
      csecuuid: csecuuid || capturedExtras?.csecuuid || '',
      open_id: openId || capturedExtras?.openId || '',
      open_id_cipher: openIdCipher || capturedExtras?.openIdCipher || ''
    }

    try {
      const response = await accountsApi.capture(newAccount)
      // 直接使用返回的数据更新本地状态，而不是重新获取所有账号
      if (response.data) {
        const updatedAccount = response.data
        // 检查是否已存在于列表中
        const existingIndex = accounts.findIndex(a => a.id === updatedAccount.id)
        if (existingIndex >= 0) {
          // 更新现有账号
          const newAccounts = [...accounts]
          newAccounts[existingIndex] = updatedAccount
          setAccounts(newAccounts)
        } else {
          // 添加新账号
          setAccounts([...accounts, updatedAccount])
        }
      }
      setRemark('')
      setUrl('')
      setLastCaptured(null)
      const statusMsg = status === 'normal' ? '（有效）' : status === 'invalid' ? '（无效）' : ''
      showMessage('success', (existingAccount ? '已更新账号' : '已添加账号') + statusMsg)
    } catch (error) {
      showMessage('error', '保存失败: ' + error.message)
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) {
      showMessage('error', '请先选择要删除的记录')
      return
    }

    const confirmed = await confirm(`将删除 ${selectedRows.size} 条记录，是否继续？`, '删除确认')
    if (!confirmed) {
      return
    }

    try {
      for (const index of selectedRows) {
        const account = accounts[index]
        if (account?.id) {
          await accountsApi.delete(account.id)
        }
      }
      await loadAccounts(true)
      setSelectedRows(new Set())
      showMessage('success', '删除完成')
    } catch (error) {
      showMessage('error', '删除失败: ' + error.message)
    }
  }

  const handleImport = async () => {
    try {
      const result = await window.electronAPI.accountsImport()
      if (result.success && result.data) {
        // Import each account to API
        for (const account of result.data) {
          const { userid, token } = parseUserUrl(account.url)
          await accountsApi.capture({
            remark: account.remark,
            userid,
            token,
            url: account.url,
            csecuuid: account.csecuuid,
            open_id: account.openId,
            open_id_cipher: account.openIdCipher
          })
        }
        await loadAccounts(true)
        showMessage('success', '导入成功')
      } else if (!result.cancelled) {
        showMessage('error', result.error || '导入失败')
      }
    } catch (error) {
      showMessage('error', '导入失败: ' + error.message)
    }
  }

  const handleExport = async () => {
    try {
      const exportData = accounts.map(a => ({
        remark: a.remark,
        userid: a.userid,
        token: a.token,
        url: a.url,
        csecuuid: a.csecuuid,
        openId: a.open_id,
        openIdCipher: a.open_id_cipher,
        status: a.status
      }))
      await window.electronAPI.accountsExport(exportData)
    } catch (error) {
      showMessage('error', '导出失败: ' + error.message)
    }
  }

  const handleCheckAll = async () => {
    if (accounts.length === 0) {
      showMessage('error', '暂无账号')
      return
    }

    setLoading(true)
    let okCount = 0

    try {
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i]
        try {
          const result = await accountsApi.checkStatus([{ userid: account.userid, token: account.token }])
          const status = result.data && result.data[0]?.code === 0 ? 'normal' : 'invalid'
          await accountsApi.update(account.id, { status })
          if (status === 'normal') okCount++
        } catch {
          await accountsApi.update(account.id, { status: 'invalid' })
        }
      }
      await loadAccounts(true)
      showMessage('success', `检查完成：正常 ${okCount} / 共 ${accounts.length}`)
    } catch (error) {
      showMessage('error', '检查失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // 检查单个账号
  const handleCheckOne = async (account) => {
    setCheckingAccountId(account.id)
    try {
      const result = await accountsApi.checkStatus([{ userid: account.userid, token: account.token }])
      const status = result.data && result.data[0]?.code === 0 ? 'normal' : 'invalid'
      await accountsApi.update(account.id, { status })
      // 更新本地状态
      const newAccounts = accounts.map(a => 
        a.id === account.id ? { ...a, status } : a
      )
      setAccounts(newAccounts)
      showMessage('success', status === 'normal' ? '账号有效' : '账号已失效')
    } catch (error) {
      showMessage('error', '检查失败: ' + error.message)
    } finally {
      setCheckingAccountId(null)
    }
  }

  const handleResetCerts = async () => {
    setResettingCerts(true)
    try {
      const result = await window.electronAPI.resetCerts()
      if (result.success) {
        showMessage('success', '证书已重置，下次抓取时将重新生成')
      } else {
        showMessage('error', result.error || '重置证书失败')
      }
    } catch (e) {
      showMessage('error', e.message || '重置证书失败')
    } finally {
      setResettingCerts(false)
    }
  }

  const handleSearch = () => {
    if (!searchKeyword.trim()) {
      showMessage('error', '请输入搜索关键词')
      return
    }
    const keyword = searchKeyword.toLowerCase()
    const index = accounts.findIndex(a =>
      (a.remark || '').toLowerCase().includes(keyword) ||
      (a.userid || '').toLowerCase().includes(keyword) ||
      (a.token || '').toLowerCase().includes(keyword) ||
      (a.url || '').toLowerCase().includes(keyword)
    )
    if (index >= 0) {
      document.getElementById(`row-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      showMessage('success', `已定位到第 ${index + 1} 行`)
    } else {
      showMessage('error', '未找到匹配结果')
    }
  }

  const handleRowDoubleClick = (account) => {
    setRemark(account.remark)
    setUrl(account.url)
    setLastCaptured(null)
  }

  const handleCaptureToken = async () => {
    if (tokenCapturing) {
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
        setLastCaptured({
          userid: String(result.userid || ''),
          token: String(result.token || ''),
          csecuuid: String(result.csecuuid || ''),
          openId: String(result.openId || ''),
          openIdCipher: String(result.openIdCipher || '')
        })
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

  const handleContextMenu = (e, index) => {
    e.preventDefault()
    if (!selectedRows.has(index)) {
      setSelectedRows(new Set([index]))
    }
    setContextIndex(index)
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0 })
  }

  useEffect(() => {
    const handleClick = () => closeContextMenu()
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const toggleRowSelection = (index) => {
    const newSelected = new Set(selectedRows)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedRows(newSelected)
  }

  const allChecked = useMemo(() => selectedRows.size === accounts.length && accounts.length > 0, [selectedRows, accounts.length])

  // 打开扫描对话框
  const openScanDialog = (accountId) => {
    if (scanningAccountId) return // 防止重复点击
    setScanDialogAccountId(accountId)
    setScanStatusFilter(2) // 默认待使用
    setScanDialogOpen(true)
  }

  // 执行扫描
  const handleScanAccount = async () => {
    if (!scanDialogAccountId || scanningAccountId) return

    setScanDialogOpen(false)
    setScanningAccountId(scanDialogAccountId)
    setScanDialogAccountId(null)

    try {
      const result = await accountsApi.scan(scanDialogAccountId, scanStatusFilter)
      if (result.data?.success) {
        const stats = result.data.result || {}
        showMessage('success', `扫描完成: 扫描${stats.accounts_scanned || 0}个账号, 发现${stats.orders_found || 0}个新订单, 查询${stats.coupons_saved || 0}个新券码`)
        await loadAccounts(true)
      } else {
        showMessage('error', result.data?.error || '扫描失败')
      }
    } catch (error) {
      // 提取后端返回的错误信息
      const errorMsg = error.response?.data?.detail || error.message || '扫描失败'
      showMessage('error', errorMsg)
    } finally {
      setScanningAccountId(null)
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[720px] max-w-[90vw] bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-medium text-gray-800">修改账号</div>
              <button
                onClick={() => setEditOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={editUserid}
                  onChange={(e) => setEditUserid(e.target.value)}
                  placeholder="USERID"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
                <input
                  type="text"
                  value={editToken}
                  onChange={(e) => setEditToken(e.target.value)}
                  placeholder="TOKEN"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>

              <div className="mt-3 text-xs text-gray-500 mb-2">以下字段可选，如抹取失败可手动填写：</div>
              <div className="grid grid-cols-1 gap-3">
                <input
                  type="text"
                  value={editCsecuuid}
                  onChange={(e) => setEditCsecuuid(e.target.value)}
                  placeholder="csecuuid（可选）"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                />
                <input
                  type="text"
                  value={editOpenId}
                  onChange={(e) => setEditOpenId(e.target.value)}
                  placeholder="openId（可选）"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                />
                <input
                  type="text"
                  value={editOpenIdCipher}
                  onChange={(e) => setEditOpenIdCipher(e.target.value)}
                  placeholder="openIdCipher（可选）"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                />
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    if (editIndex < 0 || editIndex >= accounts.length) {
                      showMessage('error', '未选择要修改的账号')
                      return
                    }
                    const newUserid = String(editUserid || '').trim()
                    const newToken = String(editToken || '').trim()
                    if (!newUserid || !newToken) {
                      showMessage('error', '请填写 USERID 与 TOKEN')
                      return
                    }

                    const account = accounts[editIndex]
                    const nextUrl = buildUpdatedUrl(account.url || '', newUserid, newToken)

                    try {
                      await accountsApi.update(account.id, {
                        userid: newUserid,
                        token: newToken,
                        url: nextUrl,
                        csecuuid: editCsecuuid.trim(),
                        open_id: editOpenId.trim(),
                        open_id_cipher: editOpenIdCipher.trim()
                      })
                      await loadAccounts(true)
                      setEditOpen(false)
                      showMessage('success', '账号已修改')
                    } catch (error) {
                      showMessage('error', '修改失败: ' + error.message)
                    }
                  }}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  确认修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 扫描对话框 */}
      {scanDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[360px] bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-medium text-gray-800">扫描订单</div>
              <button
                onClick={() => setScanDialogOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <label className="block text-sm text-gray-600 mb-2">订单状态</label>
                <select
                  value={scanStatusFilter}
                  onChange={(e) => setScanStatusFilter(parseInt(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value={0}>全部订单</option>
                  <option value={2}>待使用</option>
                  <option value={3}>已完成</option>
                  <option value={4}>退款/售后</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setScanDialogOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleScanAccount}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  开始扫描
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="备注名（新账号必填，更新可留空）"
            className="flex-1 min-w-[120px] px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setLastCaptured(null)
            }}
            placeholder="粘贴 Token/OpenId/OpenIdCipher/CsecUUID/UserId 格式文本"
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
            onClick={handleResetCerts}
            disabled={resettingCerts || tokenCapturing}
            className="px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 flex items-center gap-2 disabled:opacity-50"
            title="重置代理证书（如抓取失败可尝试）"
          >
            <ShieldOff className="w-4 h-4" /> 重置证书
          </button>
        </div>
      </div>

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
                    checked={allChecked}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">userId</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">token</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">完整URL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {accounts.map((account, index) => (
                <tr
                  key={account.id}
                  id={`row-${index}`}
                  className={`hover:bg-gray-50 cursor-pointer ${selectedRows.has(index) ? 'bg-orange-50' : ''}`}
                  onDoubleClick={() => handleRowDoubleClick(account)}
                  onContextMenu={(e) => handleContextMenu(e, index)}
                >
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedRows.has(index)} onChange={() => toggleRowSelection(index)} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{account.remark}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{account.userid}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono truncate max-w-[150px]" title={account.token}>
                    {(account.token || '').substring(0, 20)}...
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[300px]" title={account.url}>
                    {account.url}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          account.status === 'normal'
                            ? 'bg-green-100 text-green-800'
                            : account.status === 'invalid'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {account.status === 'normal' ? '正常' : account.status === 'invalid' ? '失效' : '未检测'}
                      </span>
                      {account.disabled === 1 && (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                          已禁用
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCheckOne(account)
                        }}
                        disabled={checkingAccountId === account.id}
                        className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="检查账号有效性"
                      >
                        {checkingAccountId === account.id ? '检查中...' : '检查'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openScanDialog(account.id)
                        }}
                        disabled={scanningAccountId === account.id || account.status === 'invalid' || account.disabled === 1}
                        className="px-3 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="扫描此账号的订单和券码"
                      >
                        {scanningAccountId === account.id ? '扫描中...' : '扫描'}
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          try {
                            await accountsApi.toggleDisabled(account.id)
                            await loadAccounts(true)
                            showMessage('success', account.disabled === 1 ? '已启用账号' : '已禁用账号')
                          } catch (error) {
                            showMessage('error', '操作失败: ' + error.message)
                          }
                        }}
                        className={`px-3 py-1 text-xs rounded ${
                          account.disabled === 1
                            ? 'bg-green-50 text-green-600 hover:bg-green-100'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        }`}
                        title={account.disabled === 1 ? '启用此账号' : '禁用此账号'}
                      >
                        {account.disabled === 1 ? '启用' : '禁用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                    暂无账号，请添加账号
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const idx = contextIndex >= 0 ? contextIndex : [...selectedRows][0]
              const account = accounts[idx]
              if (!account) {
                showMessage('error', '未选择账号')
                closeContextMenu()
                return
              }
              setEditIndex(idx)
              setEditUserid(String(account.userid || ''))
              setEditToken(String(account.token || ''))
              setEditCsecuuid(String(account.csecuuid || ''))
              setEditOpenId(String(account.open_id || ''))
              setEditOpenIdCipher(String(account.open_id_cipher || ''))
              setEditOpen(true)
              closeContextMenu()
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            修改账号
          </button>
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
    </div>
  )
}

export default AccountPage
