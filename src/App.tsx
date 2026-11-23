import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Lock, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import type { Guest, Party, RsvpStatus } from './types/party';
import {
  auth,
  isAdminUser,
  signInWithGoogle,
  signOutUser,
} from './lib/firebase';
import {
  adminRemoveGuest,
  adminUpdateGuestStatus,
  listRecentParties,
  saveParty,
  subscribeParty,
  upsertSelfRsvp,
} from './lib/partyStore';
import { HomeView } from './components/HomeView';
import { PartyDashboard } from './components/PartyDashboard';

function readPartyIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('party');
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const [partyId, setPartyId] = useState<string | null>(() => readPartyIdFromUrl());
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(partyId));
  const [syncError, setSyncError] = useState<string>('');
  const [recentParties, setRecentParties] = useState<Party[]>(() => listRecentParties());

  const isAdmin = isAdminUser(user);

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
    setSyncError('');
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('party', id);
    } else {
      url.searchParams.delete('party');
    }
    window.history.pushState({}, '', url.toString());
  }, []);

  useEffect(() => {
    const onPopState = () => setPartyId(readPartyIdFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
    const entry: Guest = {
      ...guest,
      id: user.uid,
      uid: user.uid,
      email: user.email ?? undefined,
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

  async function handleAdminRemoveGuest(guestId: string) {
    if (!party || !isAdmin) return;
    const updated = await adminRemoveGuest(party, guestId);
    setParty(updated);
    refreshList();
  }

  if (!partyId) {
    if (!authReady) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
          確認登入狀態中...
        </div>
      );
    }

    if (!isAdmin) {
      const signedInWrongAccount = Boolean(user && !isAdmin);
      return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-rose-50/70 via-slate-50 to-slate-100 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/80 sm:p-8">
            <img src="./icon.svg" alt="PartyO" className="mx-auto h-12 w-12 rounded-2xl shadow-sm" />
            <h1 className="mt-4 text-lg font-bold tracking-tight text-slate-900">PartyO</h1>
            <p className="mt-1 text-xs text-slate-500">
              此主頁僅供主辦人建立與管理活動。如果你收到派對邀請，請直接打開主辦人分享的專屬活動連結進行報名。
            </p>

            {signedInWrongAccount ? (
              <div className="mt-5 rounded-2xl bg-amber-50 p-3.5 text-left text-xs text-amber-800 ring-1 ring-amber-200">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold">此帳號沒有管理權限</p>
                    <p className="mt-0.5 text-amber-700">
                      目前登入為 {user?.email}，請切換至主辦人帳號。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                <Lock className="h-3.5 w-3.5" /> 僅限主辦人建立活動
              </div>
            )}

            {authError ? (
              <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {authError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                disabled={authBusy}
                onClick={handleSignIn}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                {authBusy
                  ? '登入中...'
                  : signedInWrongAccount
                    ? '切換主辦人 Google 帳號'
                    : '以主辦人 Google 帳號登入'}
              </button>

              {signedInWrongAccount ? (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleSignOut}
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
                >
                  <LogOut className="h-3.5 w-3.5" /> 登出目前帳號
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    return (
      <HomeView
        recentParties={recentParties}
        adminEmail={user?.email ?? ''}
        onSignOut={handleSignOut}
        onOpenParty={(id) => navigateToParty(id)}
        onRefreshList={refreshList}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        載入派對資料中...
      </div>
    );
  }

  if (!party) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-base font-bold text-slate-800">搵唔到呢個派對活動</p>
        <p className="max-w-sm text-xs text-slate-500">
          {syncError
            ? `連線錯誤：${syncError}（請檢查 Firestore 資料庫及安全規則設定）`
            : '連結可能已失效，或該派對尚未建立，請向主辦人確認連結。'}
        </p>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => navigateToParty(null)}
            className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            返回首頁
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <PartyDashboard
      party={party}
      isAdmin={isAdmin}
      currentUser={user}
      authBusy={authBusy}
      authError={authError}
      onBack={isAdmin ? () => navigateToParty(null) : undefined}
      onSignIn={handleSignIn}
      onSignOut={handleSignOut}
      onUpdateParty={handleUpdateParty}
      onSaveSelfRsvp={handleSaveSelfRsvp}
      onAdminChangeGuestStatus={handleAdminChangeGuestStatus}
      onAdminRemoveGuest={handleAdminRemoveGuest}
    />
  );
}

export default App;
