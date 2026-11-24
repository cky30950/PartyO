import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  CalendarPlus,
  Users,
  Wallet,
  ArrowRight,
  Trash2,
  Cloud,
  LogIn,
  LogOut,
  Archive,
  CopyPlus,
  X,
} from 'lucide-react';
import type { AppTheme, HostPaymentProfile, Party } from '../types/party';
import {
  deleteParty,
  generateId,
  getAllGuests,
  getPendingRsvps,
  saveParty,
} from '../lib/partyStore';
import { formatPartyDateTime, isPartyEnded } from '../lib/calendar';
import { THEME_LIST } from '../lib/themes';
import { PlaceAutocomplete } from './PlaceAutocomplete';
import { ThemeSwitcher } from './ThemeSwitcher';

interface HomeViewProps {
  recentParties: Party[];
  isAdmin: boolean;
  currentUser: User | null;
  hostPaymentProfile?: HostPaymentProfile | null;
  appTheme?: AppTheme;
  onChangeTheme?: (theme: AppTheme) => void;
  authBusy?: boolean;
  authError?: string;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onOpenParty: (partyId: string) => void;
  onRefreshList: () => void;
}

interface ClonedPayInfo {
  sourceTitle: string;
  theme?: AppTheme;
  paymeLink?: string;
  paymeQrImage?: string;
  fpsInfo?: string;
  fpsQrImage?: string;
}

function getDefaultStartTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T19:00`;
}

export function HomeView({
  recentParties,
  isAdmin,
  currentUser,
  hostPaymentProfile = null,
  appTheme = 'tavern',
  onChangeTheme,
  authBusy = false,
  authError = '',
  onSignIn,
  onSignOut,
  onOpenParty,
  onRefreshList,
}: HomeViewProps) {
  const formSectionRef = useRef<HTMLElement | null>(null);

  const [title, setTitle] = useState('');
  const [hostName, setHostName] = useState('');
  const [startTime, setStartTime] = useState(() => getDefaultStartTime());
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [maxGuests, setMaxGuests] = useState('');
  const [description, setDescription] = useState('');
  const [clonedPayInfo, setClonedPayInfo] = useState<ClonedPayInfo | null>(null);
  const [useSavedPaymentProfile, setUseSavedPaymentProfile] = useState(true);

  const hasSavedCloudPayment = Boolean(
    hostPaymentProfile?.paymeLink?.trim() ||
      hostPaymentProfile?.paymeQrImage ||
      hostPaymentProfile?.fpsInfo?.trim() ||
      hostPaymentProfile?.fpsQrImage
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const { activeParties, endedParties } = useMemo(() => {
    const now = new Date();
    const active: Party[] = [];
    const ended: Party[] = [];
    for (const p of recentParties) {
      if (isPartyEnded(p, now)) {
        ended.push(p);
      } else {
        active.push(p);
      }
    }
    active.sort((a, b) => a.startTime.localeCompare(b.startTime));
    ended.sort((a, b) => b.startTime.localeCompare(a.startTime));
    return { activeParties: active, endedParties: ended };
  }, [recentParties]);

  function handleCloneParty(source: Party) {
    setTitle(`${source.title}（新局）`);
    setHostName(source.hostName);
    setLocation(source.location);
    setAddress(source.address ?? '');
    setDescription(source.description);
    setMaxGuests(source.maxGuests ? String(source.maxGuests) : '');
    setStartTime(getDefaultStartTime());
    setEndTime('');
    setClonedPayInfo({
      sourceTitle: source.title,
      theme: source.theme,
      paymeLink: source.paymeLink,
      paymeQrImage: source.paymeQrImage,
      fpsInfo: source.fpsInfo,
      fpsQrImage: source.fpsQrImage,
    });
    setErrorMsg('');
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin || !title.trim() || !hostName.trim()) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const now = new Date().toISOString();
      const hostId = generateId('g');
      const parsedMax = Number(maxGuests);
      const validMaxGuests =
        maxGuests.trim() !== '' && Number.isFinite(parsedMax) && parsedMax >= 1
          ? Math.floor(parsedMax)
          : undefined;

      const defaultPay = clonedPayInfo
        ? clonedPayInfo
        : useSavedPaymentProfile && hasSavedCloudPayment && hostPaymentProfile
          ? hostPaymentProfile
          : null;

      const party: Party = {
        id: generateId(),
        title: title.trim(),
        description: description.trim(),
        startTime,
        endTime: endTime.trim(),
        location: location.trim(),
        address: address.trim(),
        hostName: hostName.trim(),
        ...(validMaxGuests ? { maxGuests: validMaxGuests } : {}),
        theme: clonedPayInfo?.theme ?? appTheme,
        currency: 'HK$',
        ...(defaultPay?.paymeLink ? { paymeLink: defaultPay.paymeLink } : {}),
        ...(defaultPay?.paymeQrImage ? { paymeQrImage: defaultPay.paymeQrImage } : {}),
        ...(defaultPay?.fpsInfo ? { fpsInfo: defaultPay.fpsInfo } : {}),
        ...(defaultPay?.fpsQrImage ? { fpsQrImage: defaultPay.fpsQrImage } : {}),
        guests: [
          {
            id: hostId,
            name: `${hostName.trim()}（搞手）`,
            isHost: true,
            status: 'going',
            approvalStatus: 'approved',
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
      setClonedPayInfo(null);
      onRefreshList();
      onOpenParty(party.id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法連線至 Firebase Realtime Database';
      setErrorMsg(`建立失敗：${detail}（請確認 Firebase Console 已啟用 Realtime Database 並發佈規則）`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(p: Party) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `確定要永久刪除「${p.title}」嗎？\n這會同時刪除 Firebase 雲端資料，已分享的連結亦會失效。`
    );
    if (!ok) return;
    try {
      await deleteParty(p.id);
      onRefreshList();
    } catch (err) {
      const detail = err instanceof Error ? err.message : '刪除失敗';
      setErrorMsg(`刪除雲端資料失敗：${detail}`);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50/70 via-slate-50 to-slate-100 pb-16">
      <header className="mx-auto max-w-2xl px-4 pt-6 pb-6">
        <div className="rpg-wood-bar flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3 text-[#FFF9EB]">
          <div className="flex items-center gap-2.5">
            <img src="./icon.svg" alt="PartyO" className="h-10 w-10" />
            <div>
              <h1 className="font-pixel text-lg font-bold tracking-wider text-[#F7C948]">
                PartyO
              </h1>
              <p className="text-[11px] text-[#F3E7CC]">開局 · 日曆邀請 · 費用分攤一條龍</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-[#2E5A3B] px-2.5 py-1 text-[11px] font-medium text-[#DFF5E1] ring-1 ring-[#F7C948]/40">
              <Cloud className="h-3.5 w-3.5" /> 線上即時同步中
            </span>
            {currentUser && onSignOut ? (
              <button
                type="button"
                disabled={authBusy}
                title={currentUser.email ? `已登入：${currentUser.email}` : '登出帳號'}
                onClick={onSignOut}
                className="inline-flex items-center gap-1 rounded bg-[#FFF9EB] px-2.5 py-1 text-xs font-semibold text-[#2F1B0E] ring-1 ring-[#2F1B0E] transition hover:bg-[#F7C948] disabled:opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" /> 登出
              </button>
            ) : !currentUser && onSignIn ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={onSignIn}
                className="inline-flex items-center gap-1 rounded bg-[#F7C948] px-2.5 py-1 text-xs font-bold text-[#2F1B0E] ring-1 ring-[#2F1B0E] transition hover:bg-[#FCE07A] disabled:opacity-60"
              >
                <LogIn className="h-3.5 w-3.5" /> {authBusy ? '登入中...' : 'Google 登入'}
              </button>
            ) : null}
          </div>
        </div>

        {isAdmin && onChangeTheme ? (
          <div className="mt-3">
            <ThemeSwitcher
              theme={appTheme}
              label={`首頁預設主題（${THEME_LIST.length} 款可選）`}
              onChangeTheme={onChangeTheme}
            />
          </div>
        ) : null}

        {authError ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700">
            {authError}
          </p>
        ) : null}

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
            <p className="mt-1.5 text-xs font-semibold text-slate-800">輕鬆費用分攤</p>
            <p className="mt-0.5 text-[11px] text-slate-500">最少轉帳 &amp; PayMe 追蹤</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4">
        {/* 只有主辦人管理員才看得到「建立新派對」 */}
        {isAdmin ? (
          <section
            ref={formSectionRef}
            className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6"
          >
            <h2 className="text-base font-bold text-slate-900">建立新派對</h2>

            {clonedPayInfo ? (
              <div className="mt-3 flex items-start justify-between gap-2 rounded-2xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                <span>
                  已從「{clonedPayInfo.sourceTitle}」帶入場地、備註、人數上限及 PayMe／轉數快收款資料，調整日期即可開新局。
                </span>
                <button
                  type="button"
                  aria-label="取消帶入"
                  onClick={() => setClonedPayInfo(null)}
                  className="shrink-0 rounded-md p-0.5 text-emerald-600 hover:bg-emerald-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

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
                  <label className="block text-xs font-semibold text-slate-700">
                    人數上限 <span className="font-normal text-slate-400">（選填）</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={maxGuests}
                    onChange={(e) => setMaxGuests(e.target.value)}
                    placeholder="不限人數（填數字將啟用候補）"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>

                <PlaceAutocomplete
                  location={location}
                  address={address}
                  onChangeLocation={setLocation}
                  onChangeAddress={setAddress}
                />

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    開始時間 <span className="text-brand-600">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">
                      結束時間 <span className="font-normal text-slate-400">（選填）</span>
                    </label>
                    {endTime ? (
                      <button
                        type="button"
                        onClick={() => setEndTime('')}
                        className="text-[11px] font-medium text-slate-400 hover:text-brand-600"
                      >
                        清除
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="datetime-local"
                    min={startTime}
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

              {!clonedPayInfo && hasSavedCloudPayment ? (
                <label className="flex cursor-pointer items-center gap-2 rounded-2xl bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-800 ring-1 ring-emerald-200/80">
                  <input
                    type="checkbox"
                    checked={useSavedPaymentProfile}
                    onChange={(e) => setUseSavedPaymentProfile(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>自動帶入已保存的雲端預設收款資料（PayMe／轉數快及二維碼）</span>
                </label>
              ) : null}

              {errorMsg ? (
                <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {errorMsg}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
              >
                {submitting ? '建立中...' : '建立派對並生成專屬連結'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </section>
        ) : null}

        {activeParties.length > 0 && (
          <section className="space-y-3">
            <h3 className="px-1 text-sm font-bold text-slate-700">
              進行中及即將舉行的派對（{activeParties.length}）
            </h3>
            <div className="space-y-2.5">
              {activeParties.map((p) => {
                const goingCount = getAllGuests(p).filter((g) => g.status === 'going').length;
                const pendingCount = getPendingRsvps(p).length;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 transition hover:ring-brand-200"
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
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-brand-600">
                        <span>
                          {p.maxGuests ? `${goingCount}/${p.maxGuests} 人出席` : `${goingCount} 人出席`} ·{' '}
                          {p.expenses.length} 筆開支
                        </span>
                        {isAdmin && pendingCount > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            {pendingCount} 人待審核
                          </span>
                        ) : null}
                      </p>
                    </button>
                    {isAdmin ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title="一鍵複製此活動開新局"
                          aria-label="複製此活動開新局"
                          onClick={() => handleCloneParty(p)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
                        >
                          <CopyPlus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="永久刪除派對（連同雲端資料）"
                          onClick={() => handleDelete(p)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {endedParties.length > 0 && (
          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 px-1 text-sm font-bold text-slate-500">
              <Archive className="h-4 w-4 text-slate-400" />
              已結束的活動（{endedParties.length}）
            </h3>
            <div className="space-y-2.5">
              {endedParties.map((p) => {
                const goingCount = getAllGuests(p).filter((g) => g.status === 'going').length;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-slate-200/70 transition hover:bg-white hover:ring-slate-300"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenParty(p.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-slate-700">{p.title}</p>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          已結束
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {formatPartyDateTime(p.startTime, p.endTime)}
                        {p.location ? ` · ${p.location}` : ''}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-slate-500">
                        {p.maxGuests ? `${goingCount}/${p.maxGuests} 人出席` : `${goingCount} 人出席`} ·{' '}
                        {p.expenses.length} 筆開支
                      </p>
                    </button>
                    {isAdmin ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title="一鍵複製此活動開新局"
                          aria-label="複製此活動開新局"
                          onClick={() => handleCloneParty(p)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
                        >
                          <CopyPlus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="永久刪除派對（連同雲端資料）"
                          onClick={() => handleDelete(p)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!isAdmin && activeParties.length === 0 && endedParties.length === 0 ? (
          <section className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/80">
            <p className="text-sm font-semibold text-slate-700">暫未有瀏覽過的派對活動</p>
            <p className="mt-1 text-xs text-slate-500">
              打開主辦人分享的專屬活動連結後，活動就會顯示在這裡方便你隨時返回查看。
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
