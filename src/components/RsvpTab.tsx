import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { toast } from 'sonner';
import {
  CheckCircle2,
  HelpCircle,
  XCircle,
  UserPlus,
  Trash2,
  Edit3,
  Check,
  LogIn,
  LogOut,
  Clock,
  ShieldCheck,
  X,
  ListOrdered,
  ArrowUpCircle,
} from 'lucide-react';
import type { ApprovalStatus, Guest, Party, RsvpStatus } from '../types/party';
import {
  generateId,
  getApprovedGuests,
  getPendingRsvps,
  getRejectedRsvps,
  getWaitlistRsvps,
  isHostGuest,
} from '../lib/partyStore';
import { PlaceAutocomplete } from './PlaceAutocomplete';
import { fireConfetti } from '../lib/celebrate';

interface RsvpTabProps {
  party: Party;
  isAdmin: boolean;
  currentUser: User | null;
  authBusy: boolean;
  authError: string;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onUpdateParty: (updated: Party) => Promise<void>;
  onSaveSelfRsvp: (guest: Guest) => Promise<void>;
  onAdminChangeGuestStatus: (guestId: string, nextStatus: RsvpStatus) => Promise<void>;
  onAdminSetRsvpApproval: (guestId: string, approvalStatus: ApprovalStatus) => Promise<void>;
  onAdminRemoveGuest: (guestId: string) => Promise<void>;
}

const STATUS_META: Record<
  RsvpStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  going: {
    label: '出席',
    color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: CheckCircle2,
  },
  maybe: {
    label: '未定',
    color: 'bg-amber-50 text-amber-700 ring-amber-200',
    icon: HelpCircle,
  },
  declined: {
    label: '唔得閒',
    color: 'bg-slate-100 text-slate-600 ring-slate-200',
    icon: XCircle,
  },
};

