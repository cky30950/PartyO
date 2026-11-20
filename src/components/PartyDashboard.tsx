import { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Share2,
  Check,
  Users,
  Wallet,
  CalendarPlus,
  Cloud,
  Trash2,
} from 'lucide-react';
import type { Party } from '../types/party';
import { buildGoogleMapsUrl, formatPartyDateTime } from '../lib/calendar';
import { deleteParty } from '../lib/partyStore';
import { RsvpTab } from './RsvpTab';
import { CalendarTab } from './CalendarTab';
import { ExpensesTab } from './ExpensesTab';

type TabKey = 'rsvp' | 'calendar' | 'expenses';

interface PartyDashboardProps {
  party: Party;
  onBack: () => void;
  onUpdateParty: (updated: Party) => Promise<void>;
}

export function PartyDashboard({ party, onBack, onUpdateParty }: PartyDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('rsvp');
  const [copiedLink, setCopiedLink] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?party=${encodeURIComponent(party.id)}`
      : '';

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: party.title,
          text: `${party.title} — 報名、加日曆同 AA 拆帳`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" /> 返回首頁
            </button>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <Cloud className="h-3 w-3" /> 雲端同步中
              </span>

              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> 已複製連結
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5" /> 分享派對
                  </>
                )}
              </button>

              <button
                type="button"
                aria-label="刪除整個活動（連同雲端資料）"
                title="永久刪除活動"
                onClick={async () => {
                  const ok = window.confirm(
                    `確定要永久刪除「${party.title}」嗎？\n這會同時刪除 Firebase 雲端資料，所有已分享的連結亦會失效。`
                  );
                  if (!ok) return;
                  try {
                    await deleteParty(party.id);
                    onBack();
                  } catch (err) {
                    const detail = err instanceof Error ? err.message : '刪除失敗';
                    window.alert(`刪除雲端資料失敗：${detail}`);
                  }
                }}
                className="inline-flex items-center justify-center rounded-xl p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">{party.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-brand-500" />
                {formatPartyDateTime(party.startTime, party.endTime)}
              </span>
              {party.location ? (
                <a
                  href={buildGoogleMapsUrl(party.location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 underline decoration-slate-300 underline-offset-2 transition hover:text-brand-600 hover:decoration-brand-400"
                >
                  <MapPin className="h-3.5 w-3.5 text-brand-500" />
                  {party.location}
                </a>
              ) : null}
            </div>
          </div>

          <nav className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('rsvp')}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition ${
                activeTab === 'rsvp'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              活動與報名
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition ${
                activeTab === 'calendar'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              日曆與邀請
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('expenses')}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition ${
                activeTab === 'expenses'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              AA 計費
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-5">
        {activeTab === 'rsvp' && <RsvpTab party={party} onUpdateParty={onUpdateParty} />}
        {activeTab === 'calendar' && <CalendarTab party={party} shareUrl={shareUrl} />}
        {activeTab === 'expenses' && (
          <ExpensesTab party={party} onUpdateParty={onUpdateParty} />
        )}
      </main>
    </div>
  );
}
