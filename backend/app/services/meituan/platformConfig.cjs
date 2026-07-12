/**
 * 美团 H5 API 平台设备配置（与 mt-qrcode-web / electronMtQrcodeTools 对齐）
 */
const DEFAULT_PLATFORM = 'android';

// 默认设备指纹 Cookies（mtgsig 签名需要显式传入 WEBDFPID）
const DEFAULT_COOKIES = {
  WEBDFPID:
    '1775212788029AOQGIYUfd79fef3d01d5e9aadc18ccd4d0c95073404-1775212788029-1775212788029AOQGIYUfd79fef3d01d5e9aadc18ccd4d0c95073404',
  _lxsdk_cuid: '19d52ded850c8-0821efd159ce54-683f067d-384000-19d52ded850c8',
  _lxsdk_s: '19d52ded850-d5-792-6cf%7C%7CNaN',
  _lxsdk: '19b373b4485c8-6002391ccec5e4-0-0-19b373b4485c8',
};

const PLATFORM_CONFIG = {
  android: {
    platform: 'ANDROID',
    uniPlatform: 'android',
    systemPlatform: 'android',
    userAgent:
      'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.036) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/132.0.0.0 Mobile Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/android AndroidWechat(0x63090a13) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    label: '安卓',
  },
  windows: {
    platform: 'WINDOWS',
    uniPlatform: 'windows',
    systemPlatform: 'windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    label: 'Windows',
  },
  ios: {
    platform: 'IOS',
    uniPlatform: 'ios',
    systemPlatform: 'ios',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/ios iOSWechat(0x63090a13) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    label: '苹果(iOS)',
  },
  harmony: {
    platform: 'HARMONYOS',
    uniPlatform: 'harmony',
    systemPlatform: 'harmony',
    userAgent:
      'Mozilla/5.0 (HarmonyOS NEXT; HUAWEI Mate 60 Pro; Build/HUAWEIMate60Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/harmony HarmonyWechat(0x63090a13) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    label: '鸿蒙(Harmony)',
  },
};

function getPlatformConfig(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  return PLATFORM_CONFIG[key] || PLATFORM_CONFIG[DEFAULT_PLATFORM];
}

function serializeCookies(cookies) {
  if (!cookies) return '';
  if (typeof cookies === 'string') return cookies;
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

module.exports = {
  DEFAULT_PLATFORM,
  DEFAULT_COOKIES,
  PLATFORM_CONFIG,
  getPlatformConfig,
  serializeCookies,
};
