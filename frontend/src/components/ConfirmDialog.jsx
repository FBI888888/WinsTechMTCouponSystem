import { useConfirmStore } from '../stores/confirmStore'

function ConfirmDialog() {
  const { isOpen, title, message, onConfirm, onCancel, closeConfirm } = useConfirmStore()

  if (!isOpen) return null

  const handleConfirm = () => {
    onConfirm?.()
    closeConfirm()
  }

  const handleCancel = () => {
    onCancel?.()
    closeConfirm()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="w-[360px] bg-white rounded-xl shadow-lg overflow-hidden animate-scale-in">
        <div className="p-5">
          {title && (
            <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
          )}
          <p className="text-gray-600">{message}</p>
        </div>
        <div className="flex border-t border-gray-100">
          <button
            onClick={handleCancel}
            className="flex-1 py-3 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 text-red-500 hover:bg-red-50 transition-colors border-l border-gray-100 font-medium"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
