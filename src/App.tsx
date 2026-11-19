import { useCallback, useEffect, useState } from 'react';
import type { Party } from './types/party';
import { listRecentParties, saveParty, subscribeParty } from './lib/partyStore';
import { HomeView } from './components/HomeView';
import { PartyDashboard } from './components/PartyDashboard';

function readPartyIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('party');
}

export function App() {
  const [partyId, setPartyId] = useState<string | null>(() => readPartyIdFromUrl());
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(partyId));
  const [syncError, setSyncError] = useState<string>('');
  const [recentParties, setRecentParties] = useState<Party[]>(() => listRecentParties());

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

  async function handleUpdateParty(updated: Party) {
    setParty(updated);
    await saveParty(updated);
    refreshList();
  }

  if (!partyId) {
    return (
      <HomeView
        recentParties={recentParties}
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
            : '連結可能已失效，或該派對尚未建立。'}
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
      onBack={() => navigateToParty(null)}
      onUpdateParty={handleUpdateParty}
    />
  );
}

export default App;
