import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { Bell, BellOff, BellRing, KeyRound, Smartphone, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import {
  disablePartyPushNotification,
  enablePartyPushNotification,
  getEnvVapidKey,
  isBrowserPushAvailable,
  isIosDevice,
  isStandalonePwa,
  listenForegroundPush,
  saveCloudVapidKey,
  subscribeCloudVapidKey,
  subscribePartyPushCount,
  subscribeSelfPushStatus,
} from '../lib/pushNotifications';

interface PushReminderBarProps {
  partyId: string;
  isAdmin: boolean;
  currentUser: User | null;
  authBusy: boolean;
  onSignIn: () => Promise<void>;
}

export function PushReminderBar({
  partyId,
  isAdmin,
  currentUser,
  authBusy,
  onSignIn,
}: PushReminderBarProps) {
  const envVapidKey = getEnvVapidKey();
  const [cloudVapidKey, setCloudVapidKey] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [vapidDraft, setVapidDraft] = useState('');

  const effectiveVapidKey = envVapidKey || cloudVapidKey;
  const iosNeedsHomeScreen = isIosDevice() && !isStandalonePwa();
  const pushSupported = isBrowserPushAvailable();

  useEffect(() => {
    const unsub = subscribeCloudVapidKey((key) => {
      setCloudVapidKey(key);
      if (key) setVapidDraft((prev) => (prev ? prev : key));
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setSubscribed(false);
      return;
    }
    return subscribeSelfPushStatus(partyId, currentUser.uid, setSubscribed);
  }, [partyId, currentUser?.uid]);

  useEffect(() => {
    if (!isAdmin) {
      setSubscriberCount(null);
      return;
    }
    return subscribePartyPushCount(partyId, setSubscriberCount);
  }, [partyId, isAdmin]);

  useEffect(() => {
    let unsub = () => {};
    void listenForegroundPush((title, body) => {
      toast.info(`${title}：${body}`);
    }).then((fn) => {
      unsub = fn;
    });
    return () => unsub();
  }, []);

  async function handleEnable() {
    if (!currentUser) {
      await onSignIn();
      return;
    }
    setBusy(true);
    try {
      await enablePartyPushNotification({
        partyId,
        uid: currentUser.uid,
        email: currentUser.email,
        name: currentUser.displayName,
        vapidKey: effectiveVapidKey,
      });
      setSubscribed(true);
      toast.success('已開啟開局前通知！活動前 24 小時及 2 小時會推送提醒你');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '開啟推送通知失敗';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!currentUser) return;
    setBusy(true);
    try {
      await disablePartyPushNotification(partyId, currentUser.uid);
      setSubscribed(false);
      toast.success('已取消此活動的手機推送通知');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '取消推送通知失敗';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveVapidKey(e: FormEvent) {
    e.preventDefault();
    const trimmed = vapidDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await saveCloudVapidKey(trimmed);
      setShowKeySetup(false);
      toast.success('已儲存 Firebase Web Push 金鑰，所有參加者現在都可以開啟通知');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '儲存金鑰失敗';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  // 非主辦人且尚未設定 VAPID Key 時，隱藏元件以免顯示無法使用的按鈕
  if (!effectiveVapidKey && !isAdmin) {
    return null;
  }

  return (
    <div className="mb-4 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200/80">
      {!effectiveVapidKey ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <KeyRound className="h-4 w-4 text-brand-600" />
              <span>啟用免費手機推送通知（需貼上 Firebase VAPID 公鑰）</span>
            </div>
            <button
              type="button"
              onClick={() => setShowKeySetup((v) => !v)}
              className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
            >
              {showKeySetup ? '收起' : '立即設定'}
            </button>
          </div>
          {showKeySetup ? (
            <form onSubmit={handleSaveVapidKey} className="space-y-2">
              <p className="text-[11px] leading-relaxed text-slate-500">
                前往 Firebase Console → 專案設定 → Cloud Messaging → Web 推播憑證 → 產生金鑰組，複製公鑰貼上即可。
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={vapidDraft}
                  onChange={(e) => setVapidDraft(e.target.value)}
                  placeholder="貼上 Firebase Web Push VAPID Public Key..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="shrink-0 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  儲存
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : iosNeedsHomeScreen ? (
        <div className="flex items-start gap-2.5">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-bold text-slate-800">想收到開局前手機推送通知？</p>
            <p className="mt-0.5 leading-relaxed text-slate-500">
              iPhone 需先在 Safari 按底部「分享」→「加入主畫面」，再從主畫面圖示打開 PartyO 即可開啟前 24 小時及前 2 小時自動提醒。
            </p>
          </div>
        </div>
      ) : !pushSupported ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <BellOff className="h-4 w-4 shrink-0 text-slate-400" />
          <span>目前瀏覽器不支援手機推送通知，建議改用 Chrome 或 Safari 主畫面模式開啟。</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {subscribed ? (
              <BellRing className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Bell className="h-4 w-4 shrink-0 text-brand-600" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">
                {subscribed ? '已開啟開局前手機推送通知' : '開局前手機推送通知'}
              </p>
              <p className="text-[11px] text-slate-500">
                活動開始前 24 小時及 2 小時自動提醒
                {isAdmin && subscriberCount !== null ? ` · 目前 ${subscriberCount} 人已訂閱` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!currentUser ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={onSignIn}
                className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                <LogIn className="h-3.5 w-3.5" />
                登入開啟通知
              </button>
            ) : subscribed ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleDisable}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-60"
              >
                <BellOff className="h-3.5 w-3.5" />
                {busy ? '處理中...' : '關閉通知'}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleEnable}
                className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                <Bell className="h-3.5 w-3.5" />
                {busy ? '開啟中...' : '開啟通知'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
