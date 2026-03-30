import { create } from 'zustand'

// 全局请求 Promise 缓存，防止重复请求
let accountsPromise = null

// 全局数据缓存 store，用于缓存各页面数据
export const useDataStore = create((set, get) => ({
  // 账号列表缓存
  accounts: [],
  accountsLoaded: false,
  accountsLoading: false, // 防止重复请求
  setAccounts: (accounts) => {
    accountsPromise = null // 请求完成后清除
    set({ accounts, accountsLoaded: true, accountsLoading: false })
  },
  setAccountsLoading: (loading) => set({ accountsLoading: loading }),

  // 获取账号数据（带请求去重和强制刷新支持）
  fetchAccounts: async (api, forceRefresh = false) => {
    const { accountsLoaded, accountsLoading, setAccountsLoading, setAccounts } = get()

    // 如果已加载且不需要强制刷新，直接返回数据
    if (accountsLoaded && !forceRefresh) {
      return get().accounts
    }

    // 如果正在加载中，返回已有的 Promise
    if (accountsLoading && accountsPromise) {
      return accountsPromise
    }

    // 发起新请求
    setAccountsLoading(true)
    accountsPromise = api.getAll().then(response => {
      setAccounts(response.data)
      return response.data
    }).catch(error => {
      accountsPromise = null
      setAccountsLoading(false)
      throw error
    })

    return accountsPromise
  },

  // 清除账号缓存（强制下次重新加载）
  invalidateAccounts: () => {
    accountsPromise = null
    set({ accountsLoaded: false })
  },

  // 订单列表缓存
  orders: [],
  ordersTotal: 0,
  ordersPage: 1,
  ordersPageSize: 50,
  ordersLoaded: false,
  ordersFilters: { account_id: '', status_filter: '' },
  setOrders: (orders, total, page, pageSize, filters) => set({
    orders,
    ordersTotal: total,
    ordersPage: page,
    ordersPageSize: pageSize,
    ordersLoaded: true,
    ordersFilters: filters
  }),
  updateOrdersPage: (page) => set({ ordersPage: page }),

  // 券码查询结果缓存
  couponQueryResults: [],
  couponQueryCodes: '',
  setCouponQueryData: (results, codes) => set({ couponQueryResults: results, couponQueryCodes: codes }),
  clearCouponQueryData: () => set({ couponQueryResults: [], couponQueryCodes: '' }),

  // 日志缓存
  logs: [],
  logsTotal: 0,
  logsPage: 1,
  logsPageSize: 50,
  logsLoaded: false,
  logsTab: 'operations',
  setLogs: (logs, total, page, pageSize, tab) => set({
    logs,
    logsTotal: total,
    logsPage: page,
    logsPageSize: pageSize,
    logsLoaded: true,
    logsTab: tab
  }),

  // 用户列表缓存
  users: [],
  usersLoaded: false,
  setUsers: (users) => set({ users, usersLoaded: true }),

  // 系统设置缓存
  settings: [],
  settingsLoaded: false,
  setSettings: (settings) => set({ settings, settingsLoaded: true }),

  // 清除所有缓存
  clearCache: () => {
    accountsPromise = null
    return set({
      accounts: [],
      accountsLoaded: false,
      accountsLoading: false,
      orders: [],
      ordersTotal: 0,
      ordersPage: 1,
      ordersLoaded: false,
      couponQueryResults: [],
      couponQueryCodes: '',
      logs: [],
      logsTotal: 0,
      logsPage: 1,
      logsLoaded: false,
      users: [],
      usersLoaded: false,
      settings: [],
      settingsLoaded: false
    })
  }
}))
