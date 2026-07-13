import { create } from 'zustand'

const initialState = {
  isOpen: false,
  message: '',
  generalPageUrl: '',
  requestCode: '',
  riskLevel: '',
  yodaCode: null,
  status: null
}

const normalizeRiskControl = (details = {}) => ({
  message: details.message || '查询券码时触发了美团风控，请完成验证后重新查询。',
  generalPageUrl: String(details.generalPageUrl || '').trim(),
  requestCode: details.requestCode || '',
  riskLevel: details.riskLevel || '',
  yodaCode: details.yodaCode ?? null,
  status: details.status ?? null
})

export const useRiskControlStore = create((set) => ({
  ...initialState,

  showRiskControl: (details) => {
    const normalized = normalizeRiskControl(details)
    if (!normalized.generalPageUrl) return

    set((state) => state.isOpen
      ? state
      : { ...normalized, isOpen: true })
  },

  closeRiskControl: () => set(initialState)
}))