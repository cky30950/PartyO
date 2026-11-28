import { get, onValue, ref, remove, set } from 'firebase/database';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app, rtdb } from './firebase';

export interface PushTokenRecord {
  token: string;
  uid: string;
  email?: string;
  name?: string;
  platform: 'ios-pwa' | 'android' | 'desktop';
  updatedAt: string;
}

export function getEnvVapidKey(): string {
  return (import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || isTouchMac;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const mqStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  return navStandalone || mqStandalone;
}

export function detectPushPlatform(): 'ios-pwa' | 'android' | 'desktop' {
  if (isIosDevice()) return 'ios-pwa';
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')) {
    return 'android';
  }
  return 'desktop';
}

export function isBrowserPushAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * 讀取並即時監聽儲存在雲端的 Firebase Web Push VAPID Public Key
 */
export function subscribeCloudVapidKey(onData: (key: string) => void): () => void {
  const keyRef = ref(rtdb, 'appSettings/fcmVapidKey');
  return onValue(
    keyRef,
    (snap) => {
      const val = snap.exists() ? String(snap.val() ?? '').trim() : '';
      onData(val);
    },
    () => {
      onData('');
    }
  );
}

export async function saveCloudVapidKey(vapidKey: string): Promise<void> {
  await set(ref(rtdb, 'appSettings/fcmVapidKey'), vapidKey.trim());
}

/**
 * 檢查目前使用者是否已訂閱該活動的推送通知
 */
export function subscribeSelfPushStatus(
  partyId: string,
  uid: string,
  onData: (subscribed: boolean) => void
): () => void {
  const tokenRef = ref(rtdb, `partyPushTokens/${partyId}/${uid}`);
  return onValue(
    tokenRef,
    (snap) => {
      onData(snap.exists() && Boolean(snap.val()?.token));
    },
    () => {
      onData(false);
    }
  );
}

/**
 * 僅主辦人使用：即時監聽該活動已開啟通知的人數
 */
export function subscribePartyPushCount(
  partyId: string,
  onData: (count: number) => void
): () => void {
  const tokensRef = ref(rtdb, `partyPushTokens/${partyId}`);
  return onValue(
    tokensRef,
    (snap) => {
      if (!snap.exists()) {
        onData(0);
        return;
      }
      const val = snap.val() as Record<string, PushTokenRecord>;
      const count = Object.values(val).filter((item) => Boolean(item?.token)).length;
      onData(count);
    },
    () => {
      onData(0);
    }
  );
}

/**
 * 註冊專用的相對路徑 Service Worker（相容 GitHub Pages 子路徑）並取得 FCM Token
 */
export async function enablePartyPushNotification(params: {
  partyId: string;
  uid: string;
  email?: string | null;
  name?: string | null;
  vapidKey: string;
}): Promise<string> {
  const { partyId, uid, email, name, vapidKey } = params;
  if (!vapidKey.trim()) {
    throw new Error('尚未設定手機推送通知金鑰（VAPID Key）');
  }
  if (!isBrowserPushAvailable()) {
    throw new Error('此瀏覽器不支援網頁推送通知');
  }
  const supported = await isSupported();
  if (!supported) {
    throw new Error('此裝置或瀏覽器模式暫不支援手機推送通知');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('你已封鎖或拒絕通知權限，請到瀏覽器設定重新允許通知');
  }

  const swRegistration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', {
    scope: './firebase-cloud-messaging-push-scope',
  });
  await navigator.serviceWorker.ready;

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: vapidKey.trim(),
    serviceWorkerRegistration: swRegistration,
  });

  if (!token) {
    throw new Error('無法取得推送裝置權杖，請確認 VAPID 金鑰是否正確');
  }

  const record: PushTokenRecord = {
    token,
    uid,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    platform: detectPushPlatform(),
    updatedAt: new Date().toISOString(),
  };

  await set(ref(rtdb, `partyPushTokens/${partyId}/${uid}`), record);
  return token;
}

export async function disablePartyPushNotification(partyId: string, uid: string): Promise<void> {
  await remove(ref(rtdb, `partyPushTokens/${partyId}/${uid}`));
}

export async function fetchSelfPushRecord(partyId: string, uid: string): Promise<PushTokenRecord | null> {
  const snap = await get(ref(rtdb, `partyPushTokens/${partyId}/${uid}`));
  return snap.exists() ? (snap.val() as PushTokenRecord) : null;
}

/**
 * 監聽前景推送訊息（當用戶正打開網頁時改以 Toast 提示）
 */
export async function listenForegroundPush(
  onReceive: (title: string, body: string) => void
): Promise<() => void> {
  try {
    const supported = await isSupported();
    if (!supported) return () => {};
    const messaging = getMessaging(app);
    return onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || 'PartyO 活動提醒';
      const body = payload.notification?.body || payload.data?.body || '活動快要開始了！';
      onReceive(title, body);
    });
  } catch {
    return () => {};
  }
}
