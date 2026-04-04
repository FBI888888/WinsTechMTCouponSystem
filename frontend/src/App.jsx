import { useEffect, useCallback } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useSoftwareAuthStore } from './stores/softwareAuthStore'
import LoginPage from './pages/LoginPage'
import AuthPage from './pages/AuthPage'
import MainLayout from './components/Layout/MainLayout'
import DashboardPage from './pages/DashboardPage'
import AccountPage from './pages/AccountPage'
import OrderListPage from './pages/OrderListPage'
import CouponQueryPage from './pages/CouponQueryPage'
import OrderQueryPage from './pages/OrderQueryPage'
import LogPage from './pages/LogPage'
import SettingsPage from './pages/SettingsPage'
import UserPage from './pages/UserPage'
import Toast from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'

function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  return isAuthenticated ? children : <Navigate to="/login" />
}

function App() {
  const isSoftwareAuthenticated = useSoftwareAuthStore((state) => state.isSoftwareAuthenticated)
  const isCheckingAuth = useSoftwareAuthStore((state) => state.isCheckingAuth)
  const setSoftwareAuthenticated = useSoftwareAuthStore((state) => state.setSoftwareAuthenticated)
  const initAuth = useSoftwareAuthStore((state) => state.initAuth)

  // Bug2 修复：应用启动时调用 initAuth() 检查本地授权
  useEffect(() => {
    initAuth()
  }, [initAuth])

  // Bug4 修复：用 useCallback 保持回调引用稳定，确保能精确移除监听器
  const handleAuthInvalid = useCallback(() => {
    setSoftwareAuthenticated(false)
  }, [setSoftwareAuthenticated])

  const handleAuthVerified = useCallback(() => {
    // 心跳验证成功，无需额外操作
  }, [])

  useEffect(() => {
    window.electronAPI.onAuthInvalid(handleAuthInvalid)
    window.electronAPI.onAuthVerified(handleAuthVerified)

    return () => {
      window.electronAPI.offAuthInvalid(handleAuthInvalid)
      window.electronAPI.offAuthVerified(handleAuthVerified)
    }
  }, [handleAuthInvalid, handleAuthVerified])

  // Bug2/9 修复：启动时显示检查中状态，避免 AuthPage 闪烁
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm">正在初始化...</p>
        </div>
      </div>
    )
  }

  // 软件未授权时显示授权页面
  if (!isSoftwareAuthenticated) {
    return (
      <AuthPage onAuthSuccess={() => setSoftwareAuthenticated(true)} />
    )
  }

  return (
    <HashRouter>
      <Toast />
      <ConfirmDialog />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="accounts" element={<AccountPage />} />
          <Route path="orders" element={<OrderListPage />} />
          <Route path="coupons" element={<CouponQueryPage />} />
          <Route path="order-query" element={<OrderQueryPage />} />
          <Route path="logs" element={<LogPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="users" element={<UserPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
