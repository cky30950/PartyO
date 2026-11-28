import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { toast } from 'sonner';
import type {
  AppTheme,
  ApprovalStatus,
  Guest,
  HostPaymentProfile,
  Party,
  RsvpStatus,
} from './types/party';
import {
  auth,
  isOwnerUser,
  signInWithGoogle,
  signOutUser,
} from './lib/firebase';
import {
  addAdminEmail,
  adminRemoveGuest,
  adminSetRsvpApproval,
  adminUpdateGuestStatus,
  listRecentParties,
  readCachedAppTheme,
  readCachedHostPaymentProfile,
  removeAdminEmail,
  saveAppTheme,
  saveHostPaymentProfile,
  saveParty,
  subscribeAdminEmails,
  subscribeAllParties,
  subscribeAppTheme,
  subscribeHostPaymentProfile,
  subscribeParty,
  subscribeSelfAdminStatus,
  upsertSelfRsvp,
} from './lib/partyStore';
import {
  buildGoogleCalendarUrl,
  buildGoogleMapsUrl,
  buildShortPartyUrl,
} from './lib/calendar';
import { fireConfetti } from './lib/celebrate';
import { applyThemeToDocument, getThemeTokens } from './lib/themes';
import { HomeView } from './components/HomeView';
import { PartyDashboard } from './components/PartyDashboard';

type RedirectTarget = 'cal' | 'map' | null;

function readPartyIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('p') || params.get('party');
}

