import { useState, type FormEvent } from 'react';
import {
  CalendarPlus,
  Sparkles,
  Users,
  Wallet,
  ArrowRight,
  Trash2,
  Cloud,
  HardDrive,
} from 'lucide-react';
import type { Party } from '../types/party';
import { createDemoParty, deleteLocalParty, generateId, saveParty } from '../lib/partyStore';
import { formatPartyDateTime } from '../lib/calendar';
import { isFirebaseConfigured } from '../lib/firebase';

interface HomeViewProps {
  recentParties: Party[];
  onOpenParty: (partyId: string) => void;
  onRefreshList: () => void;
}

function getDefaultDateTimes(): { start: string; end: string } {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return {
    start: `${yyyy}-${mm}-${dd}T19:00`,
    end: `${yyyy}-${mm}-${dd}T23:00`,
  };
}

export function HomeView({ recentParties, onOpenParty, onRefreshList }: HomeViewProps) {
  const defaults = getDefaultDateTimes();
  const [title, setTitle] = useState('');
  const [hostName, setHostName] = useState('');
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !hostName.trim()) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const hostId = generateId('g');
      const party: Party = {
        id: generateId('party'),
        title: title.trim(),
        description: description.trim(),
        startTime,
        endTime,
        location: location.trim(),
        hostName: hostName.trim(),
        currency: 'HK$',
        guests: [
          {
            id: hostId,
            name: `${hostName.trim()}（搞手）`,
            status: 'going',
            note: '',
            updatedAt: now,
          },
        ],
        expenses: [],
        settlementPayments: {},
        createdAt: now,
        updatedAt: now,
      };
      await saveParty(party);
      onRefreshList();
      onOpenParty(party.id);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLoadDemo() {
    setSubmitting(true);
    try {
      const demo = createDemoParty();
      await saveParty(demo);
      onRefreshList();
      onOpenParty(demo.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50/70 via-slate-50 to-slate-100 pb-16">
      <header className="mx-auto max-w-2xl px-4 pt-8 pb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="./icon.svg" alt="PartyO" className="h-10 w-10 rounded-xl shadow-sm" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">PartyO</h1>
              <p className="text-xs text-slate-500">開局 · 日曆邀請 · AA 計費一條龍</p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              isFirebaseConfigured
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isFirebaseConfigured ? (
              <>
                <Cloud className="h-3.5 w-3.5" /> 雲端即時同步
              </>
            ) : (
              <>
                <HardDrive className="h-3.5 w-3.5" /> 本機試用模式
              </>
            )}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2.5">
          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
            <Users className="h-5 w-5 text-brand-600" />
            <p className="mt-1.5 text-xs font-semibold text-slate-800">免裝 App 報名</p>
            <p className="mt-0.5 text-[11px] text-slate-500">開連結即時 RSVP</p>
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
            <CalendarPlus className="h-5 w-5 text-brand-600" />
            <p className="mt-1.5 text-xs font-semibold text-slate-800">一鍵加日曆</p>
            <p className="mt-0.5 text-[11px] text-slate-500">.ics &amp; Google 連結</p>
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
            <Wallet className="h-5 w-5 text-brand-600" />
            <p className="mt-1.5 text-xs font-semibold text-slate-800">聰明 AA 拆帳</p>
            <p className="mt-0.5 text-[11px] text-slate-500">最少轉帳 &amp; PayMe 追蹤</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4">
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">建立新派對</h2>
            <button
              type="button"
              onClick={handleLoadDemo}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-rose-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              載入示範派對試玩
            </button>
          </div>

          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  活動名稱 <span className="text-brand-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：聖誕 Party Room 狂歡夜"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  搞手名稱 <span className="text-brand-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="你的稱呼"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">地點</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="例如：觀塘 / 銅鑼灣 Party Room"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">開始時間</label>
                <input
                  type="datetime-local"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">結束時間</label>
                <input
                  type="datetime-local"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">活動備註</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例如：Dress code、飲品安排、帶備物品..."
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
            >
              建立派對並生成專屬連結
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </section>

        {recentParties.length > 0 && (
          <section className="space-y-3">
            <h3 className="px-1 text-sm font-bold text-slate-700">最近的派對</h3>
            <div className="space-y-2.5">
              {recentParties.map((p) => {
                const goingCount = p.guests.filter((g) => g.status === 'going').length;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 transition hover:ring-brand-200"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenParty(p.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-bold text-slate-900">{p.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {formatPartyDateTime(p.startTime, p.endTime)}
                        {p.location ? ` · ${p.location}` : ''}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-brand-600">
                        {goingCount} 人出席 · {p.expenses.length} 筆開支
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label="刪除本機紀錄"
                      onClick={() => {
                        deleteLocalParty(p.id);
                        onRefreshList();
                      }}
                      className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
