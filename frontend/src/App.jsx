import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import LoginPage from './pages/LoginPage'
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
