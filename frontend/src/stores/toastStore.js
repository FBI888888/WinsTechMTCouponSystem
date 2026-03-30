import { create } from 'zustand'

export const useToastStore = create((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = Date.now() + Math.random()
    const newToast = {
      id,
      type: 'info',
      duration: 3000,
      ...toast
    }
    set(state => ({
      toasts: [...state.toasts, newToast]
    }))
    return id
  },

  removeToast: (id) => {
    set(state => ({
      toasts: state.toasts.filter(t => t.id !== id)
    }))
  },

  clearAll: () => {
    set({ toasts: [] })
  },

  // 便捷方法
  success: (message, duration = 3000) => {
    return get().addToast({ type: 'success', message, duration })
  },

  error: (message, duration = 4000) => {
    return get().addToast({ type: 'error', message, duration })
  },

  warning: (message, duration = 3500) => {
    return get().addToast({ type: 'warning', message, duration })
  },

  info: (message, duration = 3000) => {
    return get().addToast({ type: 'info', message, duration })
  }
}))
