import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Calendar,
  Camera,
  MapPin,
  Share2,
  Check,
  Users,
  Wallet,
  CalendarPlus,
  Cloud,
  Trash2,
  LogIn,
  LogOut,
  Megaphone,
  Archive,
  RotateCcw,
  Edit3,
  X,
  Music,
} from 'lucide-react';
import type {
  AppTheme,
  ApprovalStatus,
  Guest,
  HostPaymentProfile,
  Party,
  RsvpStatus,
} from '../types/party';
import {
  buildGoogleMapsUrl,
  buildShortPartyUrl,
  formatPartyDateTime,
  isPartyEnded,
} from '../lib/calendar';
import { deleteParty, getPendingRsvps } from '../lib/partyStore';
import { THEME_LIST } from '../lib/themes';
import { RsvpTab } from './RsvpTab';
import { CalendarTab } from './CalendarTab';
import { ExpensesTab } from './ExpensesTab';
import { AlbumTab } from './AlbumTab';
import { PlaylistTab } from './PlaylistTab';
import { ThemeSwitcher } from './ThemeSwitcher';
import { PushReminderBar } from './PushReminderBar';
import { WeatherBanner } from './WeatherBanner';
import { shareTextOrUrl } from '../lib/webShare';
import { subscribeMediaApiBase } from '../lib/mediaApi';

type TabKey = 'rsvp' | 'calendar' | 'expenses' | 'album' | 'playlist';

interface PartyDashboardProps {
  party: Party;
  isAdmin: boolean;
  currentUser: User | null;
  hostPaymentProfile: HostPaymentProfile | null;
  appTheme: AppTheme;
  onChangeTheme: (theme: AppTheme) => void;
  authBusy: boolean;
  authError: string;
  onBack?: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onUpdateParty: (updated: Party) => Promise<void>;
  onSaveHostPaymentProfile: (profile: HostPaymentProfile) => Promise<void>;
  onSaveSelfRsvp: (guest: Guest) => Promise<void>;
  onAdminChangeGuestStatus: (guestId: string, nextStatus: RsvpStatus) => Promise<void>;
  onAdminSetRsvpApproval: (guestId: string, approvalStatus: ApprovalStatus) => Promise<void>;
  onAdminRemoveGuest: (guestId: string) => Promise<void>;
}

function formatAnnouncementTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function PartyDashboard({
  party,
  isAdmin,
  currentUser,
  hostPaymentProfile,
  appTheme,
  onChangeTheme,
  authBusy,
  authError,
  onBack,
  onSignIn,
  onSignOut,
  onUpdateParty,
  onSaveHostPaymentProfile,
  onSaveSelfRsvp,
  onAdminChangeGuestStatus,
  onAdminSetRsvpApproval,
  onAdminRemoveGuest,
}: PartyDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('yt')) {
      return 'playlist';
    }
    return 'rsvp';
  });
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState(party.announcement ?? '');
  const [mediaApiBase, setMediaApiBase] = useState('');

  useEffect(() => {
    return subscribeMediaApiBase(setMediaApiBase);
  }, []);

  const pendingCount = getPendingRsvps(party).length;
  const ended = isPartyEnded(party);
  const hasAnnouncement = Boolean(party.announcement?.trim());

  const shareUrl = buildShortPartyUrl(party.id);

  async function handleShare() {
    const outcome = await shareTextOrUrl({
      title: party.title,
      text: `${party.title} — 報名、加日曆與費用分攤`,
      url: shareUrl,
    });
    if (outcome === 'shared' || outcome === 'cancelled') return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      toast.success('已複製派對短連結');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('複製連結失敗');
    }
  }

  async function handleToggleEnded() {
    if (!isAdmin) return;
    if (!ended) {
      const ok = window.confirm('確定要手動將此活動標記為「已結束」嗎？\n它會移至首頁的已結束區域，之後仍可隨時重新開啟。');
      if (!ok) return;
      await onUpdateParty({ ...party, manuallyEnded: true });
      toast.success('已標記活動為結束');
    } else {
      await onUpdateParty({ ...party, manuallyEnded: false });
      toast.success('已重新開啟活動');
    }
  }

  async function handleSaveAnnouncement(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const text = announcementDraft.trim();
    await onUpdateParty({
      ...party,
      announcement: text,
      announcementUpdatedAt: text ? new Date().toISOString() : '',
    });
    setEditingAnnouncement(false);
    toast.success(text ? '置頂公告已即時發佈' : '已清除置頂公告');
  }

  async function handleClearAnnouncement() {
    if (!isAdmin) return;
    await onUpdateParty({
      ...party,
      announcement: '',
      announcementUpdatedAt: '',
    });
    setAnnouncementDraft('');
    setEditingAnnouncement(false);
    toast.success('已清除置頂公告');
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="sticky top-0 z-20 border-b-[3px] border-[#4A2E1B] bg-[#FFF9EB] shadow-[0_4px_0_rgba(59,35,20,0.18)]">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                <ArrowLeft className="h-4 w-4" /> 返回首頁
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <img src="./icon.svg" alt="PartyO" className="h-6 w-6 rounded-lg" />
                <span className="text-xs font-bold tracking-tight text-slate-700">PartyO</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <Cloud className="h-3 w-3" /> 線上即時同步中
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

              {isAdmin ? (
                <>

                  <button
                    type="button"
                    title={ended ? '重新開啟活動' : '手動標記活動已結束'}
                    onClick={handleToggleEnded}
                    className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                      ended
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {ended ? (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">重新開啟</span>
                      </>
                    ) : (
                      <>
                        <Archive className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">結束活動</span>
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
                        onBack?.();
                      } catch (err) {
                        const detail = err instanceof Error ? err.message : '刪除失敗';
                        toast.error(`刪除雲端資料失敗：${detail}`);
                      }
                    }}
                    className="inline-flex items-center justify-center rounded-xl p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-slate-900">{party.title}</h1>
              {ended ? (
                <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                  已結束
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-brand-500" />
                {formatPartyDateTime(party.startTime, party.endTime)}
              </span>
              {party.location || party.address ? (
                <a
                  href={buildGoogleMapsUrl(
                    [party.location?.trim(), party.address?.trim()].filter(Boolean).join(' ')
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 underline decoration-slate-300 underline-offset-2 transition hover:text-brand-600 hover:decoration-brand-400"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                  <span>
                    {party.location}
                    {party.address && party.address !== party.location ? ` · ${party.address}` : ''}
                  </span>
                </a>
              ) : null}
            </div>
          </div>

          <nav className="mt-3 grid grid-cols-5 gap-1 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('rsvp')}
              className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:text-xs ${
                activeTab === 'rsvp'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">報名</span>
              {isAdmin && pendingCount > 0 ? (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {pendingCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:text-xs ${
                activeTab === 'calendar'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarPlus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">日曆</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('expenses')}
              className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:text-xs ${
                activeTab === 'expenses'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">分攤</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('album')}
              className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:text-xs ${
                activeTab === 'album'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Camera className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">相簿</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('playlist')}
              className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:text-xs ${
                activeTab === 'playlist'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Music className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">點歌</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4">
        {isAdmin ? (
          <div className="mb-4">
            <ThemeSwitcher
              theme={appTheme}
              label={`此活動專屬主題（${THEME_LIST.length} 款可選）`}
              onChangeTheme={onChangeTheme}
            />
          </div>
        ) : null}

        {!ended && activeTab === 'rsvp' ? (
          <PushReminderBar
            partyId={party.id}
            isAdmin={isAdmin}
            currentUser={currentUser}
            authBusy={authBusy}
            onSignIn={onSignIn}
          />
        ) : null}

        {activeTab === 'rsvp' ? (
          <WeatherBanner startTime={party.startTime} ended={ended} />
        ) : null}

        {/* 置頂即時公告（跨所有分頁顯示） */}
        {hasAnnouncement || isAdmin ? (
          <div className="mb-4">
            {editingAnnouncement && isAdmin ? (
              <form
                onSubmit={handleSaveAnnouncement}
                className="rounded-2xl bg-amber-50/90 p-4 shadow-sm ring-1 ring-amber-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <Megaphone className="h-3.5 w-3.5 text-amber-600" />
                    編輯置頂即時公告
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingAnnouncement(false)}
                    className="rounded-lg p-1 text-amber-700 hover:bg-amber-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={announcementDraft}
                  onChange={(e) => setAnnouncementDraft(e.target.value)}
                  placeholder="例如：大廈密碼 1234#、已改在 8 樓 B 室集合、落雨照常舉行..."
                  className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-amber-400"
                />
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  {hasAnnouncement ? (
                    <button
                      type="button"
                      onClick={handleClearAnnouncement}
                      className="text-xs font-medium text-rose-600 hover:underline"
                    >
                      清除公告
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingAnnouncement(false)}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                      即時發佈
                    </button>
                  </div>
                </div>
              </form>
            ) : hasAnnouncement ? (
              <div className="flex items-start justify-between gap-3 rounded-2xl bg-amber-50/90 px-4 py-3 shadow-sm ring-1 ring-amber-200/90">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-amber-900">主辦人置頂公告</span>
                      {party.announcementUpdatedAt ? (
                        <span className="text-[10px] text-amber-700/80">
                          更新於 {formatAnnouncementTime(party.announcementUpdatedAt)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-amber-950">
                      {party.announcement}
                    </p>
                  </div>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAnnouncementDraft(party.announcement ?? '');
                      setEditingAnnouncement(true);
                    }}
                    className="shrink-0 rounded-lg p-1.5 text-amber-700 hover:bg-amber-100"
                    title="編輯公告"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAnnouncementDraft('');
                  setEditingAnnouncement(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 px-4 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
              >
                <Megaphone className="h-3.5 w-3.5 text-amber-600" />
                發佈置頂即時公告（房號、大廈密碼、集合點等）
              </button>
            )}
          </div>
        ) : null}

        {activeTab === 'rsvp' && (
          <RsvpTab
            party={party}
            isAdmin={isAdmin}
            currentUser={currentUser}
            authBusy={authBusy}
            authError={authError}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onUpdateParty={onUpdateParty}
            onSaveSelfRsvp={onSaveSelfRsvp}
            onAdminChangeGuestStatus={onAdminChangeGuestStatus}
            onAdminSetRsvpApproval={onAdminSetRsvpApproval}
            onAdminRemoveGuest={onAdminRemoveGuest}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarTab party={party} shareUrl={shareUrl} appTheme={appTheme} />
        )}
        {activeTab === 'expenses' && (
          <ExpensesTab
            party={party}
            isAdmin={isAdmin}
            currentUser={currentUser}
            shareUrl={shareUrl}
            appTheme={appTheme}
            mediaApiBase={mediaApiBase}
            hostPaymentProfile={hostPaymentProfile}
            onUpdateParty={onUpdateParty}
            onSaveHostPaymentProfile={onSaveHostPaymentProfile}
          />
        )}
        {activeTab === 'album' && (
          <AlbumTab
            party={party}
            isAdmin={isAdmin}
            currentUser={currentUser}
            authBusy={authBusy}
            mediaApiBase={mediaApiBase}
            onSignIn={onSignIn}
          />
        )}
        {activeTab === 'playlist' && (
          <PlaylistTab
            party={party}
            isAdmin={isAdmin}
            currentUser={currentUser}
            authBusy={authBusy}
            mediaApiBase={mediaApiBase}
            onSignIn={onSignIn}
            onUpdateParty={onUpdateParty}
          />
        )}

        <footer className="mt-8 flex justify-center">
          {currentUser ? (
            <button
              type="button"
              disabled={authBusy}
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600 disabled:opacity-60"
            >
              <LogOut className="h-3 w-3" />
              {isAdmin
                ? `主辦人模式（${currentUser.email}）· 登出`
                : `已登入：${currentUser.displayName || currentUser.email} · 登出`}
            </button>
          ) : (
            <button
              type="button"
              disabled={authBusy}
              onClick={onSignIn}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600 disabled:opacity-60"
            >
              <LogIn className="h-3 w-3" /> Google 登入
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
