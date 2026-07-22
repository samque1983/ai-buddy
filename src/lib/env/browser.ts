/**
 * Detects embedded "in-app" browsers (WeChat, QQ, Weibo, ...). These run a
 * locked-down WebView where getUserMedia and WebRTC are blocked or unreliable,
 * so both 流畅模式 (WebRTC) and 普通模式 (mic recording) fail there. The user
 * has to reopen the link in the system browser (Safari / Chrome).
 *
 * Detection is User-Agent based on purpose: these WebViews don't expose a clean
 * capability flag, and the failure (no mic / no WebRTC) is exactly what we want
 * to warn about *before* the user taps and hits a dead-end error.
 */

export type InAppBrowser = 'wechat' | 'qq' | 'weibo' | 'dingtalk' | 'feishu' | 'douyin' | 'alipay';

interface Matcher {
  name: InAppBrowser;
  label: string;
  test: RegExp;
}

// Order matters: WeChat on Android also reports MQQBrowser/TBS (its X5 core), so
// the WeChat marker must be checked before anything QQ-ish. The standalone QQ
// Browser reports `MQQBrowser` and is a full browser — we deliberately match the
// in-app QQ WebView via ` QQ/<version>` (leading space) instead.
const MATCHERS: Matcher[] = [
  { name: 'wechat', label: '微信', test: /MicroMessenger/i },
  { name: 'dingtalk', label: '钉钉', test: /DingTalk/i },
  { name: 'feishu', label: '飞书', test: /Feishu|Lark/i },
  { name: 'alipay', label: '支付宝', test: /AlipayClient/i },
  { name: 'douyin', label: '抖音', test: /aweme|BytedanceWebview|ToutiaoMicroApp/i },
  { name: 'weibo', label: '微博', test: /Weibo/i },
  { name: 'qq', label: 'QQ', test: /\sQQ\/\d/i },
];

function resolveUA(userAgent?: string): string {
  if (typeof userAgent === 'string') return userAgent;
  if (typeof navigator !== 'undefined') return navigator.userAgent;
  return '';
}

/** Returns the in-app browser kind, or null for real/system browsers. */
export function detectInAppBrowser(userAgent?: string): InAppBrowser | null {
  const ua = resolveUA(userAgent);
  if (!ua) return null;
  for (const m of MATCHERS) {
    if (m.test.test(ua)) return m.name;
  }
  return null;
}

/** Human-facing name of the in-app browser (e.g. "微信"), or null. */
export function inAppBrowserLabel(userAgent?: string): string | null {
  const name = detectInAppBrowser(userAgent);
  if (!name) return null;
  return MATCHERS.find((m) => m.name === name)?.label ?? null;
}

/** True when running inside a known in-app WebView. */
export function isInAppBrowser(userAgent?: string): boolean {
  return detectInAppBrowser(userAgent) !== null;
}

/**
 * True when the current runtime can actually do voice: it needs both a mic
 * (getUserMedia) and WebRTC (RTCPeerConnection). Callable only in the browser;
 * returns false when either capability is missing (e.g. an in-app WebView, or
 * a page served over plain HTTP where getUserMedia is withheld).
 */
export function hasVoiceSupport(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const hasMic = !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
  const hasWebRTC = typeof window.RTCPeerConnection === 'function';
  return hasMic && hasWebRTC;
}

/**
 * Turns a voice-start failure into an actionable Chinese message, instead of one
 * generic "连接失败" that leaves the user stuck. The failing device is usually an
 * in-app browser (reopen elsewhere) or a denied mic (grant permission) — the two
 * cases need opposite actions, so they must read differently.
 */
export function voiceErrorMessage(err: unknown, userAgent?: string): string {
  if (err instanceof Error) {
    if (err.message === 'daily_limit') return '今天的对话额度用完了,明天再来吧';
    // The browser hung trying to reach OpenAI directly — almost always the
    // device can't reach api.openai.com (no proxy / blocked network).
    if (err.message === 'connect_timeout')
      return '连接语音服务器超时,请检查网络后重试(这台设备需要能访问 OpenAI,必要时开代理)';
    if (err.message === 'mic_timeout')
      return '麦克风一直没有响应,请检查浏览器的麦克风权限后重试';
    // getUserMedia rejection names (DOMException).
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'PermissionDeniedError')
      return '需要麦克风权限才能语音,请在浏览器设置里允许后重试';
    if (err.name === 'NotFoundError' || err.name === 'NotReadableError')
      return '找不到可用的麦克风,请检查设备麦克风';
  }
  const label = inAppBrowserLabel(userAgent);
  if (label) return `${label}内置浏览器不支持语音,请点右上角 ⋯ 在浏览器中打开`;
  return '流畅模式连接失败,可以改用普通模式';
}
