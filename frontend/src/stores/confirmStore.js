import { create } from 'zustand'

export const useConfirmStore = create((set, get) => ({
  isOpen: false,
  title: '',
  message: '',
  onConfirm: null,
  onCancel: null,

  showConfirm: ({ title, message, onConfirm, onCancel }) => {
    set({
      isOpen: true,
      title: title || '确认',
      message: message || '确定要执行此操作吗？',
      onConfirm,
      onCancel
    })
  },

  closeConfirm: () => {
    set({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: null,
      onCancel: null
    })
  }
}))

// 便捷方法：返回 Promise
export const confirm = (message, title = '确认') => {
  return new Promise((resolve) => {
    const store = useConfirmStore.getState()
    store.showConfirm({
      title,
      message,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}