export function RsvpTab({
  party,
  isAdmin,
  currentUser,
  authBusy,
  authError,
  onSignIn,
  onSignOut,
  onUpdateParty,
  onSaveSelfRsvp,
  onAdminChangeGuestStatus,
  onAdminSetRsvpApproval,
  onAdminRemoveGuest,
}: RsvpTabProps) {
  const approvedGuests = useMemo(() => getApprovedGuests(party), [party]);
  const pendingRsvps = useMemo(() => getPendingRsvps(party), [party]);
  const waitlistRsvps = useMemo(() => getWaitlistRsvps(party), [party]);
  const rejectedRsvps = useMemo(() => getRejectedRsvps(party), [party]);
  const myRsvp = currentUser ? party.rsvps?.[currentUser.uid] : undefined;

  const goingCount = approvedGuests.filter((g) => g.status === 'going').length;
  const maybeCount = approvedGuests.filter((g) => g.status === 'maybe').length;
  const declinedCount = approvedGuests.filter((g) => g.status === 'declined').length;
  const maxGuests = party.maxGuests && party.maxGuests > 0 ? party.maxGuests : undefined;
  const isFull = Boolean(maxGuests && goingCount >= maxGuests);
  const hasHostInList = approvedGuests.some((g) => isHostGuest(g));

  const myWaitlistPosition = useMemo(() => {
    if (!currentUser) return -1;
    const idx = waitlistRsvps.findIndex((g) => g.id === currentUser.uid);
    return idx >= 0 ? idx + 1 : -1;
  }, [currentUser, waitlistRsvps]);

  const displayedGuests = useMemo(() => {
    if (
      !isAdmin &&
      myRsvp &&
      (myRsvp.approvalStatus === 'pending' || myRsvp.approvalStatus === 'waitlist')
    ) {
      return [...approvedGuests, myRsvp];
    }
    return approvedGuests;
  }, [approvedGuests, isAdmin, myRsvp]);

  // 主辦人新增名單表單狀態
  const [adminAddName, setAdminAddName] = useState('');
  const [adminAddStatus, setAdminAddStatus] = useState<RsvpStatus>('going');
  const [adminAddNote, setAdminAddNote] = useState('');

  // 一般登入訪客個人報名表單狀態
  const [selfName, setSelfName] = useState('');
  const [selfStatus, setSelfStatus] = useState<RsvpStatus>('going');
  const [selfIdentityOrIg, setSelfIdentityOrIg] = useState('');
  const [selfNote, setSelfNote] = useState('');
  const [selfSaved, setSelfSaved] = useState(false);
  const [selfError, setSelfError] = useState('');

  // 主辦人編輯活動資料狀態
  const [editingInfo, setEditingInfo] = useState(false);
  const [editTitle, setEditTitle] = useState(party.title);
  const [editStart, setEditStart] = useState(party.startTime);
  const [editEnd, setEditEnd] = useState(party.endTime ?? '');
  const [editMaxGuests, setEditMaxGuests] = useState(party.maxGuests ? String(party.maxGuests) : '');
  const [editLocation, setEditLocation] = useState(party.location);
  const [editAddress, setEditAddress] = useState(party.address ?? '');
  const [editDesc, setEditDesc] = useState(party.description);

  useEffect(() => {
    if (!currentUser || isAdmin) return;
    if (myRsvp) {
      setSelfName(myRsvp.name);
      setSelfStatus(myRsvp.status);
      setSelfIdentityOrIg(myRsvp.identityOrIg ?? '');
      setSelfNote(myRsvp.note ?? '');
    } else {
      const defaultName =
        currentUser.displayName?.trim() ||
        currentUser.email?.split('@')[0] ||
        '';
      setSelfName(defaultName);
      setSelfStatus('going');
      setSelfIdentityOrIg('');
      setSelfNote('');
    }
  }, [currentUser, isAdmin, myRsvp]);

  async function handleRestoreHost() {
    if (!isAdmin || hasHostInList || !party.hostName.trim()) return;
    const now = new Date().toISOString();
    const hostGuest: Guest = {
      id: generateId('g'),
      name: `${party.hostName.trim()}（搞手）`,
      isHost: true,
      status: 'going',
      approvalStatus: 'approved',
      note: '',
      updatedAt: now,
    };
    await onUpdateParty({
      ...party,
      guests: [hostGuest, ...party.guests],
    });
    toast.success('已將搞手加回名單');
  }

  async function handleAdminAddGuest(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const trimmed = adminAddName.trim();
    if (!trimmed) return;

    const newGuest: Guest = {
      id: generateId('g'),
      name: trimmed,
      status: adminAddStatus,
      approvalStatus: 'approved',
      note: adminAddNote.trim(),
      updatedAt: new Date().toISOString(),
    };

    await onUpdateParty({
      ...party,
      guests: [...party.guests, newGuest],
    });
    setAdminAddName('');
    setAdminAddNote('');
    setAdminAddStatus('going');
    toast.success(`已新增「${trimmed}」至名單`);
  }

  async function handleSubmitSelfRsvp(e: FormEvent) {
    e.preventDefault();
    if (!currentUser) return;
    const trimmed = selfName.trim();
    if (!trimmed) return;

    setSelfError('');
    try {
      const nextApproval: ApprovalStatus =
        myRsvp?.approvalStatus === 'approved'
          ? 'approved'
          : myRsvp?.approvalStatus === 'waitlist'
            ? 'waitlist'
            : 'pending';
      await onSaveSelfRsvp({
        id: currentUser.uid,
        uid: currentUser.uid,
        email: currentUser.email ?? undefined,
        name: trimmed,
        status: selfStatus,
        approvalStatus: nextApproval,
        identityOrIg: selfIdentityOrIg.trim(),
        note: selfNote.trim(),
        updatedAt: new Date().toISOString(),
      });
      setSelfSaved(true);
      toast.success(nextApproval === 'approved' ? '已更新你的報名狀態' : '已提交報名申請，等待主辦人審核');
      if (!myRsvp || selfStatus === 'going') {
        fireConfetti('rsvp');
      }
      setTimeout(() => setSelfSaved(false), 2000);
    } catch (err) {
      const detail = err instanceof Error ? err.message : '儲存報名狀態失敗';
      setSelfError(`更新失敗：${detail}`);
      toast.error(`更新失敗：${detail}`);
    }
  }

  async function handleToggleOwnStatus(guest: Guest) {
    if (!currentUser || guest.id !== currentUser.uid) return;
    const order: RsvpStatus[] = ['going', 'maybe', 'declined'];
    const nextStatus = order[(order.indexOf(guest.status) + 1) % order.length];
    await onSaveSelfRsvp({
      ...guest,
      status: nextStatus,
      approvalStatus: guest.approvalStatus ?? 'approved',
      updatedAt: new Date().toISOString(),
    });
  }

  async function handleSaveInfo(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const parsedMax = Number(editMaxGuests);
    const validMax =
      editMaxGuests.trim() !== '' && Number.isFinite(parsedMax) && parsedMax >= 1
        ? Math.floor(parsedMax)
        : undefined;

    await onUpdateParty({
      ...party,
      title: editTitle.trim() || party.title,
      startTime: editStart,
      endTime: editEnd.trim(),
      maxGuests: validMax,
      location: editLocation.trim(),
      address: editAddress.trim(),
      description: editDesc.trim(),
    });
    setEditingInfo(false);
    toast.success('活動資料已更新');
  }

  const myApprovalStatus: ApprovalStatus | null = myRsvp
    ? (myRsvp.approvalStatus ?? 'approved')
    : null;

  return (
    <div className="space-y-5">
      {/* 主辦人專用：待審核報名列表 */}
      {isAdmin && pendingRsvps.length > 0 ? (
        <section className="rounded-3xl bg-amber-50/70 p-5 shadow-sm ring-1 ring-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
              <Clock className="h-4 w-4 text-amber-600" />
              待審核報名（{pendingRsvps.length}）
            </h2>
            <span className="rounded-full bg-amber-200/70 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
              {isFull ? `正選已滿（${goingCount}/${maxGuests}）` : '需你審核'}
            </span>
          </div>

          <div className="mt-3 space-y-2.5">
            {pendingRsvps.map((guest) => {
              const meta = STATUS_META[guest.status];
              return (
                <div
                  key={guest.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-amber-200/70"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-slate-900">{guest.name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    {guest.email ? (
                      <p className="truncate text-[11px] text-slate-400">{guest.email}</p>
                    ) : null}
                    {guest.identityOrIg ? (
                      <p className="mt-1 text-xs font-medium text-amber-900">
                        身份 / IG：{guest.identityOrIg}
                      </p>
                    ) : null}
                    {guest.note ? (
                      <p className="mt-0.5 text-xs text-slate-600">備註：{guest.note}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {isFull ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onAdminSetRsvpApproval(guest.id, 'waitlist')}
                          className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                        >
                          <ListOrdered className="h-3.5 w-3.5" /> 排入候補
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdminSetRsvpApproval(guest.id, 'approved')}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                        >
                          <Check className="h-3.5 w-3.5" /> 超額批准
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onAdminSetRsvpApproval(guest.id, 'approved')}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" /> 批准
                        </button>
                        {maxGuests ? (
                          <button
                            type="button"
                            onClick={() => onAdminSetRsvpApproval(guest.id, 'waitlist')}
                            className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                          >
                            <ListOrdered className="h-3.5 w-3.5" /> 候補
                          </button>
                        ) : null}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onAdminSetRsvpApproval(guest.id, 'rejected')}
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" /> 拒絕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 主辦人專用：候補名單（有空位時一鍵遞補） */}
      {isAdmin && waitlistRsvps.length > 0 ? (
        <section className="rounded-3xl bg-indigo-50/70 p-5 shadow-sm ring-1 ring-indigo-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-indigo-900">
              <ListOrdered className="h-4 w-4 text-indigo-600" />
              候補名單（{waitlistRsvps.length}）
            </h2>
            {!isFull && maxGuests ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                現有空位（{goingCount}/{maxGuests}）可遞補
              </span>
            ) : null}
          </div>

          <div className="mt-3 space-y-2">
            {waitlistRsvps.map((guest, idx) => (
              <div
                key={guest.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-indigo-200/70"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                      #{idx + 1}
                    </span>
                    <p className="truncate text-sm font-semibold text-slate-900">{guest.name}</p>
                  </div>
                  {guest.identityOrIg ? (
                    <p className="mt-0.5 text-xs font-medium text-indigo-900">
                      身份 / IG：{guest.identityOrIg}
                    </p>
                  ) : null}
                  {guest.note ? (
                    <p className="mt-0.5 text-xs text-slate-500">備註：{guest.note}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAdminSetRsvpApproval(guest.id, 'approved')}
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5" /> 遞補正選
                  </button>
                  <button
                    type="button"
                    aria-label="移除候補"
                    onClick={() => onAdminRemoveGuest(guest.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 活動詳情與編輯 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">活動資料</h2>
          {isAdmin && !editingInfo ? (
            <button
              type="button"
              onClick={() => {
                setEditTitle(party.title);
                setEditStart(party.startTime);
                setEditEnd(party.endTime ?? '');
                setEditMaxGuests(party.maxGuests ? String(party.maxGuests) : '');
                setEditLocation(party.location);
                setEditAddress(party.address ?? '');
                setEditDesc(party.description);
                setEditingInfo(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              <Edit3 className="h-3.5 w-3.5" /> 編輯
            </button>
          ) : null}
        </div>

        {isAdmin && editingInfo ? (
          <form onSubmit={handleSaveInfo} className="mt-3 space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="活動名稱"
              />
              <input
                type="number"
                min="1"
                step="1"
                value={editMaxGuests}
                onChange={(e) => setEditMaxGuests(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="人數上限（留空為不限）"
              />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600">開始時間</label>
                <input
                  type="datetime-local"
                  required
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-600">
                    結束時間 <span className="font-normal text-slate-400">（選填）</span>
                  </label>
                  {editEnd ? (
                    <button
                      type="button"
                      onClick={() => setEditEnd('')}
                      className="text-[11px] font-medium text-slate-400 hover:text-brand-600"
                    >
                      清除
                    </button>
                  ) : null}
                </div>
                <input
                  type="datetime-local"
                  min={editStart}
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <PlaceAutocomplete
              location={editLocation}
              address={editAddress}
              onChangeLocation={setEditLocation}
              onChangeAddress={setEditAddress}
            />
            <textarea
              rows={2}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="備註"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingInfo(false)}
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                <Check className="h-3.5 w-3.5" /> 儲存修改
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {party.description ||
              (isAdmin ? '暫未填寫備註，可按右上角「編輯」補充。' : '主辦人暫未填寫活動備註。')}
          </p>
        )}
      </section>

      {/* 報名區塊：主辦人可手動加人；一般訪客須登入 Google 帳號提交報名申請並等主辦人審核 */}
      {isAdmin ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <UserPlus className="h-4 w-4 text-brand-600" />
            手動新增參加者（主辦人）
          </h2>
          <form onSubmit={handleAdminAddGuest} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                value={adminAddName}
                onChange={(e) => setAdminAddName(e.target.value)}
                placeholder="參加者名字 / 稱呼"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <input
                type="text"
                value={adminAddNote}
                onChange={(e) => setAdminAddNote(e.target.value)}
                placeholder="備註（例如：唔飲酒、8點半先到）"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {(['going', 'maybe', 'declined'] as RsvpStatus[]).map((s) => {
                  const active = adminAddStatus === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAdminAddStatus(s)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ring-1 ${
                        active
                          ? STATUS_META[s].color
                          : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {STATUS_META[s].label}
                    </button>
                  );
                })}
              </div>
              <button
                type="submit"
                className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                加入名單
              </button>
            </div>
          </form>
        </section>
      ) : !currentUser ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <UserPlus className="h-4 w-4 text-brand-600" />
            立即報名（RSVP）
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            {isFull
              ? `目前正選名額已滿（${goingCount}/${maxGuests} 人），登入 Google 帳號提交報名可由主辦人安排候補。`
              : '請先登入你的 Google 帳號提交報名申請，主辦人審核通過後便會加入正式名單。'}
          </p>
          {authError ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {authError}
            </p>
          ) : null}
          <button
            type="button"
            disabled={authBusy}
            onClick={onSignIn}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {authBusy ? '登入中...' : isFull ? '使用 Google 帳號登入並申請候補' : '使用 Google 帳號登入並報名'}
          </button>
        </section>
      ) : (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <UserPlus className="h-4 w-4 text-brand-600" />
              {myRsvp ? '我的報名狀態' : isFull ? '申請候補名單' : '立即報名（RSVP）'}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="max-w-[180px] truncate">{currentUser.email}</span>
              <button
                type="button"
                disabled={authBusy}
                onClick={onSignOut}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <LogOut className="h-3 w-3" /> 登出
              </button>
            </div>
          </div>

          {myApprovalStatus === 'pending' ? (
            <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                {isFull
                  ? `報名已提交，因正選名額已滿（${goingCount}/${maxGuests}），正等待主辦人審核或安排候補。`
                  : '報名已提交，正等待主辦人審核。審核通過後會自動加入下方正式名單。'}
              </span>
            </div>
          ) : myApprovalStatus === 'waitlist' ? (
            <div className="mt-3 flex items-start gap-2 rounded-2xl bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-800 ring-1 ring-indigo-200">
              <ListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <span>
                你目前排在候補名單第 {myWaitlistPosition > 0 ? myWaitlistPosition : 1} 位，如有參加者退出，主辦人會即時為你遞補正選。
              </span>
            </div>
          ) : myApprovalStatus === 'approved' ? (
            <div className="mt-3 flex items-center gap-1.5 rounded-2xl bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>你的報名已通過主辦人審核，可隨時更新出席狀態。</span>
            </div>
          ) : myApprovalStatus === 'rejected' ? (
            <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 ring-1 ring-rose-200">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <span>你的報名暫未獲主辦人批准；如有需要可修改資料後重新提交審核。</span>
            </div>
          ) : isFull ? (
            <div className="mt-3 flex items-start gap-2 rounded-2xl bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-800 ring-1 ring-indigo-200">
              <ListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <span>正選名額已滿（{goingCount}/{maxGuests}），提交後將由主辦人安排候補。</span>
            </div>
          ) : null}

          <form onSubmit={handleSubmitSelfRsvp} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                value={selfName}
                onChange={(e) => setSelfName(e.target.value)}
                placeholder="你的名字 / 稱呼"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <input
                type="text"
                required
                value={selfIdentityOrIg}
                onChange={(e) => setSelfIdentityOrIg(e.target.value)}
                placeholder="審核備註：你的身份或 IG ID（例如：@username、同事）"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <input
                type="text"
                value={selfNote}
                onChange={(e) => setSelfNote(e.target.value)}
                placeholder="其他備註（選填，例如：唔飲酒、8點半先到）"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:col-span-2"
              />
            </div>

            {selfError ? (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {selfError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {(['going', 'maybe', 'declined'] as RsvpStatus[]).map((s) => {
                  const active = selfStatus === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelfStatus(s)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ring-1 ${
                        active
                          ? STATUS_META[s].color
                          : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {STATUS_META[s].label}
                    </button>
                  );
                })}
              </div>
              <button
                type="submit"
                className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                {selfSaved
                  ? '已提交 ✓'
                  : myApprovalStatus === 'approved'
                    ? '更新我的狀態'
                    : myApprovalStatus === 'waitlist'
                      ? '更新候補資料'
                      : myApprovalStatus === 'pending'
                        ? '更新申請資料'
                        : myApprovalStatus === 'rejected'
                          ? '重新提交審核'
                          : isFull
                            ? '提交候補申請'
                            : '提交報名申請'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 正式參加者名單（僅顯示已通過審核或主辦人加入的成員；待審核／候補本人亦可見自己） */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              參加者名單（{approvedGuests.length}）
            </h2>
            {isAdmin && !hasHostInList && party.hostName?.trim() ? (
              <button
                type="button"
                onClick={handleRestoreHost}
                className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-600 ring-1 ring-brand-200 transition hover:bg-rose-100"
              >
                ＋ 加回搞手（{party.hostName.trim()}）
              </button>
            ) : null}
            {maxGuests ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  isFull
                    ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {isFull ? `已額滿 ${goingCount}/${maxGuests}` : `名額 ${goingCount}/${maxGuests}`}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs font-medium">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700">
              出席 {goingCount}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700">
              未定 {maybeCount}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">
              缺席 {declinedCount}
            </span>
            {waitlistRsvps.length > 0 ? (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-700">
                候補 {waitlistRsvps.length}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          {displayedGuests.map((guest) => {
            const meta = STATUS_META[guest.status];
            const Icon = meta.icon;
            const isPending = guest.approvalStatus === 'pending';
            const isWaitlist = guest.approvalStatus === 'waitlist';
            const isOwnEntry = Boolean(currentUser && guest.id === currentUser.uid);
            const canToggleStatus = !isPending && !isWaitlist && (isAdmin || isOwnEntry);

            return (
              <div key={guest.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-slate-900">{guest.name}</p>
                    {isOwnEntry ? (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-brand-600">
                        你
                      </span>
                    ) : null}
                  </div>
                  {guest.note ? (
                    <p className="truncate text-xs text-slate-500">{guest.note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isPending ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                      <Clock className="h-3.5 w-3.5" />
                      待審核
                    </span>
                  ) : isWaitlist ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
                      <ListOrdered className="h-3.5 w-3.5" />
                      候補 {myWaitlistPosition > 0 ? `#${myWaitlistPosition}` : ''}
                    </span>
                  ) : canToggleStatus ? (
                    <button
                      type="button"
                      title={isAdmin ? '切換出席狀態' : '切換自己的出席狀態'}
                      onClick={() => {
                        if (isAdmin) {
                          const order: RsvpStatus[] = ['going', 'maybe', 'declined'];
                          const next = order[(order.indexOf(guest.status) + 1) % order.length];
                          onAdminChangeGuestStatus(guest.id, next);
                        } else {
                          handleToggleOwnStatus(guest);
                        }
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition hover:opacity-85 ${meta.color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </button>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </span>
                  )}

                  {isAdmin ? (
                    <button
                      type="button"
                      aria-label="移除參加者"
                      onClick={() => onAdminRemoveGuest(guest.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 主辦人專用：未批准報名紀錄（可重新批准或刪除） */}
      {isAdmin && rejectedRsvps.length > 0 ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <h2 className="text-xs font-bold text-slate-500">
            未批准的報名（{rejectedRsvps.length}）
          </h2>
          <div className="mt-2.5 divide-y divide-slate-100">
            {rejectedRsvps.map((guest) => (
              <div key={guest.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-700">{guest.name}</p>
                  {guest.identityOrIg ? (
                    <p className="truncate text-[11px] font-medium text-slate-500">
                      身份 / IG：{guest.identityOrIg}
                    </p>
                  ) : null}
                  {guest.email ? (
                    <p className="truncate text-[11px] text-slate-400">{guest.email}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAdminSetRsvpApproval(guest.id, 'approved')}
                    className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    重新批准
                  </button>
                  <button
                    type="button"
                    aria-label="刪除記錄"
                    onClick={() => onAdminRemoveGuest(guest.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
