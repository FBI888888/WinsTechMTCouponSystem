import React from 'react'
import { Users, QrCode, Globe, History, Ticket, Radio, Gift } from 'lucide-react'

const menuItems = [
  { id: 'account', label: '美团账号', icon: Users, description: '账号管理' },
  { id: 'ck_qrcode', label: 'CK券码制作', icon: QrCode, description: '使用CK制作券码' },
  { id: 'web_qrcode', label: 'Web券码制作', icon: Globe, description: 'Web方式制作券码' },
  { id: 'orders', label: '订单查询', icon: History, description: '查询订单信息' },
  { id: 'coupons', label: '券码查询', icon: Ticket, description: '查询券码详情' },
  { id: 'gift_monitor', label: '礼物领取监控', icon: Radio, description: '监控礼物领取' }
]

function Sidebar({ currentPage, onPageChange }) {
  return (
    <aside className="w-48 bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col shadow-xl">
      {/* Logo区域 */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shadow-lg border border-white/10">
            <Gift className="w-6 h-6 text-slate-100" />
          </div>
          <div>
            <h1 className="font-bold text-lg">美团券码工具</h1>
            <p className="text-xs text-slate-300">v2.6</p>
          </div>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-3">
          {menuItems.map(item => {
            const Icon = item.icon
            const isActive = currentPage === item.id

            return (
              <li key={item.id}>
                <button
                  onClick={() => onPageChange(item.id)}
                  className={`w-full flex items-center gap-2 px-2 py-3 rounded-xl transition-all duration-200 group
                    ${isActive
                      ? 'bg-white text-slate-900 shadow-lg'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
                  <div className="text-left">
                    <div className="font-medium text-sm">{item.label}</div>
                    <div className={`text-xs ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                      {item.description}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* 底部信息 */}
      <div className="p-4 border-t border-slate-700">
        <div className="text-xs text-slate-400 text-center">
          <p>聚合云 & 问世科技</p>
          <p className="mt-1">© 2025 Wins Tech</p>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