function readRedirectTargetFromUrl(): RedirectTarget {
  if (typeof window === 'undefined') return null;
  const go = new URLSearchParams(window.location.search).get('go');
  return go === 'cal' || go === 'map' ? go : null;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const [partyId, setPartyId] = useState<string | null>(() => readPartyIdFromUrl());
  const [redirectTarget, setRedirectTarget] = useState<RedirectTarget>(() =>
    readRedirectTargetFromUrl()
  );
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(partyId));
  const [syncError, setSyncError] = useState<string>('');
  const [listSyncError, setListSyncError] = useState<string>('');
  const [recentParties, setRecentParties] = useState<Party[]>(() => listRecentParties());
  const [hostPaymentProfile, setHostPaymentProfile] = useState<HostPaymentProfile | null>(() =>
    readCachedHostPaymentProfile()
  );
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readCachedAppTheme());
  const [isCoAdmin, setIsCoAdmin] = useState(false);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);

  const isOwner = isOwnerUser(user);
  const isAdmin = isOwner || isCoAdmin;
  const activeTheme: AppTheme = partyId && party?.theme ? party.theme : appTheme;

  // 全站同步監聽首頁／預設主題風格
  useEffect(() => {
    const unsub = subscribeAppTheme((nextTheme) => setAppTheme(nextTheme));
    return () => unsub();
  }, []);

  // 進入個別活動時自動切換成該活動主題，返回首頁時切回預設主題
  useEffect(() => {
    applyThemeToDocument(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 監聽目前登入帳號是否已被加入共同管理員名單
  useEffect(() => {
    if (!user?.email || isOwner) {
      setIsCoAdmin(false);
      return;
    }
    return subscribeSelfAdminStatus(user.email, setIsCoAdmin);
  }, [user?.email, isOwner]);

  // 主管理員即時監聽共同管理員郵件清單
  useEffect(() => {
    if (!isOwner) {
      setAdminEmails([]);
      return;
    }
    return subscribeAdminEmails(setAdminEmails, () => {
      setAdminEmails([]);
    });
  }, [isOwner]);

  const refreshList = useCallback(() => {
    setRecentParties(listRecentParties());
  }, []);

  const navigateToParty = useCallback((id: string | null) => {
    setPartyId(id);
    setRedirectTarget(null);
    setSyncError('');
    const url = new URL(window.location.href);
    url.searchParams.delete('party');
    url.searchParams.delete('go');
    if (id) {
      url.searchParams.set('p', id);
    } else {
      url.searchParams.delete('p');
    }
    window.history.pushState({}, '', url.toString());
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPartyId(readPartyIdFromUrl());
      setRedirectTarget(readRedirectTargetFromUrl());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = subscribeHostPaymentProfile(
      (profile) => setHostPaymentProfile(profile),
      () => {
        setHostPaymentProfile(readCachedHostPaymentProfile());
      }
    );
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    if (partyId) return;
    setListSyncError('');
    const unsub = subscribeAllParties(
      (list) => {
        setListSyncError('');
        setRecentParties(list);
      },
      (err) => {
        setListSyncError(err.message || '無法讀取雲端派對列表');
        refreshList();
      }
    );
    return () => unsub();
  }, [partyId, refreshList]);

  useEffect(() => {
    if (!partyId) {
      setParty(null);
      setLoading(false);
      setSyncError('');
      refreshList();
      return;
    }

    setLoading(true);
    setSyncError('');
    const unsub = subscribeParty(
      partyId,
      (data) => {
        setParty(data);
        setLoading(false);
        refreshList();
      },
      (err) => {
        setSyncError(err.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [partyId, refreshList]);

  // 處理站內短跳轉：?p=<id>&go=cal（Google 日曆）或 ?p=<id>&go=map（Google 地圖）
  useEffect(() => {
    if (!party || !redirectTarget) return;
    const destination =
      redirectTarget === 'cal'
        ? buildGoogleCalendarUrl(party, buildShortPartyUrl(party.id))
        : buildGoogleMapsUrl(
            [party.location?.trim(), party.address?.trim()].filter(Boolean).join(' ')
          );
    window.location.replace(destination);
  }, [party, redirectTarget]);

  async function handleSignIn() {
    setAuthBusy(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登入失敗，請稍後再試';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(`Google 登入失敗：${msg}`);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    setAuthError('');
    try {
      await signOutUser();
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleUpdateParty(updated: Party) {
    if (!isAdmin) return;
    const prev = party;
    setParty(updated);
    try {
      await saveParty(updated);
      refreshList();
    } catch (err) {
      setParty(prev);
      throw err;
    }
  }

  async function handleSaveSelfRsvp(guest: Guest) {
    if (!party || !user) return;
    const existing = party.rsvps?.[user.uid];
    const nextApproval: ApprovalStatus =
      existing?.approvalStatus === 'approved'
        ? 'approved'
        : existing?.approvalStatus === 'waitlist'
          ? 'waitlist'
          : 'pending';
    const entry: Guest = {
      ...guest,
      id: user.uid,
      uid: user.uid,
      email: user.email ?? undefined,
      approvalStatus: nextApproval,
      updatedAt: new Date().toISOString(),
    };
    const optimistic: Party = {
      ...party,
      rsvps: {
        ...(party.rsvps ?? {}),
        [user.uid]: entry,
      },
      updatedAt: entry.updatedAt,
    };
    setParty(optimistic);
    await upsertSelfRsvp(party.id, entry);
    refreshList();
  }

  async function handleAdminChangeGuestStatus(guestId: string, nextStatus: RsvpStatus) {
    if (!party || !isAdmin) return;
    try {
      const updated = await adminUpdateGuestStatus(party, guestId, nextStatus);
      setParty(updated);
      refreshList();
    } catch (err) {
      const detail = err instanceof Error ? err.message : '更新失敗';
      toast.error(`更新出席狀態失敗：${detail}`);
    }
  }

  async function handleAdminSetRsvpApproval(guestId: string, approvalStatus: ApprovalStatus) {
    if (!party || !isAdmin) return;
    try {
      const updated = await adminSetRsvpApproval(party, guestId, approvalStatus);
      setParty(updated);
      refreshList();
      const labels: Record<ApprovalStatus, string> = {
        approved: '已批准參加者加入名單',
        waitlist: '已安排至候補名單',
        rejected: '已拒絕該報名申請',
        pending: '已設為待審核',
      };
      toast.success(labels[approvalStatus]);
      if (approvalStatus === 'approved') {
        fireConfetti('approve');
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : '權限不足或網路錯誤';
      toast.error(`審核操作失敗：${detail}（請確認雲端權限設定）`);
    }
  }

  async function handleAdminRemoveGuest(guestId: string) {
    if (!party || !isAdmin) return;
    try {
      const updated = await adminRemoveGuest(party, guestId);
      setParty(updated);
      refreshList();
      toast.success('已從名單移除');
    } catch (err) {
      const detail = err instanceof Error ? err.message : '移除失敗';
      toast.error(`移除參加者失敗：${detail}`);
    }
  }

  async function handleSaveHostPaymentProfile(profile: HostPaymentProfile) {
    if (!isAdmin) return;
    const saved = await saveHostPaymentProfile(profile);
    setHostPaymentProfile(saved);
  }

  async function handleChangeDefaultTheme(nextTheme: AppTheme) {
    if (!isAdmin) return;
    setAppTheme(nextTheme);
    try {
      await saveAppTheme(nextTheme);
      toast.success(`已切換首頁預設主題：${getThemeTokens(nextTheme).name}`);
    } catch {
      toast.error('主題同步失敗，請檢查 Realtime Database 規則');
    }
  }

  async function handleChangePartyTheme(nextTheme: AppTheme) {
    if (!isAdmin || !party) return;
    try {
      await handleUpdateParty({
        ...party,
        theme: nextTheme,
      });
      toast.success(`此活動主題已切換為「${getThemeTokens(nextTheme).name}」`);
    } catch {
      toast.error('活動主題儲存失敗，請稍後再試');
    }
  }

  async function handleAddAdminEmail(email: string) {
    if (!isOwner) return;
    const added = await addAdminEmail(email);
    toast.success(`已新增管理員：${added}`);
  }

  async function handleRemoveAdminEmail(email: string) {
    if (!isOwner) return;
    await removeAdminEmail(email);
    toast.success(`已移除管理員：${email}`);
  }

  if (!partyId) {
    if (!authReady) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
          載入中...
        </div>
      );
    }

    return (
      <HomeView
        recentParties={recentParties}
        isAdmin={isAdmin}
        isOwner={isOwner}
        adminEmails={adminEmails}
        onAddAdminEmail={handleAddAdminEmail}
        onRemoveAdminEmail={handleRemoveAdminEmail}
        currentUser={user}
        hostPaymentProfile={hostPaymentProfile}
        appTheme={appTheme}
        onChangeTheme={handleChangeDefaultTheme}
        authBusy={authBusy}
        authError={authError}
        listSyncError={listSyncError}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onOpenParty={(id) => navigateToParty(id)}
        onRefreshList={refreshList}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        {redirectTarget === 'cal'
          ? '正在開啟 Google 日曆...'
          : redirectTarget === 'map'
            ? '正在開啟 Google 地圖...'
            : '載入派對資料中...'}
      </div>
    );
  }

  if (party && redirectTarget) {
    const destination =
      redirectTarget === 'cal'
        ? buildGoogleCalendarUrl(party, buildShortPartyUrl(party.id))
        : buildGoogleMapsUrl(
            [party.location?.trim(), party.address?.trim()].filter(Boolean).join(' ')
          );
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-sm font-bold text-slate-800">
          {redirectTarget === 'cal' ? '正在跳轉至 Google 日曆...' : '正在跳轉至 Google 地圖...'}
        </p>
        <a
          href={destination}
          className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
        >
          立即開啟
        </a>
        <button
          type="button"
          onClick={() => navigateToParty(party.id)}
          className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
        >
          查看活動詳情
        </button>
      </div>
    );
  }

  if (!party) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-base font-bold text-slate-800">搵唔到呢個派對活動</p>
        <p className="max-w-sm text-xs text-slate-500">
          {syncError
            ? `連線錯誤：${syncError}（請檢查雲端資料庫及權限設定）`
            : '連結可能已失效，或該派對尚未建立，請向主辦人確認連結。'}
        </p>
        <button
          type="button"
          onClick={() => navigateToParty(null)}
          className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
        >
          返回首頁
        </button>
      </div>
    );
  }

  return (
    <PartyDashboard
      party={party}
      isAdmin={isAdmin}
      currentUser={user}
      hostPaymentProfile={hostPaymentProfile}
      appTheme={activeTheme}
      onChangeTheme={handleChangePartyTheme}
      authBusy={authBusy}
      authError={authError}
      onBack={() => navigateToParty(null)}
      onSignIn={handleSignIn}
      onSignOut={handleSignOut}
      onUpdateParty={handleUpdateParty}
      onSaveHostPaymentProfile={handleSaveHostPaymentProfile}
      onSaveSelfRsvp={handleSaveSelfRsvp}
      onAdminChangeGuestStatus={handleAdminChangeGuestStatus}
      onAdminSetRsvpApproval={handleAdminSetRsvpApproval}
      onAdminRemoveGuest={handleAdminRemoveGuest}
    />
  );
}

export default App;
