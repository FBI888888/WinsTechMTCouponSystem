import React, { useMemo, useRef, useState, useEffect } from 'react'
import { Users, Plus, Trash2, Download, Upload, Search, RefreshCw, Radio, ShieldOff } from 'lucide-react'
import { showToast } from '../components/ToastHost'

function AccountPage({ accounts, onAccountsChange }) {
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
    showToast(type, text)
  }

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

    let status = '未检测'
    try {
      const result = await window.electronAPI.accountsCheckStatus({ userid, token })
      status = result.success && result.code === 0 ? '正常' : '失效'
    } catch {
      status = '失效'
    }

    const capturedExtras = (lastCaptured && lastCaptured.userid === userid && lastCaptured.token === token) ? lastCaptured : null

    const newAccount = {
      remark: remark.trim(),
      userid,
      token,
      url: url.trim(),
      status,
      csecuuid: capturedExtras?.csecuuid || '',
      openId: capturedExtras?.openId || '',
      openIdCipher: capturedExtras?.openIdCipher || ''
    }

    const existingIndex = accounts.findIndex(a => a.remark === newAccount.remark || a.userid === newAccount.userid)
    let newAccounts
    if (existingIndex >= 0) {
      newAccounts = [...accounts]
      const old = newAccounts[existingIndex] || {}
      newAccounts[existingIndex] = {
        ...old,
        ...newAccount,
        csecuuid: newAccount.csecuuid || old.csecuuid || '',
        openId: newAccount.openId || old.openId || '',
        openIdCipher: newAccount.openIdCipher || old.openIdCipher || ''
      }
    } else {
      newAccounts = [...accounts, newAccount]
    }

    await window.electronAPI.accountsSave(newAccounts)
    onAccountsChange()
    setRemark('')
    setUrl('')
    showMessage('success', '已添加/更新账号')
  }

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

  const handleExport = async () => {
    const result = await window.electronAPI.accountsExport(accounts)
    if (result.success) {
      showMessage('success', '导出成功')
    } else if (!result.cancelled) {
      showMessage('error', result.error || '导出失败')
    }
  }

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

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <Users className="w-5 h-5 text-orange-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">美团账号管理</h1>
      </div>

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

                    const newAccounts = [...accounts]
                    const old = newAccounts[editIndex] || {}
                    const nextUrl = buildUpdatedUrl(old.url || '', newUserid, newToken)

                    newAccounts[editIndex] = {
                      ...old,
                      userid: newUserid,
                      token: newToken,
                      url: nextUrl,
                      status: '未检测',
                      csecuuid: editCsecuuid.trim(),
                      openId: editOpenId.trim(),
                      openIdCipher: editOpenIdCipher.trim()
                    }

                    await window.electronAPI.accountsSave(newAccounts)
                    onAccountsChange()
                    setEditOpen(false)
                    showMessage('success', '账号已修改')
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
            onChange={(e) => {
              setUrl(e.target.value)
              setLastCaptured(null)
            }}
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
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        account.status === '正常'
                          ? 'bg-green-100 text-green-800'
                          : account.status === '失效'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                      }`}
                    >
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
              setEditOpenId(String(account.openId || ''))
              setEditOpenIdCipher(String(account.openIdCipher || ''))
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
