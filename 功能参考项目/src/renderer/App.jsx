import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import AccountPage from './pages/AccountPage'
import CKQrcodePage from './pages/CKQrcodePage'
import WebQrcodePage from './pages/WebQrcodePage'
import OrdersPage from './pages/OrdersPage'
import CouponsPage from './pages/CouponsPage'
import GiftMonitorPage from './pages/GiftMonitorPage'
import AuthPage from './pages/AuthPage'

function App() {
  const [currentPage, setCurrentPage] = useState('account')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [accounts, setAccounts] = useState([])

  // 加载账号列表
  const loadAccounts = useCallback(async () => {
    try {
      const data = await window.electronAPI.accountsList()
      setAccounts(data || [])
    } catch (error) {
      console.error('加载账号失败:', error)
    }
  }, [])

  useEffect(() => {
    // 监听授权失效事件
    window.electronAPI.onAuthInvalid((data) => {
      console.log('授权失效:', data)
      setIsAuthenticated(false)
    })

    window.electronAPI.onAuthVerified((data) => {
      console.log('授权验证成功:', data)
    })

    return () => {
      window.electronAPI.removeAllListeners('auth-invalid')
      window.electronAPI.removeAllListeners('auth-verified')
    }
  }, [])

  // 授权成功后加载账号
  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts()
    }
  }, [isAuthenticated, loadAccounts])

  // 授权成功回调
  const handleAuthSuccess = () => {
    setIsAuthenticated(true)
  }

  // 未授权，显示授权页面
  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />
  }

  // 页面配置
  const pages = [
    { key: 'account', component: <AccountPage accounts={accounts} onAccountsChange={loadAccounts} /> },
    { key: 'ck_qrcode', component: <CKQrcodePage accounts={accounts} onAccountsChange={loadAccounts} /> },
    { key: 'web_qrcode', component: <WebQrcodePage accounts={accounts} onAccountsChange={loadAccounts} /> },
    { key: 'orders', component: <OrdersPage accounts={accounts} onAccountsChange={loadAccounts} /> },
    { key: 'coupons', component: <CouponsPage accounts={accounts} onAccountsChange={loadAccounts} /> },
    { key: 'gift_monitor', component: <GiftMonitorPage /> }
  ]

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 左侧导航栏 */}
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      
      {/* 主内容区 - 所有页面同时渲染，通过display控制显示隐藏以保持状态 */}
      <main className="flex-1 overflow-hidden relative">
        {pages.map(({ key, component }) => (
          <div 
            key={key}
            className="absolute inset-0 overflow-auto"
            style={{ display: currentPage === key ? 'block' : 'none' }}
          >
            {component}
          </div>
        ))}
      </main>
    </div>
  )
}

export default App
