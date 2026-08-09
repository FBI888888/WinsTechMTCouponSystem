export const MEITUAN_PLATFORMS = [
  { value: 'android', label: '安卓' },
  { value: 'windows', label: 'Windows' },
  { value: 'ios', label: '苹果（iOS）' },
  { value: 'harmony', label: '鸿蒙（Harmony）' }
]

const VALID_PLATFORM_KEYS = new Set(MEITUAN_PLATFORMS.map((item) => item.value))

function readParam(params, names) {
  for (const name of names) {
    const value = params.get(name)
    if (value && value.trim()) return value.trim()
  }
  return ''
}

export function parseMeituanTokenLink(input, platform) {
  const normalizedPlatform = String(platform || '').trim().toLowerCase()
  if (!VALID_PLATFORM_KEYS.has(normalizedPlatform)) {
    throw new Error('临时 Token 必须选择平台')
  }

  let url
  try {
    url = new URL(String(input || '').trim())
  } catch (_) {
    throw new Error('请输入完整有效的美团 Token 链接')
  }

  const hashQuery = url.hash.includes('?')
    ? new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1))
    : new URLSearchParams()
  const userId = readParam(url.searchParams, ['userId', 'userid', 'user_id'])
    || readParam(hashQuery, ['userId', 'userid', 'user_id'])
  const token = readParam(url.searchParams, ['token'])
    || readParam(hashQuery, ['token'])

  if (!userId) throw new Error('链接中未找到 userId')
  if (!token) throw new Error('链接中未找到 token')

  return {
    kind: 'temporary',
    userid: userId,
    token,
    platform: normalizedPlatform
  }
}

export function accountToCredential(account) {
  if (!account?.id || !account?.userid || !account?.token) {
    throw new Error('请选择有效的已保存账号')
  }
  const platform = String(account.platform || '').trim().toLowerCase()
  if (!VALID_PLATFORM_KEYS.has(platform)) {
    throw new Error('该账号未配置有效平台')
  }
  return {
    kind: 'saved',
    accountId: account.id,
    userid: String(account.userid),
    token: String(account.token),
    platform,
    openId: account.open_id || account.openId || '',
    openIdCipher: account.open_id_cipher || account.openIdCipher || '',
    unionId: account.union_id || account.unionId || '',
    unionIdCipher: account.union_id_cipher || account.unionIdCipher || '',
    uuid: account.login_uuid || account.loginUuid || account.csecuuid || account.uuid || '',
    credentialSource: account.credential_source || account.credentialSource || 'legacy',
    longitude: account.longitude,
    latitude: account.latitude
  }
}

export function accountToElectronPayload(account = {}) {
  return {
    userid: account.userid || account.userId || '',
    token: account.token || '',
    csecuuid: account.login_uuid || account.loginUuid || account.csecuuid || account.uuid || '',
    openId: account.open_id || account.openId || '',
    openIdCipher: account.open_id_cipher || account.openIdCipher || '',
    unionId: account.union_id || account.unionId || '',
    unionIdCipher: account.union_id_cipher || account.unionIdCipher || '',
    credentialSource: account.credential_source || account.credentialSource || 'legacy',
    platform: account.platform || 'android',
    longitude: account.longitude,
    latitude: account.latitude,
    finger: account.wechat_fingerprint || account.finger || ''
  }
}
