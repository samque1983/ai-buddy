import { describe, it, expect } from 'vitest';
import {
  detectInAppBrowser,
  inAppBrowserLabel,
  isInAppBrowser,
  voiceErrorMessage,
} from '@/lib/env/browser';

// Real-world User-Agent strings. In-app browsers (WeChat, QQ, Weibo, ...) run a
// restricted WebView where getUserMedia / WebRTC are blocked; the standalone
// system browsers and even the standalone QQ Browser support them fine.
const UA = {
  wechat_ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002829) NetType/WIFI Language/zh_CN',
  // WeChat on Android reports MQQBrowser/TBS (X5 core) AND MicroMessenger — the
  // WeChat marker must win so we don't mistake it for the standalone QQ Browser.
  wechat_android:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.0.0 MQQBrowser/6.2 TBS/046319 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.40.2480(0x28002856) NetType/WIFI',
  qq_inapp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQ/8.9.68.11615 V1_IPH_SQ NetType/WIFI',
  weibo:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iPhone9,1__weibo__12.0.0__iphone__os16.6)',
  // Standalone QQ Browser is a full browser — NOT an in-app WebView.
  mqqbrowser:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.0.0 MQQBrowser/13.5 Mobile Safari/537.36',
  safari_ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  chrome_android:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

describe('detectInAppBrowser', () => {
  it('detects WeChat on iOS', () => {
    expect(detectInAppBrowser(UA.wechat_ios)).toBe('wechat');
  });

  it('detects WeChat on Android despite the MQQBrowser/TBS marker', () => {
    expect(detectInAppBrowser(UA.wechat_android)).toBe('wechat');
  });

  it('detects the in-app QQ browser', () => {
    expect(detectInAppBrowser(UA.qq_inapp)).toBe('qq');
  });

  it('detects the Weibo in-app browser', () => {
    expect(detectInAppBrowser(UA.weibo)).toBe('weibo');
  });

  it('does NOT flag the standalone QQ Browser (MQQBrowser)', () => {
    expect(detectInAppBrowser(UA.mqqbrowser)).toBeNull();
  });

  it('does NOT flag system Safari', () => {
    expect(detectInAppBrowser(UA.safari_ios)).toBeNull();
  });

  it('does NOT flag system Chrome', () => {
    expect(detectInAppBrowser(UA.chrome_android)).toBeNull();
  });

  it('returns null for empty / missing UA', () => {
    expect(detectInAppBrowser('')).toBeNull();
    expect(detectInAppBrowser(undefined)).toBeNull();
  });
});

describe('inAppBrowserLabel', () => {
  it('gives a Chinese label for WeChat', () => {
    expect(inAppBrowserLabel(UA.wechat_ios)).toBe('微信');
  });

  it('gives a Chinese label for QQ', () => {
    expect(inAppBrowserLabel(UA.qq_inapp)).toBe('QQ');
  });

  it('returns null when not an in-app browser', () => {
    expect(inAppBrowserLabel(UA.safari_ios)).toBeNull();
  });
});

describe('isInAppBrowser', () => {
  it('is true inside WeChat', () => {
    expect(isInAppBrowser(UA.wechat_ios)).toBe(true);
  });

  it('is false in a real browser', () => {
    expect(isInAppBrowser(UA.chrome_android)).toBe(false);
  });
});

describe('voiceErrorMessage', () => {
  const notAllowed = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const notFound = Object.assign(new Error('no mic'), { name: 'NotFoundError' });

  it('names the in-app browser and tells the user to reopen it', () => {
    const msg = voiceErrorMessage(new Error('sdp_failed_403'), UA.wechat_ios);
    expect(msg).toContain('微信');
    expect(msg).toContain('浏览器中打开');
  });

  it('maps a denied mic to a permission message regardless of browser', () => {
    expect(voiceErrorMessage(notAllowed, UA.safari_ios)).toContain('麦克风权限');
  });

  it('maps a missing mic to a device message', () => {
    expect(voiceErrorMessage(notFound, UA.safari_ios)).toContain('找不到可用的麦克风');
  });

  it('keeps the daily-limit message', () => {
    expect(voiceErrorMessage(new Error('daily_limit'), UA.safari_ios)).toContain('额度');
  });

  it('maps a connect timeout to a network/proxy hint (the stuck-on-连接中 case)', () => {
    const msg = voiceErrorMessage(new Error('connect_timeout'), UA.safari_ios);
    expect(msg).toMatch(/超时/);
    expect(msg).toMatch(/网络|代理/);
  });

  it('maps a mic timeout to a microphone-permission hint', () => {
    const msg = voiceErrorMessage(new Error('mic_timeout'), UA.safari_ios);
    expect(msg).toContain('麦克风');
  });

  it('falls back to a generic message in a real browser', () => {
    expect(voiceErrorMessage(new Error('sdp_failed_500'), UA.safari_ios)).toContain('普通模式');
  });
});
