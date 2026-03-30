import { create } from 'zustand'
import { authApi } from '../api'

export const useAuthStore = create((set, get) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),

  login: async (username, password) => {
    try {
      const response = await authApi.login(username, password)
      const { access_token, user } = response.data

      localStorage.setItem('token', access_token)
      localStorage.setItem('user', JSON.stringify(user))

      set({
        user,
        token: access_token,
        isAuthenticated: true
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Login failed'
      }
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({
      user: null,
      token: null,
      isAuthenticated: false
    })
  },

  checkAuth: async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      set({ isAuthenticated: false })
      return false
    }

    try {
      const response = await authApi.getMe()
      set({ user: response.data, isAuthenticated: true })
      return true
    } catch (error) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      set({ user: null, token: null, isAuthenticated: false })
      return false
    }
  }
}))
