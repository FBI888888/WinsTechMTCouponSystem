import { useState, useEffect, useRef } from 'react'
import { ServerCog, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import { settingsApi } from '../api'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { getErrorMessage, isAbortError } from '../utils/requestFeedback'

const emptyNativeConfig = {
  enabled: false,
  service_url: '',
  api_key_configured: false,
  configured: false,
  enabled_source: 'environment',
  service_url_source: 'environment',
  api_key_source: 'environment'
}

function SettingsPage() {
  const { settings, settingsLoaded, setSettings } = useDataStore()
  const toast = useToastStore()

  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nativeConfig, setNativeConfig] = useState(emptyNativeConfig)
  const [nativeApiKey, setNativeApiKey] = useState('')
  const [nativeConfigLoading, setNativeConfigLoading] = useState(true)
  const [nativeConfigSaving, setNativeConfigSaving] = useState(false)
  const [nativeHealthLoading, setNativeHealthLoading] = useState(false)
  const [nativeHealth, setNativeHealth] = useState(null)
  const [nativeError, setNativeError] = useState('')
  const configsRequestIdRef = useRef(0)
  const configsAbortControllerRef = useRef(null)
  const nativeAbortControllerRef = useRef(null)

  const defaultConfigs = [
    { config_key: 'scan_enabled', config_value: 'true', config_type: 'boolean', category: 'scan', description: '启用后端自动扫描任务', is_public: false },
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

  const loadNativeConfig = async () => {
    nativeAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    nativeAbortControllerRef.current = abortController
    setNativeConfigLoading(true)
    setNativeError('')
    try {
      const response = await settingsApi.getNativeIntegration({ signal: abortController.signal })
      setNativeConfig(response.data)
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Failed to load Native integration config:', error)
      setNativeError(getErrorMessage(error, '读取统一调度配置失败'))
    } finally {
      if (nativeAbortControllerRef.current === abortController) {
        nativeAbortControllerRef.current = null
        setNativeConfigLoading(false)
      }
    }
  }

  useEffect(() => {
    loadConfigs()
    loadNativeConfig()
    return () => {
      configsAbortControllerRef.current?.abort()
      nativeAbortControllerRef.current?.abort()
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

  const testNativeConnection = async ({ showSuccessToast = true } = {}) => {
    setNativeHealthLoading(true)
    setNativeError('')
    try {
      const response = await settingsApi.testNativeIntegration()
      setNativeHealth(response.data)
      if (!response.data.ok) {
        setNativeError(response.data.message || '统一调度中心连接失败')
        return false
      }
      if (showSuccessToast) {
        toast.success(`连接成功，已授权 ${response.data.authorized_instances || 0} 个实例`)
      }
      return true
    } catch (error) {
      console.error('Native integration health check failed:', error)
      setNativeHealth(null)
      setNativeError(getErrorMessage(error, '统一调度中心连接失败'))
      return false
    } finally {
      setNativeHealthLoading(false)
    }
  }

  const handleSaveNativeConfig = async () => {
    const serviceUrl = nativeConfig.service_url.trim().replace(/\/$/, '')
    const apiKey = nativeApiKey.trim()
    setNativeError('')

    if (nativeConfig.enabled) {
      if (!serviceUrl) {
        setNativeError('启用 Native 账号前必须填写统一调度服务地址')
        return
      }
      try {
        const parsed = new URL(serviceUrl)
        if (import.meta.env.PROD && parsed.protocol !== 'https:') {
          setNativeError('生产环境统一调度服务地址必须使用 HTTPS')
          return
        }
      } catch {
        setNativeError('统一调度服务地址格式不正确')
        return
      }
      if (!nativeConfig.api_key_configured && !apiKey) {
        setNativeError('启用 Native 账号前必须填写 API Key')
        return
      }
    }

    setNativeConfigSaving(true)
    try {
      const response = await settingsApi.updateNativeIntegration({
        enabled: nativeConfig.enabled,
        service_url: serviceUrl,
        api_key: apiKey || null,
        clear_api_key: false
      })
      setNativeConfig(response.data)
      setNativeApiKey('')
      toast.success('统一调度配置已加密保存')
      if (response.data.enabled) {
        await testNativeConnection({ showSuccessToast: false })
      } else {
        setNativeHealth(null)
      }
    } catch (error) {
      console.error('Failed to save Native integration config:', error)
      setNativeError(getErrorMessage(error, '保存统一调度配置失败'))
    } finally {
      setNativeConfigSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-xl bg-white p-6 shadow-sm" aria-labelledby="native-integration-heading">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                <ServerCog className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h1 id="native-integration-heading" className="text-balance text-lg font-semibold text-gray-900">
                  统一调度中心
                </h1>
                <p className="mt-1 max-w-2xl text-pretty text-sm text-gray-500">
                  在客户端录入连接信息，由服务端加密保存。API Key 不会写入安装包，也不会再次返回到客户端。
                </p>
              </div>
            </div>
            {nativeHealthLoading ? (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">检测中</span>
            ) : nativeHealth?.ok ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                <Wifi className="size-3.5" aria-hidden="true" /> 已连接
              </span>
            ) : nativeHealth ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                <WifiOff className="size-3.5" aria-hidden="true" /> 连接失败
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">尚未检测</span>
            )}
          </div>

          {nativeConfigLoading ? (
            <div className="mt-5 space-y-4" aria-label="正在加载统一调度配置">
              <div className="h-10 rounded-lg bg-gray-100" />
              <div className="h-10 rounded-lg bg-gray-100" />
              <div className="h-8 w-40 rounded-lg bg-gray-100" />
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div>
                <label htmlFor="native-service-url" className="text-sm font-medium text-gray-700">
                  统一调度服务地址
                </label>
                <input
                  id="native-service-url"
                  type="url"
                  value={nativeConfig.service_url}
                  onChange={(event) => setNativeConfig({ ...nativeConfig, service_url: event.target.value })}
                  placeholder="https://wxcode.example.com"
                  disabled={nativeConfigSaving}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-gray-50"
                />
                <p className="mt-1.5 text-pretty text-xs text-gray-400">填写调度中心 OpenAPI 根地址，不要包含接口路径。</p>
              </div>

              <div>
                <label htmlFor="native-api-key" className="text-sm font-medium text-gray-700">
                  API Key
                </label>
                <input
                  id="native-api-key"
                  type="password"
                  value={nativeApiKey}
                  onChange={(event) => setNativeApiKey(event.target.value)}
                  placeholder={nativeConfig.api_key_configured ? '已配置；留空保持当前密钥' : '请输入调度中心 API Key'}
                  autoComplete="new-password"
                  disabled={nativeConfigSaving}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-gray-50"
                />
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400">
                  <ShieldCheck className="size-3.5 text-green-600" aria-hidden="true" />
                  {nativeConfig.api_key_configured ? '密钥已配置并加密保存；输入新值才会替换' : '密钥尚未配置'}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-4">
                <input
                  type="checkbox"
                  checked={nativeConfig.enabled}
                  onChange={(event) => setNativeConfig({ ...nativeConfig, enabled: event.target.checked })}
                  disabled={nativeConfigSaving}
                  className="mt-0.5 size-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800">启用 Native 实例账号</span>
                  <span className="mt-1 block text-pretty text-xs text-gray-500">启用后，账号管理页将从统一调度中心读取已授权实例并执行凭据刷新。</span>
                </span>
              </label>

              {nativeError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-pretty text-sm text-red-700">
                  {nativeError}
                </div>
              )}

              {nativeHealth?.ok && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  连接正常，当前已授权 <span className="tabular-nums font-semibold">{nativeHealth.authorized_instances || 0}</span> 个实例。
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => testNativeConnection()}
                  disabled={nativeHealthLoading || nativeConfigSaving || !nativeConfig.configured}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {nativeHealthLoading ? '检测中...' : '测试连接'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveNativeConfig}
                  disabled={nativeConfigSaving}
                  className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {nativeConfigSaving ? '保存中...' : '保存调度配置'}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white p-6 shadow-sm" aria-labelledby="system-settings-heading">
          <div className="mb-5 border-b border-gray-100 pb-4">
            <h2 id="system-settings-heading" className="text-balance text-lg font-semibold text-gray-900">系统参数</h2>
            <p className="mt-1 text-pretty text-sm text-gray-500">扫描、代理和日志相关运行参数。</p>
          </div>
          {loading ? (
            <div className="space-y-4" aria-label="正在加载系统参数">
              <div className="h-10 rounded-lg bg-gray-100" />
              <div className="h-10 rounded-lg bg-gray-100" />
              <div className="h-10 rounded-lg bg-gray-100" />
            </div>
          ) : (
            <div className="space-y-4">
              {configs.map((config, index) => (
                <div key={config.config_key} className="flex items-center gap-4">
                  <div className="w-48 shrink-0">
                    <label className="text-sm font-medium text-gray-700">{config.description}</label>
                    <p className="truncate text-xs text-gray-400">{config.config_key}</p>
                  </div>
                  {config.config_type === 'boolean' ? (
                    <div className="flex flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        aria-label={config.description}
                        checked={String(config.config_value).toLowerCase() === 'true'}
                        onChange={(event) => {
                          const newConfigs = [...configs]
                          newConfigs[index] = { ...newConfigs[index], config_value: event.target.checked ? 'true' : 'false' }
                          setConfigs(newConfigs)
                        }}
                        className="size-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                      />
                      <span className="text-sm text-gray-600">
                        {String(config.config_value).toLowerCase() === 'true' ? '已启用' : '已关闭'}
                      </span>
                      {config.config_key === 'scan_enabled' && (
                        <span className="text-pretty text-xs text-gray-400">关闭后不再启动新的自动扫描，正在执行的任务会正常完成</span>
                      )}
                    </div>
                  ) : (
                    <input
                      type={config.config_type === 'number' ? 'number' : 'text'}
                      aria-label={config.description}
                      value={config.config_value || ''}
                      onChange={(event) => {
                        const newConfigs = [...configs]
                        newConfigs[index] = { ...newConfigs[index], config_value: event.target.value }
                        setConfigs(newConfigs)
                      }}
                      className="flex-1 rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-lg bg-orange-500 px-6 py-2 text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存系统参数'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

export default SettingsPage
