import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
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
  isAdminUser,
  signInWithGoogle,
  signOutUser,
} from './lib/firebase';
import {
  adminRemoveGuest,
  adminSetRsvpApproval,
  adminUpdateGuestStatus,
  listRecentParties,
  readCachedAppTheme,
  readCachedHostPaymentProfile,
  saveAppTheme,
  saveHostPaymentProfile,
  saveParty,
  subscribeAllParties,
  subscribeAppTheme,
  subscribeHostPaymentProfile,
  subscribeParty,
  upsertSelfRsvp,
} from './lib/partyStore';
import {
  buildGoogleCalendarUrl,
  buildGoogleMapsUrl,
  buildShortPartyUrl,
} from './lib/calendar';
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
  const [recentParties, setRecentParties] = useState<Party[]>(() => listRecentParties());
  const [hostPaymentProfile, setHostPaymentProfile] = useState<HostPaymentProfile | null>(() =>
    readCachedHostPaymentProfile()
  );
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readCachedAppTheme());

  const isAdmin = isAdminUser(user);

  // 全站同步監聽主辦人選擇的主題風格
  useEffect(() => {
    const unsub = subscribeAppTheme((nextTheme) => setAppTheme(nextTheme));
    return () => unsub();
  }, []);

  // 套用 data-theme 與瀏覽器狀態列主題色
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const colors: Record<AppTheme, string> = {
        tavern: '#5C3822',
        cozy: '#3B7453',
        jrpg: '#0D1847',
      };
      meta.setAttribute('content', colors[appTheme]);
    }
  }, [appTheme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

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
    if (partyId || !isAdmin) return;
    const unsub = subscribeAllParties(
      (list) => setRecentParties(list),
      () => {
        refreshList();
      }
    );
    return () => unsub();
  }, [partyId, isAdmin, refreshList]);

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
    const updated = await adminUpdateGuestStatus(party, guestId, nextStatus);
    setParty(updated);
    refreshList();
  }

  async function handleAdminSetRsvpApproval(guestId: string, approvalStatus: ApprovalStatus) {
    if (!party || !isAdmin) return;
    const updated = await adminSetRsvpApproval(party, guestId, approvalStatus);
    setParty(updated);
    refreshList();
  }

  async function handleAdminRemoveGuest(guestId: string) {
    if (!party || !isAdmin) return;
    const updated = await adminRemoveGuest(party, guestId);
    setParty(updated);
    refreshList();
  }

  async function handleSaveHostPaymentProfile(profile: HostPaymentProfile) {
    if (!isAdmin) return;
    const saved = await saveHostPaymentProfile(profile);
    setHostPaymentProfile(saved);
  }

  async function handleChangeTheme(nextTheme: AppTheme) {
    if (!isAdmin) return;
    setAppTheme(nextTheme);
    await saveAppTheme(nextTheme);
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
        currentUser={user}
        hostPaymentProfile={hostPaymentProfile}
        appTheme={appTheme}
        onChangeTheme={handleChangeTheme}
        authBusy={authBusy}
        authError={authError}
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
            ? `連線錯誤：${syncError}（請檢查 Firebase Realtime Database 及安全規則設定）`
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
      appTheme={appTheme}
      onChangeTheme={handleChangeTheme}
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
