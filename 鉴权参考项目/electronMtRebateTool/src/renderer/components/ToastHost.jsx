import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Info } from 'lucide-react'

let pushToast = null

export function showToast(type, text, options = {}) {
  if (!pushToast) return
  pushToast({ type: type || 'info', text: String(text || ''), duration: options.duration ?? 3000 })
}

function ToastHost() {
  const [toasts, setToasts] = useState([])

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  useEffect(() => {
    pushToast = (toast) => {
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
      const item = { id, ...toast }
      setToasts((prev) => [item, ...prev].slice(0, 5))
      const duration = Math.max(0, Number(item.duration) || 0)
      if (duration) {
        setTimeout(() => {
          removeToast(id)
        }, duration)
      }
    }

    return () => {
      pushToast = null
    }
  }, [])

  const getStyle = (type) => {
    if (type === 'success') return 'bg-green-50 text-green-700 border-green-100'
    if (type === 'error') return 'bg-red-50 text-red-700 border-red-100'
    return 'bg-blue-50 text-blue-700 border-blue-100'
  }

  const getIcon = (type) => {
    if (type === 'success') return <CheckCircle className="w-4 h-4 flex-shrink-0" />
    if (type === 'error') return <XCircle className="w-4 h-4 flex-shrink-0" />
    return <Info className="w-4 h-4 flex-shrink-0" />
  }

  if (!toasts.length) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto min-w-[240px] max-w-[360px] px-4 py-3 rounded-lg border shadow-sm flex items-start gap-2 ${getStyle(t.type)}`}
        >
          {getIcon(t.type)}
          <div className="flex-1 text-sm leading-snug break-words">{t.text}</div>
          <button
            type="button"
            onClick={() => removeToast(t.id)}
            className="ml-2 text-xs text-current/60 hover:text-current"
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default ToastHost
