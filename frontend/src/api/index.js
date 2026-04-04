import axios from 'axios'

// 根据环境自动选择API地址
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,  // 2分钟超时
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor - handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authApi = {
  login: (username, password) => api.post('/api/auth/login', { username, password }),
  logout: () => api.post('/api/auth/logout'),
  getMe: () => api.get('/api/auth/me')
}

// Accounts API
export const accountsApi = {
  getAll: (params) => api.get('/api/accounts', { params }),
  get: (id) => api.get(`/api/accounts/${id}`),
  create: (data) => api.post('/api/accounts', data),
  update: (id, data) => api.put(`/api/accounts/${id}`, data),
  delete: (id) => api.delete(`/api/accounts/${id}`),
  capture: (data) => api.post('/api/accounts/capture', data),
  checkStatus: (data) => api.post('/api/accounts/check', data),
  scan: (id, statusFilter = 2) => api.post(`/api/accounts/${id}/scan?status_filter=${statusFilter}`),
  toggleDisabled: (id) => api.post(`/api/accounts/${id}/toggle-disabled`),
  getRandomGiftId: (accountId) => api.get('/api/accounts/random-gift-id', { params: { account_id: accountId } })
}

// Orders API
export const ordersApi = {
  getAll: (params, config = {}) => api.get('/api/orders', { ...config, params }),
  get: (id) => api.get(`/api/orders/${id}`),
  delete: (id) => api.delete(`/api/orders/${id}`),
  getExistingIds: (accountId) => api.get('/api/orders/existing-ids', { params: { account_id: accountId } }),
  saveBatch: (data) => api.post('/api/orders/save-batch', data),
  saveCoupon: (data) => api.post('/api/orders/save-coupon', data),
  updateQueryStatus: (data) => api.post('/api/orders/update-query-status', data),
  getPendingCouponQuery: (params) => api.get('/api/orders/pending-coupon-query', { params }),
  queryOrderByOrderId: (data) => api.post('/api/orders/query-by-order-id', data)
}

// Coupons API
export const couponsApi = {
  getAll: (params, config = {}) => api.get('/api/coupons', { ...config, params }),
  get: (id) => api.get(`/api/coupons/${id}`),
  query: (data, config = {}) => api.post('/api/coupons/query', data, config),
  queryBackend: (data, config = {}) => api.post('/api/coupons/query-backend', data, config),
  batchUpdate: (data, config = {}) => api.post('/api/coupons/batch-update', data, config),
  getDetailByCode: (couponCode, config = {}) => api.get(`/api/coupons/detail/by-code/${couponCode}`, config)
}

// Users API
export const usersApi = {
  getAll: (params, config = {}) => api.get('/api/users', { ...config, params }),
  get: (id) => api.get(`/api/users/${id}`),
  create: (data) => api.post('/api/users', data),
  update: (id, data) => api.put(`/api/users/${id}`, data),
  delete: (id) => api.delete(`/api/users/${id}`),
  resetPassword: (id, password) => api.post(`/api/users/${id}/reset-password?new_password=${password}`),
  toggleActive: (id) => api.post(`/api/users/${id}/toggle-active`)
}

// Logs API
export const logsApi = {
  getOperations: (params, config = {}) => api.get('/api/logs/operations', { ...config, params }),
  getLogins: (params, config = {}) => api.get('/api/logs/logins', { ...config, params }),
  getScheduledTasks: (params, config = {}) => api.get('/api/logs/scheduled-tasks', { ...config, params }),
  getScheduledTaskDetail: (id, config = {}) => api.get(`/api/logs/scheduled-tasks/${id}`, config),
  clearOperations: () => api.delete('/api/logs/operations'),
  clearLogins: () => api.delete('/api/logs/logins'),
  clearScheduledTasks: () => api.delete('/api/logs/scheduled-tasks')
}

// Settings API
export const settingsApi = {
  getAll: (params, config = {}) => api.get('/api/settings', { ...config, params }),
  get: (key) => api.get(`/api/settings/${key}`),
  set: (key, data) => api.put(`/api/settings/${key}`, data),
  create: (data) => api.post('/api/settings', data),
  delete: (key) => api.delete(`/api/settings/${key}`)
}

// Stats API
export const statsApi = {
  getDashboard: (config = {}) => api.get('/api/stats/dashboard', config)
}

export default api
