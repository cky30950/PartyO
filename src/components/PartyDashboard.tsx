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
  HardDrive,
} from 'lucide-react';
import type { Party } from '../types/party';
import { formatPartyDateTime } from '../lib/calendar';
import { isFirebaseConfigured } from '../lib/firebase';
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
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  isFirebaseConfigured
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {isFirebaseConfigured ? (
                  <>
                    <Cloud className="h-3 w-3" /> 雲端同步中
                  </>
                ) : (
                  <>
                    <HardDrive className="h-3 w-3" /> 本機試用
                  </>
                )}
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
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-brand-500" />
                  {party.location}
                </span>
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
