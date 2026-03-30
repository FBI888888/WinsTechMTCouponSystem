import { useState, useEffect } from 'react'
import { usersApi } from '../api'
import { Plus, Trash2, Edit, RefreshCw } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { confirm } from '../stores/confirmStore'

function UserPage() {
  // 全局缓存
  const { users, usersLoaded, setUsers } = useDataStore()
  const toast = useToastStore()

  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user' })

  const loadUsers = async (forceRefresh = false) => {
    if (usersLoaded && !forceRefresh) return
    setLoading(true)
    try {
      const response = await usersApi.getAll()
      setUsers(response.data)
    } catch (error) {
      console.error('Failed to load users:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleCreate = async () => {
    if (!formData.username || !formData.password) {
      toast.warning('请填写用户名和密码')
      return
    }

    try {
      await usersApi.create(formData)
      await loadUsers(true)
      setModalOpen(false)
      setFormData({ username: '', password: '', role: 'user' })
      toast.success('创建成功')
    } catch (error) {
      toast.error('创建失败: ' + error.message)
    }
  }

  const handleUpdate = async () => {
    if (!editingUser || !formData.username) {
      toast.warning('请填写用户名')
      return
    }

    try {
      const updateData = { username: formData.username, role: formData.role }
      if (formData.password) {
        updateData.password = formData.password
      }
      await usersApi.update(editingUser.id, updateData)
      await loadUsers(true)
      setModalOpen(false)
      setEditingUser(null)
      setFormData({ username: '', password: '', role: 'user' })
      toast.success('更新成功')
    } catch (error) {
      toast.error('更新失败: ' + error.message)
    }
  }

  const handleDelete = async (user) => {
    const confirmed = await confirm(`确定要删除用户 ${user.username} 吗？`, '删除确认')
    if (!confirmed) {
      return
    }

    try {
      await usersApi.delete(user.id)
      await loadUsers(true)
      toast.success('删除成功')
    } catch (error) {
      toast.error('删除失败: ' + error.message)
    }
  }

  const handleToggleActive = async (user) => {
    try {
      await usersApi.toggleActive(user.id)
      await loadUsers(true)
    } catch (error) {
      toast.error('操作失败: ' + error.message)
    }
  }

  const openEditModal = (user) => {
    setEditingUser(user)
    setFormData({ username: user.username, password: '', role: user.role })
    setModalOpen(true)
  }

  const openCreateModal = () => {
    setEditingUser(null)
    setFormData({ username: '', password: '', role: 'user' })
    setModalOpen(true)
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex gap-2">
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> 新增用户
        </button>
        <button
          onClick={loadUsers}
          disabled={loading}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-medium mb-4">{editingUser ? '编辑用户' : '新增用户'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">用户名</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  密码 {editingUser && <span className="text-gray-400">(留空则不修改)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">角色</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={editingUser ? handleUpdate : handleCreate}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
              >
                {editingUser ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">{user.id}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{user.username}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => handleToggleActive(user)}
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {user.is_active ? '启用' : '禁用'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{user.created_at}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(user)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                    暂无用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default UserPage
