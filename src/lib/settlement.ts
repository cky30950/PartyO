import type {
  Expense,
  Guest,
  GuestBalance,
  Party,
  SettlementPayment,
  Transfer,
} from '../types/party';

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * 計算單筆開支中，每位參與者應分攤的金額（以仙為單位精確分配餘數，避免浮點誤差）
 */
export function calculateExpenseSplitsCents(expense: Expense): Record<string, number> {
  const totalCents = toCents(expense.amount);
  const participants = expense.participantIds;
  const result: Record<string, number> = {};

  if (participants.length === 0 || totalCents <= 0) {
    return result;
  }

  if (expense.splitType === 'exact' && expense.exactAmounts) {
    for (const id of participants) {
      result[id] = toCents(expense.exactAmounts[id] ?? 0);
    }
    return result;
  }

  if (expense.splitType === 'custom_shares' && expense.customShares) {
    const weights = participants.map((id) => Math.max(0, Number(expense.customShares?.[id] ?? 0)));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    if (totalWeight <= 0) {
      return result;
    }

    let allocated = 0;
    const remainders: { id: string; frac: number }[] = [];

    participants.forEach((id, idx) => {
      const exact = (totalCents * weights[idx]) / totalWeight;
      const floored = Math.floor(exact);
      result[id] = floored;
      allocated += floored;
      remainders.push({ id, frac: exact - floored });
    });

    let diff = totalCents - allocated;
    remainders.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < diff; i++) {
      result[remainders[i % remainders.length].id] += 1;
    }
    return result;
  }

  // Default: equal split
  const base = Math.floor(totalCents / participants.length);
  const remainder = totalCents - base * participants.length;
  participants.forEach((id, idx) => {
    result[id] = base + (idx < remainder ? 1 : 0);
  });
  return result;
}

export function calculateBalances(guests: Guest[], expenses: Expense[]): GuestBalance[] {
  const map = new Map<string, { name: string; paidCents: number; owedCents: number }>();

  for (const g of guests) {
    map.set(g.id, { name: g.name, paidCents: 0, owedCents: 0 });
  }

  for (const exp of expenses) {
    const totalCents = toCents(exp.amount);
    if (totalCents <= 0) continue;

    if (!map.has(exp.paidByGuestId)) {
      map.set(exp.paidByGuestId, { name: '未知成員', paidCents: 0, owedCents: 0 });
    }
    map.get(exp.paidByGuestId)!.paidCents += totalCents;

    const splits = calculateExpenseSplitsCents(exp);
    for (const [guestId, shareCents] of Object.entries(splits)) {
      if (!map.has(guestId)) {
        map.set(guestId, { name: '未知成員', paidCents: 0, owedCents: 0 });
      }
      map.get(guestId)!.owedCents += shareCents;
    }
  }

  return Array.from(map.entries()).map(([guestId, data]) => ({
    guestId,
    guestName: data.name,
    paid: fromCents(data.paidCents),
    owed: fromCents(data.owedCents),
    net: fromCents(data.paidCents - data.owedCents),
  }));
}

/**
 * 貪婪最少轉帳次數演算法：每次將欠最多錢的人配對給應收最多錢的人
 */
export function calculateMinTransfers(balances: GuestBalance[]): Transfer[] {
  const debtors = balances
    .filter((b) => toCents(b.net) < 0)
    .map((b) => ({ id: b.guestId, name: b.guestName, cents: -toCents(b.net) }));

  const creditors = balances
    .filter((b) => toCents(b.net) > 0)
    .map((b) => ({ id: b.guestId, name: b.guestName, cents: toCents(b.net) }));

  const transfers: Transfer[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort((a, b) => b.cents - a.cents);
    creditors.sort((a, b) => b.cents - a.cents);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const transferCents = Math.min(debtor.cents, creditor.cents);

    if (transferCents > 0) {
      transfers.push({
        key: `${debtor.id}__${creditor.id}`,
        fromGuestId: debtor.id,
        fromName: debtor.name,
        toGuestId: creditor.id,
        toName: creditor.name,
        amount: fromCents(transferCents),
      });
    }

    debtor.cents -= transferCents;
    creditor.cents -= transferCents;

    if (debtor.cents === 0) debtors.shift();
    if (creditor.cents === 0) creditors.shift();
  }

  return transfers;
}

export function formatMoney(amount: number, currency = 'HK$'): string {
  const formatted = Number.isInteger(amount)
    ? amount.toLocaleString('en-HK')
    : amount.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency}${formatted}`;
}

export function buildWhatsAppSettlementText(
  party: Party,
  transfers: Transfer[],
  payments: Record<string, SettlementPayment>
): string {
  const total = party.expenses.reduce((sum, e) => sum + e.amount, 0);
  const lines: string[] = [
    `💰 *${party.title} — AA 結算清單*`,
    `總開支：${formatMoney(total, party.currency)}（共 ${party.expenses.length} 筆）`,
    '',
  ];

  if (transfers.length === 0) {
    lines.push('✅ 所有人已經計清，無需轉帳！');
  } else {
    lines.push('📋 *最少轉帳方案*：');
    for (const t of transfers) {
      const status = payments[t.key];
      const badge = status?.paid
        ? `✅ 已付${status.method ? ` (${status.method})` : ''}`
        : '⏳ 待付';
      lines.push(`• ${t.fromName} ➔ ${t.toName}：*${formatMoney(t.amount, party.currency)}* [${badge}]`);
    }
  }

  if (party.paymeLink || party.fpsInfo) {
    lines.push('');
    lines.push('💳 *收款資料*：');
    if (party.paymeLink) lines.push(`PayMe：${party.paymeLink}`);
    if (party.fpsInfo) lines.push(`轉數快 FPS：${party.fpsInfo}`);
  }

  return lines.join('\n');
}
