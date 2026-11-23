import { useMemo, useState, type FormEvent } from 'react';
import {
  Plus,
  Trash2,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Wallet,
  CreditCard,
} from 'lucide-react';
import type {
  Expense,
  ExpenseCategory,
  Party,
  PaymentMethod,
  SplitType,
} from '../types/party';
import { generateId, getAllGuests } from '../lib/partyStore';
import {
  buildWhatsAppSettlementText,
  calculateBalances,
  calculateMinTransfers,
  formatMoney,
} from '../lib/settlement';

interface ExpensesTabProps {
  party: Party;
  isAdmin: boolean;
  onUpdateParty: (updated: Party) => Promise<void>;
}

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  venue: '場地',
  food: '食物',
  drinks: '酒水',
  transport: '交通',
  supplies: '物資',
  other: '其他',
};

const SPLIT_LABELS: Record<SplitType, string> = {
  equal: '平均分攤',
  custom_shares: '按份數比例',
  exact: '自訂金額',
};

export function ExpensesTab({ party, isAdmin, onUpdateParty }: ExpensesTabProps) {
  const allGuests = useMemo(() => getAllGuests(party), [party]);
  const activeGuests = useMemo(
    () => allGuests.filter((g) => g.status !== 'declined'),
    [allGuests]
  );

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('food');
  const [paidBy, setPaidBy] = useState(allGuests[0]?.id ?? '');
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    activeGuests.map((g) => g.id)
  );
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState('');

  const [paymeLink, setPaymeLink] = useState(party.paymeLink ?? '');
  const [fpsInfo, setFpsInfo] = useState(party.fpsInfo ?? '');
  const [savedPayInfo, setSavedPayInfo] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  const totalSpent = useMemo(
    () => party.expenses.reduce((sum, e) => sum + e.amount, 0),
    [party.expenses]
  );

  const balances = useMemo(
    () => calculateBalances(allGuests, party.expenses),
    [allGuests, party.expenses]
  );

  const transfers = useMemo(() => calculateMinTransfers(balances), [balances]);

  const paidTransferCount = transfers.filter(
    (t) => party.settlementPayments[t.key]?.paid
  ).length;

  function toggleParticipant(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleAddExpense(e: FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    const numAmount = Number(amount);
    const payerId = paidBy || allGuests[0]?.id;

    if (!title.trim()) {
      setErrorMsg('請輸入開支項目名稱');
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setErrorMsg('請輸入大於 0 的有效金額');
      return;
    }
    if (!payerId) {
      setErrorMsg('請先在「活動與報名」新增至少一位參加者');
      return;
    }
    if (selectedIds.length === 0) {
      setErrorMsg('請至少選擇一位分攤成員');
      return;
    }

    let parsedShares: Record<string, number> | undefined;
    let parsedExact: Record<string, number> | undefined;

    if (splitType === 'custom_shares') {
      parsedShares = {};
      let sumShares = 0;
      for (const id of selectedIds) {
        const val = Number(customShares[id] ?? '1');
        if (!Number.isFinite(val) || val < 0) {
          setErrorMsg('份數比例必須為 0 或以上數字');
          return;
        }
        parsedShares[id] = val;
        sumShares += val;
      }
      if (sumShares <= 0) {
        setErrorMsg('總份數必須大於 0');
        return;
      }
    }

    if (splitType === 'exact') {
      parsedExact = {};
      let sumExact = 0;
      for (const id of selectedIds) {
        const val = Number(exactAmounts[id] ?? '0');
        if (!Number.isFinite(val) || val < 0) {
          setErrorMsg('自訂金額必須為 0 或以上數字');
          return;
        }
        parsedExact[id] = val;
        sumExact += val;
      }
      if (Math.abs(sumExact - numAmount) > 0.02) {
        setErrorMsg(
          `自訂金額總和（${formatMoney(sumExact, party.currency)}）需等於總額（${formatMoney(numAmount, party.currency)}）`
        );
        return;
      }
    }

    const newExpense: Expense = {
      id: generateId('exp'),
      title: title.trim(),
      amount: Math.round(numAmount * 100) / 100,
      paidByGuestId: payerId,
      splitType,
      participantIds: selectedIds,
      customShares: parsedShares,
      exactAmounts: parsedExact,
      category,
      createdAt: new Date().toISOString(),
    };

    await onUpdateParty({
      ...party,
      expenses: [newExpense, ...party.expenses],
    });

    setTitle('');
    setAmount('');
    setCustomShares({});
    setExactAmounts({});
  }

  async function handleDeleteExpense(expenseId: string) {
    await onUpdateParty({
      ...party,
      expenses: party.expenses.filter((e) => e.id !== expenseId),
    });
  }

  async function handleMarkPayment(transferKey: string, method?: PaymentMethod) {
    const current = party.settlementPayments[transferKey];
    const nextPayments = { ...party.settlementPayments };

    if (!method) {
      nextPayments[transferKey] = {
        key: transferKey,
        paid: false,
      };
    } else if (current?.paid && current.method === method) {
      nextPayments[transferKey] = {
        key: transferKey,
        paid: false,
      };
    } else {
      nextPayments[transferKey] = {
        key: transferKey,
        paid: true,
        method,
        paidAt: new Date().toISOString(),
      };
    }

    await onUpdateParty({
      ...party,
      settlementPayments: nextPayments,
    });
  }

  async function handleSavePayInfo(e: FormEvent) {
    e.preventDefault();
    await onUpdateParty({
      ...party,
      paymeLink: paymeLink.trim(),
      fpsInfo: fpsInfo.trim(),
    });
    setSavedPayInfo(true);
    setTimeout(() => setSavedPayInfo(false), 2000);
  }

  async function handleCopySummary() {
    const text = buildWhatsAppSettlementText(party, transfers, party.settlementPayments);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  const guestNameById = (id: string) =>
    allGuests.find((g) => g.id === id)?.name ?? '未知成員';

  return (
    <div className="space-y-5">
      {/* 總覽指標 */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200/80">
          <p className="text-[11px] font-medium text-slate-500">活動總開支</p>
          <p className="mt-1 text-base font-bold text-slate-900">
            {formatMoney(totalSpent, party.currency)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200/80">
          <p className="text-[11px] font-medium text-slate-500">最少轉帳筆數</p>
          <p className="mt-1 text-base font-bold text-brand-600">{transfers.length} 筆</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200/80">
          <p className="text-[11px] font-medium text-slate-500">收款進度</p>
          <p className="mt-1 text-base font-bold text-emerald-600">
            {paidTransferCount}/{transfers.length} 已付
          </p>
        </div>
      </div>

      {/* 最少轉帳結算方案 + 收款追蹤 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Wallet className="h-4 w-4 text-brand-600" />
            最少轉帳結算與收款追蹤
          </h2>
          {isAdmin ? (
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              {copiedSummary ? (
                <>
                  <Check className="h-3.5 w-3.5" /> 已複製 WhatsApp 結算
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> 複製 WhatsApp 結算
                </>
              )}
            </button>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
              僅供檢視
            </span>
          )}
        </div>

        {transfers.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-center text-xs text-slate-500">
            暫時未有待結算轉帳。新增開支後會自動計算最少轉帳方案。
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {transfers.map((t) => {
              const payment = party.settlementPayments[t.key];
              const isPaid = Boolean(payment?.paid);
              return (
                <div
                  key={t.key}
                  className={`rounded-2xl p-3.5 ring-1 transition ${
                    isPaid
                      ? 'bg-emerald-50/60 ring-emerald-200'
                      : 'bg-slate-50/80 ring-slate-200/80'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <span>{t.fromName}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                      <span>{t.toName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-brand-600">
                        {formatMoney(t.amount, party.currency)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          isPaid
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {isPaid ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            已付 ({payment?.method ?? '已確認'})
                          </>
                        ) : (
                          <>
                            <Clock className="h-3 w-3" /> 待付
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(['PayMe', 'FPS', 'Cash'] as PaymentMethod[]).map((m) => {
                        const active = isPaid && payment?.method === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleMarkPayment(t.key, m)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ring-1 ${
                              active
                                ? 'bg-emerald-600 text-white ring-emerald-600'
                                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {m === 'FPS' ? '轉數快 FPS 已付' : m === 'Cash' ? '現金已付' : 'PayMe 已付'}
                          </button>
                        );
                      })}
                      {isPaid ? (
                        <button
                          type="button"
                          onClick={() => handleMarkPayment(t.key)}
                          className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-white"
                        >
                          重設未付
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* 各成員淨額概覽 */}
        {balances.length > 0 && party.expenses.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold text-slate-500">每人墊付與應分攤明細</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {balances.map((b) => (
                <div
                  key={b.guestId}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
                >
                  <span className="truncate font-medium text-slate-800">{b.guestName}</span>
                  <span className="shrink-0 text-slate-500">
                    墊 {formatMoney(b.paid, party.currency)} · 佔 {formatMoney(b.owed, party.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 新增開支表單（僅限主辦人） */}
      {isAdmin ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Plus className="h-4 w-4 text-brand-600" />
          新增一筆開支
        </h2>

        <form onSubmit={handleAddExpense} className="mt-3 space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="項目名稱（例如：手工啤酒、Party Room 訂金）"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`金額 (${party.currency})`}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-700"
              >
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600">誰先墊付？</label>
              <select
                value={paidBy || allGuests[0]?.id || ''}
                onChange={(e) => setPaidBy(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {allGuests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600">分攤方式</label>
              <div className="mt-1 flex gap-1.5">
                {(['equal', 'custom_shares', 'exact'] as SplitType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSplitType(t)}
                    className={`flex-1 rounded-xl px-2 py-2 text-xs font-semibold transition ring-1 ${
                      splitType === t
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {SPLIT_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 選擇分攤成員（支援剔除不飲酒／遲到者） */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600">
                分攤成員（可剔除唔飲酒／遲到人士）
              </label>
              <button
                type="button"
                onClick={() => setSelectedIds(allGuests.map((g) => g.id))}
                className="text-[11px] font-semibold text-brand-600 hover:underline"
              >
                全選
              </button>
            </div>

            <div className="mt-2 space-y-1.5">
              {allGuests.map((g) => {
                const checked = selectedIds.includes(g.id);
                return (
                  <div
                    key={g.id}
                    className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ring-1 transition ${
                      checked
                        ? 'bg-rose-50/50 ring-brand-200'
                        : 'bg-slate-50 text-slate-400 ring-slate-200/70'
                    }`}
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleParticipant(g.id)}
                        className="h-4 w-4 accent-brand-600"
                      />
                      <span className="font-medium text-slate-800">{g.name}</span>
                      {g.note ? (
                        <span className="truncate text-[11px] text-slate-400">({g.note})</span>
                      ) : null}
                    </label>

                    {checked && splitType === 'custom_shares' && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={customShares[g.id] ?? '1'}
                          onChange={(e) =>
                            setCustomShares((prev) => ({ ...prev, [g.id]: e.target.value }))
                          }
                          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-xs text-slate-900"
                        />
                        <span className="text-[11px] text-slate-500">份</span>
                      </div>
                    )}

                    {checked && splitType === 'exact' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-slate-500">{party.currency}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={exactAmounts[g.id] ?? ''}
                          onChange={(e) =>
                            setExactAmounts((prev) => ({ ...prev, [g.id]: e.target.value }))
                          }
                          placeholder="0"
                          className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-xs text-slate-900"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {errorMsg ? <p className="text-xs font-medium text-rose-600">{errorMsg}</p> : null}

          <button
            type="submit"
            className="w-full rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            新增開支並即時更新結算
          </button>
        </form>
      </section>
      ) : null}

      {/* 開支明細列表 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <h2 className="text-sm font-bold text-slate-900">
          開支紀錄（{party.expenses.length}）
        </h2>
        {party.expenses.length === 0 ? (
          <p className="mt-3 text-center text-xs text-slate-400">暫未有開支紀錄</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {party.expenses.map((exp) => (
              <div key={exp.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      {CATEGORY_LABELS[exp.category]}
                    </span>
                    <p className="truncate text-sm font-semibold text-slate-900">{exp.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {guestNameById(exp.paidByGuestId)} 墊付 · {SPLIT_LABELS[exp.splitType]}（
                    {exp.participantIds.length} 人分攤）
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    {formatMoney(exp.amount, party.currency)}
                  </span>
                  {isAdmin ? (
                    <button
                      type="button"
                      aria-label="刪除開支"
                      onClick={() => handleDeleteExpense(exp.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* PayMe / 轉數快收款資料 */}
      {isAdmin ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <CreditCard className="h-4 w-4 text-brand-600" />
            PayMe / 轉數快收款資料（會自動附在結算訊息）
          </h2>
          <form onSubmit={handleSavePayInfo} className="mt-3 space-y-2.5">
            <input
              type="url"
              value={paymeLink}
              onChange={(e) => setPaymeLink(e.target.value)}
              placeholder="PayMe 連結（例如：https://payme.hsbc/...）"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs outline-none focus:border-brand-500"
            />
            <input
              type="text"
              value={fpsInfo}
              onChange={(e) => setFpsInfo(e.target.value)}
              placeholder="轉數快 FPS ID / 備註"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs outline-none focus:border-brand-500"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                {savedPayInfo ? '已儲存 ✓' : '儲存收款資料'}
              </button>
            </div>
          </form>
        </section>
      ) : party.paymeLink || party.fpsInfo ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <CreditCard className="h-4 w-4 text-brand-600" />
            主辦人收款資料
          </h2>
          <div className="mt-2.5 space-y-1.5 text-xs text-slate-600">
            {party.paymeLink ? (
              <p>
                PayMe：{' '}
                <a
                  href={party.paymeLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
                >
                  {party.paymeLink}
                </a>
              </p>
            ) : null}
            {party.fpsInfo ? <p>轉數快 FPS：{party.fpsInfo}</p> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
