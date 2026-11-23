import { useState, type FormEvent } from 'react';
import { CheckCircle2, HelpCircle, XCircle, UserPlus, Trash2, Edit3, Check } from 'lucide-react';
import type { Guest, Party, RsvpStatus } from '../types/party';
import { generateId } from '../lib/partyStore';
import { PlaceAutocomplete } from './PlaceAutocomplete';

interface RsvpTabProps {
  party: Party;
  onUpdateParty: (updated: Party) => Promise<void>;
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

export function RsvpTab({ party, onUpdateParty }: RsvpTabProps) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<RsvpStatus>('going');
  const [note, setNote] = useState('');
  const [editingInfo, setEditingInfo] = useState(false);

  const [editTitle, setEditTitle] = useState(party.title);
  const [editStart, setEditStart] = useState(party.startTime);
  const [editEnd, setEditEnd] = useState(party.endTime ?? '');
  const [editLocation, setEditLocation] = useState(party.location);
  const [editAddress, setEditAddress] = useState(party.address ?? '');
  const [editDesc, setEditDesc] = useState(party.description);

  const goingCount = party.guests.filter((g) => g.status === 'going').length;
  const maybeCount = party.guests.filter((g) => g.status === 'maybe').length;
  const declinedCount = party.guests.filter((g) => g.status === 'declined').length;

  async function handleAddGuest(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const newGuest: Guest = {
      id: generateId('g'),
      name: trimmed,
      status,
      note: note.trim(),
      updatedAt: new Date().toISOString(),
    };

    await onUpdateParty({
      ...party,
      guests: [...party.guests, newGuest],
    });
    setName('');
    setNote('');
    setStatus('going');
  }

  async function handleChangeStatus(guestId: string, nextStatus: RsvpStatus) {
    await onUpdateParty({
      ...party,
      guests: party.guests.map((g) =>
        g.id === guestId ? { ...g, status: nextStatus, updatedAt: new Date().toISOString() } : g
      ),
    });
  }

  async function handleRemoveGuest(guestId: string) {
    await onUpdateParty({
      ...party,
      guests: party.guests.filter((g) => g.id !== guestId),
    });
  }

  async function handleSaveInfo(e: FormEvent) {
    e.preventDefault();
    await onUpdateParty({
      ...party,
      title: editTitle.trim() || party.title,
      startTime: editStart,
      endTime: editEnd.trim(),
      location: editLocation.trim(),
      address: editAddress.trim(),
      description: editDesc.trim(),
    });
    setEditingInfo(false);
  }

  return (
    <div className="space-y-5">
      {/* 活動詳情與編輯 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">活動資料</h2>
          {!editingInfo ? (
            <button
              type="button"
              onClick={() => {
                setEditTitle(party.title);
                setEditStart(party.startTime);
                setEditEnd(party.endTime ?? '');
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

        {editingInfo ? (
          <form onSubmit={handleSaveInfo} className="mt-3 space-y-3">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="活動名稱"
            />
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
            {party.description || '暫未填寫備註，可按右上角「編輯」補充。'}
          </p>
        )}
      </section>

      {/* 快速報名 RSVP */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <UserPlus className="h-4 w-4 text-brand-600" />
          立即填名報名（RSVP）
        </h2>
        <form onSubmit={handleAddGuest} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的名字 / 稱呼"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="備註（例如：唔飲酒、8點半先到）"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {(['going', 'maybe', 'declined'] as RsvpStatus[]).map((s) => {
                const active = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
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

      {/* 參加者名單 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            參加者名單（{party.guests.length}）
          </h2>
          <div className="flex gap-2 text-xs font-medium">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700">
              出席 {goingCount}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700">
              未定 {maybeCount}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">
              缺席 {declinedCount}
            </span>
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          {party.guests.map((guest) => {
            const meta = STATUS_META[guest.status];
            const Icon = meta.icon;
            return (
              <div key={guest.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{guest.name}</p>
                  {guest.note ? (
                    <p className="truncate text-xs text-slate-500">{guest.note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    title="切換出席狀態"
                    onClick={() => {
                      const order: RsvpStatus[] = ['going', 'maybe', 'declined'];
                      const next = order[(order.indexOf(guest.status) + 1) % order.length];
                      handleChangeStatus(guest.id, next);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.color}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </button>
                  <button
                    type="button"
                    aria-label="移除參加者"
                    onClick={() => handleRemoveGuest(guest.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
