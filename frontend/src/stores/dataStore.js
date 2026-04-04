import { create } from 'zustand'

// 全局请求 Promise 缓存，防止重复请求
let accountsPromise = null
let accountsRequestId = 0

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
    if (accountsLoading && accountsPromise && !forceRefresh) {
      return accountsPromise
    }

    // 发起新请求
    const requestId = ++accountsRequestId
    setAccountsLoading(true)
    accountsPromise = api.getAll().then(response => {
      if (requestId !== accountsRequestId) {
        return get().accounts
      }

      setAccounts(response.data)
      return response.data
    }).catch(error => {
      if (requestId === accountsRequestId) {
        accountsPromise = null
        setAccountsLoading(false)
      }
      throw error
    })

    return accountsPromise
  },

  // 清除账号缓存（强制下次重新加载）
  invalidateAccounts: () => {
    accountsPromise = null
    accountsRequestId += 1
    set({ accountsLoaded: false, accountsLoading: false })
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

  // 订单页面筛选条件（持久化）
  orderSelectedAccountId: '',
  orderStatusFilter: '2',
  setOrderSelectedAccountId: (id) => set({ orderSelectedAccountId: id }),
  setOrderStatusFilter: (filter) => set({ orderStatusFilter: filter }),

  // 订单同步状态（持久化，页面切换不丢失）
  orderSyncing: false,
  orderSyncProgress: { current: 0, total: 0, message: '' },
  orderSyncRunId: 0,  // 用于停止同步
  setOrderSyncing: (syncing) => set({ orderSyncing: syncing }),
  setOrderSyncProgress: (progress) => set({ orderSyncProgress: progress }),
  incrementSyncRunId: () => set((state) => ({ orderSyncRunId: state.orderSyncRunId + 1 })),

  // 券码查询状态（持久化，页面切换不丢失）
  orderQuerying: false,
  orderQueryProgress: { current: 0, total: 0, message: '' },
  orderQueryRunId: 0,  // 用于停止查询
  setOrderQuerying: (querying) => set({ orderQuerying: querying }),
  setOrderQueryProgress: (progress) => set({ orderQueryProgress: progress }),
  incrementQueryRunId: () => set((state) => ({ orderQueryRunId: state.orderQueryRunId + 1 })),

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
    accountsRequestId += 1
    return set({
      accounts: [],
      accountsLoaded: false,
      accountsLoading: false,
      orders: [],
      ordersTotal: 0,
      ordersPage: 1,
      ordersLoaded: false,
      orderSelectedAccountId: '',
      orderStatusFilter: '2',
      orderSyncing: false,
      orderSyncProgress: { current: 0, total: 0, message: '' },
      orderSyncRunId: 0,
      orderQuerying: false,
      orderQueryProgress: { current: 0, total: 0, message: '' },
      orderQueryRunId: 0,
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
