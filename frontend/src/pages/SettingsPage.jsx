import { useState, useEffect, useRef } from 'react'
import { settingsApi } from '../api'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { getErrorMessage, isAbortError } from '../utils/requestFeedback'

function SettingsPage() {
  // 全局缓存
  const { settings, settingsLoaded, setSettings } = useDataStore()
  const toast = useToastStore()

  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const configsRequestIdRef = useRef(0)
  const configsAbortControllerRef = useRef(null)

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
    const requestId = ++configsRequestIdRef.current
    configsAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    configsAbortControllerRef.current = abortController
    setLoading(true)
    try {
      const response = await settingsApi.getAll(undefined, { signal: abortController.signal })
      if (requestId !== configsRequestIdRef.current) return
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
      if (isAbortError(error)) return
      if (requestId !== configsRequestIdRef.current) return
      console.error('Failed to load configs:', error)
      setConfigs(defaultConfigs)
    } finally {
      if (configsAbortControllerRef.current === abortController) {
        configsAbortControllerRef.current = null
      }
      if (requestId === configsRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadConfigs()
    return () => {
      configsAbortControllerRef.current?.abort()
      configsRequestIdRef.current += 1
    }
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
      toast.error('保存失败: ' + getErrorMessage(error, '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
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
