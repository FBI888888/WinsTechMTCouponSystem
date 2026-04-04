import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ToastHost from './components/ToastHost'
import AccountPage from './pages/AccountPage'
import RebateQueryPage from './pages/RebateQueryPage'
import AuthPage from './pages/AuthPage'

function App() {
  const [currentPage, setCurrentPage] = useState('account')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [accounts, setAccounts] = useState([])

  const loadAccounts = useCallback(async () => {
    try {
      const data = await window.electronAPI.accountsList()
      setAccounts(data || [])
    } catch (error) {
      console.error('加载账号失败:', error)
    }
  }, [])

  useEffect(() => {
    window.electronAPI.onAuthInvalid(() => {
      setIsAuthenticated(false)
    })

    window.electronAPI.onAuthVerified(() => {})

    return () => {
      window.electronAPI.removeAllListeners('auth-invalid')
      window.electronAPI.removeAllListeners('auth-verified')
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts()
    }
  }, [isAuthenticated, loadAccounts])

  const handleAuthSuccess = () => {
    setIsAuthenticated(true)
  }

  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />
  }

  const pages = [
    { key: 'account', component: <AccountPage accounts={accounts} onAccountsChange={loadAccounts} /> },
    { key: 'rebate', component: <RebateQueryPage accounts={accounts} /> }
  ]

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      <main className="flex-1 overflow-hidden relative">
        <ToastHost />
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
