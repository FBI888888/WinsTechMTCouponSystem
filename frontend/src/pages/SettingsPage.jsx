import { useState, useEffect } from 'react'
import { settingsApi } from '../api'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'

function SettingsPage() {
  // 全局缓存
  const { settings, settingsLoaded, setSettings } = useDataStore()
  const toast = useToastStore()

  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const defaultConfigs = [
    { config_key: 'scan_interval', config_value: '30', config_type: 'number', category: 'scan', description: '扫描间隔（分钟）', is_public: false },
    { config_key: 'scan_request_interval', config_value: '0.7', config_type: 'number', category: 'scan', description: '请求间隔（秒）', is_public: false },
    { config_key: 'scan_max_retries', config_value: '3', config_type: 'number', category: 'scan', description: '最大重试次数', is_public: false },
    { config_key: 'proxy_port', config_value: '8898', config_type: 'number', category: 'proxy', description: '抓包端口', is_public: false },
    { config_key: 'log_level', config_value: 'INFO', config_type: 'string', category: 'log', description: '日志级别', is_public: false },
    { config_key: 'log_retention_days', config_value: '30', config_type: 'number', category: 'log', description: '日志保留天数', is_public: false }
  ]

  const loadConfigs = async (forceRefresh = false) => {
    if (settingsLoaded && !forceRefresh) {
      setConfigs(settings)
      return
    }
    setLoading(true)
    try {
      const response = await settingsApi.getAll()
      const existingKeys = response.data.map(c => c.config_key)
      // Add missing default configs
      const allConfigs = [...response.data]
      defaultConfigs.forEach(config => {
        if (!existingKeys.includes(config.config_key)) {
          allConfigs.push(config)
        }
      })
      setConfigs(allConfigs)
      setSettings(allConfigs)
    } catch (error) {
      console.error('Failed to load configs:', error)
      setConfigs(defaultConfigs)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfigs()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const config of configs) {
        await settingsApi.set(config.config_key, {
          config_key: config.config_key,
          config_value: config.config_value,
          config_type: config.config_type,
          category: config.category,
          is_public: config.is_public,
          description: config.description
        })
      }
      toast.success('保存成功')
    } catch (error) {
      console.error('Save failed:', error)
      toast.error('保存失败: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-800">系统设置</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="space-y-4">
          {configs.map((config, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="w-48">
                <label className="text-sm font-medium text-gray-700">{config.description}</label>
                <p className="text-xs text-gray-400">{config.config_key}</p>
              </div>
              <input
                type={config.config_type === 'number' ? 'number' : 'text'}
                value={config.config_value || ''}
                onChange={(e) => {
                  const newConfigs = [...configs]
                  newConfigs[index].config_value = e.target.value
                  setConfigs(newConfigs)
                }}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
