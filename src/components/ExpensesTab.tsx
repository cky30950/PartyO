import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Wallet,
  CreditCard,
  ExternalLink,
  Edit3,
  Upload,
  X,
  QrCode,
  Download,
  Share2,
  Sparkles,
  Receipt,
  Camera,
} from 'lucide-react';
import type {
  AppTheme,
  Expense,
  ExpenseCategory,
  HostPaymentProfile,
  Party,
  PaymentMethod,
  SplitType,
} from '../types/party';
import { generateId, getAllGuests, isHostGuest } from '../lib/partyStore';
import {
  buildFpsHkqrPayload,
  compressQrImageFile,
} from '../lib/paymentQr';
import { fireConfetti } from '../lib/celebrate';
import { shareImageDataUrl } from '../lib/webShare';
import { buildDownloadUrl, scanReceiptWithGemini } from '../lib/mediaApi';
import {
  buildWhatsAppSettlementText,
  calculateBalances,
  calculateMinTransfers,
  formatMoney,
  getTransferPaymentStatus,
  sumExpensesTotal,
  toCents,
} from '../lib/settlement';

interface ExpensesTabProps {
  party: Party;
  isAdmin: boolean;
  currentUser: User | null;
  shareUrl: string;
  appTheme: AppTheme;
  mediaApiBase: string;
  hostPaymentProfile: HostPaymentProfile | null;
  onUpdateParty: (updated: Party) => Promise<void>;
  onSaveHostPaymentProfile: (profile: HostPaymentProfile) => Promise<void>;
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

type ActiveQrModal = 'payme' | 'fps' | 'fps-personal' | null;
type PersonalSettleStep = 'idle' | 'choose' | 'payme' | 'fps';

export function ExpensesTab({
  party,
  isAdmin,
  currentUser,
  mediaApiBase,
  hostPaymentProfile,
  onUpdateParty,
  onSaveHostPaymentProfile,
}: ExpensesTabProps) {
  const allGuests = useMemo(() => getAllGuests(party), [party]);
  const activeGuests = useMemo(
    () => allGuests.filter((g) => g.status !== 'declined'),
    [allGuests]
  );

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('food');
  const [paidBy, setPaidBy] = useState(allGuests[0]?.id ?? '');
  const [assignSplitNow, setAssignSplitNow] = useState(false);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    activeGuests.map((g) => g.id)
  );
  const knownGuestIdsRef = useRef<Set<string>>(new Set(allGuests.map((g) => g.id)));
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptKey, setReceiptKey] = useState('');
  const [receiptSummary, setReceiptSummary] = useState('');
  const [viewingReceipt, setViewingReceipt] = useState<{
    title: string;
    url: string;
    summary?: string;
  } | null>(null);

  // 事後設定／編輯單筆開支的分攤成員
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editSplitType, setEditSplitType] = useState<SplitType>('equal');
  const [editSelectedIds, setEditSelectedIds] = useState<string[]>([]);
  const [editCustomShares, setEditCustomShares] = useState<Record<string, string>>({});
  const [editExactAmounts, setEditExactAmounts] = useState<Record<string, string>>({});
  const [editErrorMsg, setEditErrorMsg] = useState('');

  // 同步參加者名單異動：自動移除已刪除成員，並自動勾選新加入的出席成員
  useEffect(() => {
    const validIds = new Set(allGuests.map((g) => g.id));
    const newlyAddedActiveIds = activeGuests
      .map((g) => g.id)
      .filter((id) => !knownGuestIdsRef.current.has(id));
    knownGuestIdsRef.current = validIds;

    setSelectedIds((prev) => {
      const cleaned = prev.filter((id) => validIds.has(id));
      return Array.from(new Set([...cleaned, ...newlyAddedActiveIds]));
    });
    if (paidBy && !validIds.has(paidBy)) {
      setPaidBy(allGuests[0]?.id ?? '');
    }
  }, [allGuests, activeGuests, paidBy]);

  // 收款資料與二維碼
  const hasPayme = Boolean(party.paymeLink?.trim() || party.paymeQrImage);
  const hasFps = Boolean(party.fpsInfo?.trim() || party.fpsQrImage);
  const hasAnyPayInfo = hasPayme || hasFps;
  const hasCloudDefaultPayment = Boolean(
    hostPaymentProfile?.paymeLink?.trim() ||
      hostPaymentProfile?.paymeQrImage ||
      hostPaymentProfile?.fpsInfo?.trim() ||
      hostPaymentProfile?.fpsQrImage
  );

  const [editingPayInfo, setEditingPayInfo] = useState(false);
  const [paymeLink, setPaymeLink] = useState(party.paymeLink ?? '');
  const [paymeQrImage, setPaymeQrImage] = useState(party.paymeQrImage ?? '');
  const [fpsInfo, setFpsInfo] = useState(party.fpsInfo ?? '');
  const [fpsQrImage, setFpsQrImage] = useState(party.fpsQrImage ?? '');
  const [saveAsCloudDefault, setSaveAsCloudDefault] = useState(true);
  const [qrUploadError, setQrUploadError] = useState('');
  const [savedPayInfo, setSavedPayInfo] = useState(false);
  const [copiedFps, setCopiedFps] = useState(false);
  const [activeQrModal, setActiveQrModal] = useState<ActiveQrModal>(null);
  const [personalSettleStep, setPersonalSettleStep] = useState<PersonalSettleStep>('idle');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const modalQrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const paymeQrValue = party.paymeLink?.trim() ?? '';
  const fpsQrValue = useMemo(() => {
    if (!party.fpsInfo?.trim()) return '';
    return buildFpsHkqrPayload(party.fpsInfo.trim());
  }, [party.fpsInfo]);

  const totalSpent = useMemo(() => sumExpensesTotal(party.expenses), [party.expenses]);
  const unassignedExpenses = useMemo(
    () => party.expenses.filter((e) => e.participantIds.length === 0),
    [party.expenses]
  );
  const unassignedTotal = useMemo(
    () => sumExpensesTotal(unassignedExpenses),
    [unassignedExpenses]
  );

  const balances = useMemo(
    () => calculateBalances(allGuests, party.expenses),
    [allGuests, party.expenses]
  );

  const transfers = useMemo(() => calculateMinTransfers(balances), [balances]);

  const paidTransferCount = transfers.filter(
    (t) => getTransferPaymentStatus(t, party.settlementPayments[t.key]).state === 'paid'
  ).length;

  // 依據目前登入帳號配對參加者，找出該用戶與主辦人（及其他成員）的專屬轉帳明細
  const myGuest = useMemo(() => {
    if (!currentUser) return null;
    const emailLower = currentUser.email?.trim().toLowerCase();
    return (
      allGuests.find(
        (g) =>
          g.uid === currentUser.uid ||
          g.id === currentUser.uid ||
          (emailLower && g.email?.trim().toLowerCase() === emailLower)
      ) ?? null
    );
  }, [allGuests, currentUser]);

  const myPersonalSettlement = useMemo(() => {
    if (!myGuest) return null;
    const guestMap = new Map(allGuests.map((g) => [g.id, g]));
    const outgoing = transfers
      .filter((t) => t.fromGuestId === myGuest.id)
      .map((t) => {
        const status = getTransferPaymentStatus(t, party.settlementPayments[t.key]);
        const target = guestMap.get(t.toGuestId);
        return {
          transfer: t,
          status,
          toIsHost: Boolean(target && isHostGuest(target)),
        };
      });
    const incoming = transfers
      .filter((t) => t.toGuestId === myGuest.id)
      .map((t) => ({
        transfer: t,
        status: getTransferPaymentStatus(t, party.settlementPayments[t.key]),
      }));

    const unpaidHostTransfer =
      outgoing.find((item) => item.toIsHost && item.status.remainingAmount > 0) ?? null;
    const unpaidOtherOutgoing = outgoing.filter(
      (item) => !item.toIsHost && item.status.remainingAmount > 0
    );
    const unpaidIncoming = incoming.filter((item) => item.status.remainingAmount > 0);
    return {
      outgoing,
      incoming,
      unpaidHostTransfer,
      unpaidOtherOutgoing,
      unpaidIncoming,
    };
  }, [myGuest, allGuests, transfers, party.settlementPayments]);

  const personalDueAmount = myPersonalSettlement?.unpaidHostTransfer?.status.remainingAmount ?? 0;
  const personalDuePlainText = useMemo(() => {
    if (personalDueAmount <= 0) return '';
    return Number.isInteger(personalDueAmount)
      ? String(personalDueAmount)
      : personalDueAmount.toFixed(2);
  }, [personalDueAmount]);

  const personalFpsQrValue = useMemo(() => {
    if (personalDueAmount <= 0 || !party.fpsInfo?.trim()) return '';
    return buildFpsHkqrPayload(party.fpsInfo.trim(), personalDueAmount);
  }, [party.fpsInfo, personalDueAmount]);

  useEffect(() => {
    setPersonalSettleStep('idle');
  }, [party.id, personalDueAmount]);

  function toggleParticipant(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleQrImageUpload(
    e: ChangeEvent<HTMLInputElement>,
    target: 'payme' | 'fps'
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setQrUploadError('');
    try {
      const dataUrl = await compressQrImageFile(file);
      if (target === 'payme') {
        setPaymeQrImage(dataUrl);
      } else {
        setFpsQrImage(dataUrl);
      }
    } catch (err) {
      setQrUploadError(err instanceof Error ? err.message : '圖片處理失敗');
    } finally {
      e.target.value = '';
    }
  }

  async function handleCopyFps() {
    if (!party.fpsInfo?.trim()) return;
    try {
      await navigator.clipboard.writeText(party.fpsInfo.trim());
      setCopiedFps(true);
      toast.success('已複製轉數快號碼');
      setTimeout(() => setCopiedFps(false), 2000);
    } catch {
      toast.error('複製失敗，請手動複製');
    }
  }

  async function handleOpenPaymeWithAmount() {
    if (!party.paymeLink) return;
    if (personalDuePlainText) {
      try {
        await navigator.clipboard.writeText(personalDuePlainText);
        toast.success(`已複製金額 ${personalDuePlainText}，進入 PayMe 貼上即可付款`);
      } catch {
        toast.info(`請於 PayMe 輸入金額 ${personalDuePlainText}`);
      }
    }
    window.open(party.paymeLink, '_blank', 'noopener,noreferrer');
  }

  function getModalQrImagePayload(type: 'payme' | 'fps' | 'fps-personal'): {
    dataUrl: string;
    fileName: string;
  } | null {
    const customImg =
      type === 'payme'
        ? party.paymeQrImage
        : type === 'fps'
          ? party.fpsQrImage
          : '';
    let dataUrl = customImg || '';
    if (!dataUrl && modalQrCanvasRef.current) {
      dataUrl = modalQrCanvasRef.current.toDataURL('image/png');
    }
    if (!dataUrl) return null;
    const fileName =
      type === 'fps-personal'
        ? `fps_${personalDuePlainText || 'pay'}_qr.png`
        : `${type === 'payme' ? 'payme' : 'fps'}_qr.png`;
    return { dataUrl, fileName };
  }

  function handleDownloadModalQr(type: 'payme' | 'fps' | 'fps-personal') {
    const payload = getModalQrImagePayload(type);
    if (!payload) return;
    const link = document.createElement('a');
    link.href = payload.dataUrl;
    link.download = payload.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('已儲存二維碼圖片');
  }

  async function handleShareModalQr(type: 'payme' | 'fps' | 'fps-personal') {
    const payload = getModalQrImagePayload(type);
    if (!payload) return;
    const title =
      type === 'fps-personal'
        ? `${party.title} 轉數快付款碼（${formatMoney(personalDueAmount, party.currency)}）`
        : type === 'payme'
          ? `${party.title} PayMe 收款碼`
          : `${party.title} 轉數快收款碼`;
    const outcome = await shareImageDataUrl({
      dataUrl: payload.dataUrl,
      fileName: payload.fileName,
      title,
    });
    if (outcome === 'shared') {
      toast.success('已開啟系統分享');
      return;
    }
    if (outcome === 'cancelled') return;
    handleDownloadModalQr(type);
  }

  async function handleScanReceipt(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!currentUser || !isAdmin) {
      toast.error('只有主辦人可使用 AI 掃單功能');
      return;
    }
    if (!mediaApiBase) {
      toast.error('請先到「原圖相簿」分頁設定伺服器網址');
      return;
    }

    setScanningReceipt(true);
    setErrorMsg('');
    try {
      const result = await scanReceiptWithGemini({
        apiBase: mediaApiBase,
        partyId: party.id,
        file,
        user: currentUser,
      });
      setReceiptUrl(result.receiptUrl);
      setReceiptKey(result.receiptKey);
      setReceiptSummary(result.ocr.summary || '');
      if (result.ocr.title) setTitle(result.ocr.title);
      if (result.ocr.amount > 0) setAmount(String(result.ocr.amount));
      if (result.ocr.category) setCategory(result.ocr.category);
      toast.success('已完成 AI 掃單並保存原版單據，請核對資料後儲存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '掃單失敗';
      setErrorMsg(`掃單失敗：${msg}`);
      toast.error(`掃單失敗：${msg}`);
    } finally {
      setScanningReceipt(false);
    }
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

    const totalCents = toCents(numAmount);
    let cleanSelectedIds: string[] = [];
    let parsedShares: Record<string, number> | undefined;
    let parsedExact: Record<string, number> | undefined;

    if (assignSplitNow) {
      const validGuestIds = new Set(allGuests.map((g) => g.id));
      cleanSelectedIds = Array.from(new Set(selectedIds.filter((id) => validGuestIds.has(id))));
      if (cleanSelectedIds.length === 0) {
        setErrorMsg('請至少選擇一位分攤成員，或改選「先記帳（稍後再分攤）」');
        return;
      }

      if (splitType === 'custom_shares') {
        parsedShares = {};
        let sumShares = 0;
        for (const id of cleanSelectedIds) {
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
        let sumExactCents = 0;
        for (const id of cleanSelectedIds) {
          const val = Number(exactAmounts[id] ?? '0');
          if (!Number.isFinite(val) || val < 0) {
            setErrorMsg('自訂金額必須為 0 或以上數字');
            return;
          }
          const valCents = toCents(val);
          parsedExact[id] = valCents / 100;
          sumExactCents += valCents;
        }
        if (sumExactCents !== totalCents) {
          setErrorMsg(
            `自訂金額總和（${formatMoney(sumExactCents / 100, party.currency)}）必須完全等於總額（${formatMoney(totalCents / 100, party.currency)}）`
          );
          return;
        }
      }
    }

    const newExpense: Expense = {
      id: generateId('exp'),
      title: title.trim(),
      amount: totalCents / 100,
      paidByGuestId: payerId,
      splitType: assignSplitNow ? splitType : 'equal',
      participantIds: cleanSelectedIds,
      ...(parsedShares ? { customShares: parsedShares } : {}),
      ...(parsedExact ? { exactAmounts: parsedExact } : {}),
      ...(receiptUrl ? { receiptUrl } : {}),
      ...(receiptKey ? { receiptKey } : {}),
      ...(receiptSummary ? { receiptSummary } : {}),
      category,
      createdAt: new Date().toISOString(),
    };

    try {
      await onUpdateParty({
        ...party,
        expenses: [newExpense, ...party.expenses],
      });
      setTitle('');
      setAmount('');
      setCustomShares({});
      setExactAmounts({});
      setReceiptUrl('');
      setReceiptKey('');
      setReceiptSummary('');
      toast.success(
        assignSplitNow
          ? `已新增開支「${newExpense.title}」`
          : `已記帳「${newExpense.title}」（稍後可隨時設定分攤成員）`
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法寫入雲端';
      setErrorMsg(`儲存開支失敗：${detail}`);
      toast.error(`儲存開支失敗：${detail}`);
    }
  }

  function openSplitEditor(exp: Expense) {
    const validGuestIds = new Set(allGuests.map((g) => g.id));
    const existingValid = exp.participantIds.filter((id) => validGuestIds.has(id));
    setEditingExpenseId(exp.id);
    setEditSplitType(exp.splitType ?? 'equal');
    setEditSelectedIds(
      existingValid.length > 0 ? existingValid : activeGuests.map((g) => g.id)
    );
    const nextShares: Record<string, string> = {};
    if (exp.customShares) {
      for (const [k, v] of Object.entries(exp.customShares)) {
        nextShares[k] = String(v);
      }
    }
    setEditCustomShares(nextShares);
    const nextExact: Record<string, string> = {};
    if (exp.exactAmounts) {
      for (const [k, v] of Object.entries(exp.exactAmounts)) {
        nextExact[k] = String(v);
      }
    }
    setEditExactAmounts(nextExact);
    setEditErrorMsg('');
  }

  function toggleEditParticipant(id: string) {
    setEditSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSaveExpenseSplit(exp: Expense, clearSplit = false) {
    setEditErrorMsg('');
    const totalCents = toCents(exp.amount);
    let cleanIds: string[] = [];
    let parsedShares: Record<string, number> | undefined;
    let parsedExact: Record<string, number> | undefined;

    if (!clearSplit) {
      const validGuestIds = new Set(allGuests.map((g) => g.id));
      cleanIds = Array.from(new Set(editSelectedIds.filter((id) => validGuestIds.has(id))));
      if (cleanIds.length === 0) {
        setEditErrorMsg('請至少選擇一位分攤成員，或點「改回待分攤」');
        return;
      }

      if (editSplitType === 'custom_shares') {
        parsedShares = {};
        let sumShares = 0;
        for (const id of cleanIds) {
          const val = Number(editCustomShares[id] ?? '1');
          if (!Number.isFinite(val) || val < 0) {
            setEditErrorMsg('份數比例必須為 0 或以上數字');
            return;
          }
          parsedShares[id] = val;
          sumShares += val;
        }
        if (sumShares <= 0) {
          setEditErrorMsg('總份數必須大於 0');
          return;
        }
      }

      if (editSplitType === 'exact') {
        parsedExact = {};
        let sumExactCents = 0;
        for (const id of cleanIds) {
          const val = Number(editExactAmounts[id] ?? '0');
          if (!Number.isFinite(val) || val < 0) {
            setEditErrorMsg('自訂金額必須為 0 或以上數字');
            return;
          }
          const valCents = toCents(val);
          parsedExact[id] = valCents / 100;
          sumExactCents += valCents;
        }
        if (sumExactCents !== totalCents) {
          setEditErrorMsg(
            `自訂金額總和（${formatMoney(sumExactCents / 100, party.currency)}）必須完全等於總額（${formatMoney(totalCents / 100, party.currency)}）`
          );
          return;
        }
      }
    }

    const updatedExpenses = party.expenses.map((item) => {
      if (item.id !== exp.id) return item;
      const base: Expense = {
        id: item.id,
        title: item.title,
        amount: item.amount,
        paidByGuestId: item.paidByGuestId,
        splitType: clearSplit ? 'equal' : editSplitType,
        participantIds: cleanIds,
        category: item.category,
        createdAt: item.createdAt,
      };
      if (parsedShares) base.customShares = parsedShares;
      if (parsedExact) base.exactAmounts = parsedExact;
      if (item.receiptUrl) base.receiptUrl = item.receiptUrl;
      if (item.receiptKey) base.receiptKey = item.receiptKey;
      if (item.receiptSummary) base.receiptSummary = item.receiptSummary;
      return base;
    });

    try {
      await onUpdateParty({
        ...party,
        expenses: updatedExpenses,
      });
      setEditingExpenseId(null);
      toast.success(
        clearSplit
          ? `已將「${exp.title}」改回待分攤`
          : `已更新「${exp.title}」的分攤設定`
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法寫入雲端';
      setEditErrorMsg(`更新分攤失敗：${detail}`);
      toast.error(`更新分攤失敗：${detail}`);
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    setErrorMsg('');
    try {
      await onUpdateParty({
        ...party,
        expenses: party.expenses.filter((e) => e.id !== expenseId),
      });
      toast.success('已刪除開支');
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法寫入雲端';
      setErrorMsg(`刪除開支失敗：${detail}`);
      toast.error(`刪除開支失敗：${detail}`);
    }
  }

  async function handleMarkPayment(
    transferKey: string,
    transferAmount: number,
    method?: PaymentMethod
  ) {
    const current = party.settlementPayments[transferKey];
    const currentStatus = getTransferPaymentStatus({ amount: transferAmount }, current);
    const nextPayments = { ...party.settlementPayments };

    if (!method) {
      nextPayments[transferKey] = {
        key: transferKey,
        paid: false,
        paidAmount: 0,
      };
    } else if (currentStatus.state === 'paid' && current?.method === method) {
      nextPayments[transferKey] = {
        key: transferKey,
        paid: false,
        paidAmount: 0,
      };
    } else {
      nextPayments[transferKey] = {
        key: transferKey,
        paid: true,
        paidAmount: transferAmount,
        method,
        paidAt: new Date().toISOString(),
      };
    }

    setErrorMsg('');
    try {
      await onUpdateParty({
        ...party,
        settlementPayments: nextPayments,
      });
      const allSettledNow =
        transfers.length > 0 &&
        transfers.every((t) => getTransferPaymentStatus(t, nextPayments[t.key]).state === 'paid');
      if (nextPayments[transferKey].paid && allSettledNow) {
        fireConfetti('settled');
        toast.success('全員費用已全部結清！');
      } else {
        toast.success(nextPayments[transferKey].paid ? '已標記收款完成' : '已重設為待付');
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法寫入雲端';
      setErrorMsg(`更新收款狀態失敗：${detail}`);
      toast.error(`更新收款狀態失敗：${detail}`);
    }
  }

  async function handleSavePayInfo(e: FormEvent) {
    e.preventDefault();
    setQrUploadError('');
    const nextPay: HostPaymentProfile = {
      paymeLink: paymeLink.trim(),
      paymeQrImage,
      fpsInfo: fpsInfo.trim(),
      fpsQrImage,
    };
    try {
      await onUpdateParty({
        ...party,
        ...nextPay,
      });
      if (saveAsCloudDefault) {
        await onSaveHostPaymentProfile(nextPay);
      }
      setSavedPayInfo(true);
      setEditingPayInfo(false);
      toast.success(saveAsCloudDefault ? '收款資料已儲存並設為雲端預設' : '收款資料已更新');
      setTimeout(() => setSavedPayInfo(false), 2000);
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法寫入雲端';
      setQrUploadError(`儲存收款資料失敗：${detail}`);
      toast.error(`儲存收款資料失敗：${detail}`);
    }
  }

  async function handleApplyCloudDefaultPayment() {
    if (!hostPaymentProfile) return;
    setQrUploadError('');
    try {
      await onUpdateParty({
        ...party,
        paymeLink: hostPaymentProfile.paymeLink ?? '',
        paymeQrImage: hostPaymentProfile.paymeQrImage ?? '',
        fpsInfo: hostPaymentProfile.fpsInfo ?? '',
        fpsQrImage: hostPaymentProfile.fpsQrImage ?? '',
      });
      setPaymeLink(hostPaymentProfile.paymeLink ?? '');
      setPaymeQrImage(hostPaymentProfile.paymeQrImage ?? '');
      setFpsInfo(hostPaymentProfile.fpsInfo ?? '');
      setFpsQrImage(hostPaymentProfile.fpsQrImage ?? '');
      setSavedPayInfo(true);
      setEditingPayInfo(false);
      toast.success('已套用雲端預設收款資料');
      setTimeout(() => setSavedPayInfo(false), 2000);
    } catch (err) {
      const detail = err instanceof Error ? err.message : '無法寫入雲端';
      setQrUploadError(`套用預設收款資料失敗：${detail}`);
      toast.error(`套用預設收款資料失敗：${detail}`);
    }
  }

  async function handleCopySummary() {
    const text = buildWhatsAppSettlementText(party, transfers, party.settlementPayments);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      toast.success('已複製 WhatsApp 費用結算明細');
      setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      toast.error('複製失敗，請手動複製');
    }
  }

  const guestNameById = (id: string) =>
    allGuests.find((g) => g.id === id)?.name ?? '未知成員';

  return (
    <div className="space-y-5">
      {/* 已登入參加者的個人專屬結算與指定金額付款卡 */}
      {!isAdmin && myGuest && myPersonalSettlement && party.expenses.length > 0 ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-2 ring-brand-300/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Wallet className="h-4 w-4 text-brand-600" />
              你的專屬結算（{myGuest.name}）
            </h2>
            {personalDueAmount > 0 ? (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">
                待付 {formatMoney(personalDueAmount, party.currency)}
              </span>
            ) : myPersonalSettlement.unpaidOtherOutgoing.length === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> 已結清
              </span>
            ) : null}
          </div>

          {myPersonalSettlement.unpaidHostTransfer ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-rose-50/70 px-4 py-3 ring-1 ring-rose-200/80">
                <div>
                  <p className="text-xs font-semibold text-slate-600">
                    你需轉帳給 {myPersonalSettlement.unpaidHostTransfer.transfer.toName}
                  </p>
                  <p className="mt-0.5 text-xl font-extrabold text-brand-600">
                    {formatMoney(personalDueAmount, party.currency)}
                  </p>
                  {myPersonalSettlement.unpaidHostTransfer.status.state === 'partial' ? (
                    <p className="mt-0.5 text-[11px] text-amber-800">
                      原應付{' '}
                      {formatMoney(
                        myPersonalSettlement.unpaidHostTransfer.transfer.amount,
                        party.currency
                      )}
                      ，已付{' '}
                      {formatMoney(
                        myPersonalSettlement.unpaidHostTransfer.status.paidAmount,
                        party.currency
                      )}
                    </p>
                  ) : null}
                </div>
              </div>

              {hasPayme || hasFps ? (
                personalSettleStep === 'idle' ? (
                  <button
                    type="button"
                    onClick={() => setPersonalSettleStep('choose')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
                  >
                    <Wallet className="h-4 w-4" />
                    轉帳結算
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : personalSettleStep === 'choose' ? (
                  <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3.5 ring-1 ring-slate-200/80">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">
                        步驟 1/2 · 選擇轉帳方式
                      </span>
                      <button
                        type="button"
                        onClick={() => setPersonalSettleStep('idle')}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-200/70"
                      >
                        收起
                      </button>
                    </div>
                    <div
                      className={`grid gap-2.5 ${hasPayme && hasFps ? 'grid-cols-2' : 'grid-cols-1'}`}
                    >
                      {hasPayme ? (
                        <button
                          type="button"
                          onClick={() => setPersonalSettleStep('payme')}
                          className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-rose-50 px-3 py-4 text-center ring-1 ring-rose-200 transition hover:bg-rose-100/80"
                        >
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-rose-700">
                            <ExternalLink className="h-4 w-4" /> PayMe
                          </span>
                          <span className="text-[11px] text-rose-600/80">
                            {party.paymeLink ? '自動複製金額並開啟 App' : '掃描 PayMe 二維碼'}
                          </span>
                        </button>
                      ) : null}
                      {hasFps ? (
                        <button
                          type="button"
                          onClick={() => setPersonalSettleStep('fps')}
                          className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-indigo-50 px-3 py-4 text-center ring-1 ring-indigo-200 transition hover:bg-indigo-100/80"
                        >
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-indigo-700">
                            <QrCode className="h-4 w-4" /> 轉數快 FPS
                          </span>
                          <span className="text-[11px] text-indigo-600/80">
                            {personalFpsQrValue ? '已鎖定金額二維碼／號碼' : '掃描轉數快二維碼'}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : personalSettleStep === 'payme' ? (
                  <div className="space-y-3 rounded-2xl bg-rose-50/60 p-4 ring-1 ring-rose-200/80">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">
                        <ExternalLink className="h-3 w-3" /> 步驟 2/2 · PayMe 付款
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPersonalSettleStep('choose')}
                          className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white/80"
                        >
                          <ArrowLeft className="h-3 w-3" /> 重選方式
                        </button>
                        <button
                          type="button"
                          onClick={() => setPersonalSettleStep('idle')}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/80"
                        >
                          收起
                        </button>
                      </div>
                    </div>

                    {party.paymeLink ? (
                      <div className="space-y-2.5">
                        <p className="text-xs leading-relaxed text-slate-600">
                          點擊下方按鈕會自動複製應付金額{' '}
                          <strong className="text-slate-900">{personalDuePlainText}</strong>{' '}
                          並開啟主辦人 PayMe，進入後直接貼上銀碼即可完成付款。
                        </p>
                        <button
                          type="button"
                          onClick={handleOpenPaymeWithAmount}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          開啟 PayMe（自動複製 {personalDuePlainText}）
                        </button>
                      </div>
                    ) : null}

                    {party.paymeQrImage || paymeQrValue ? (
                      <button
                        type="button"
                        onClick={() => setActiveQrModal('payme')}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50"
                      >
                        <QrCode className="h-3.5 w-3.5" /> 查看 PayMe 收款二維碼
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl bg-indigo-50/60 p-4 ring-1 ring-indigo-200/80">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                        <QrCode className="h-3 w-3" /> 步驟 2/2 · 轉數快 FPS 付款
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPersonalSettleStep('choose')}
                          className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white/80"
                        >
                          <ArrowLeft className="h-3 w-3" /> 重選方式
                        </button>
                        <button
                          type="button"
                          onClick={() => setPersonalSettleStep('idle')}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/80"
                        >
                          收起
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col items-center text-center">
                      {personalFpsQrValue ? (
                        <button
                          type="button"
                          onClick={() => setActiveQrModal('fps-personal')}
                          title="點擊放大並儲存專屬轉數快付款碼"
                          className="group overflow-hidden rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-indigo-200 transition hover:scale-[1.02]"
                        >
                          <div className="flex h-36 w-36 items-center justify-center rounded bg-white p-1">
                            <QRCodeSVG
                              value={personalFpsQrValue}
                              size={136}
                              level="M"
                              includeMargin
                              className="h-full w-full"
                            />
                          </div>
                          <span className="mt-1 block text-[10px] font-semibold text-indigo-600">
                            已鎖定 {formatMoney(personalDueAmount, party.currency)} · 點擊放大／存圖
                          </span>
                        </button>
                      ) : party.fpsQrImage ? (
                        <button
                          type="button"
                          onClick={() => setActiveQrModal('fps')}
                          title="點擊放大轉數快二維碼"
                          className="group overflow-hidden rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-indigo-200 transition hover:scale-[1.02]"
                        >
                          <img
                            src={party.fpsQrImage}
                            alt="轉數快 FPS 收款二維碼"
                            className="h-36 w-36 object-contain"
                          />
                          <span className="mt-1 block text-[10px] font-semibold text-indigo-600">
                            點擊放大／儲存二維碼
                          </span>
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      {personalFpsQrValue || party.fpsQrImage ? (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveQrModal(personalFpsQrValue ? 'fps-personal' : 'fps')
                          }
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          <Download className="h-3.5 w-3.5" /> 放大／儲存付款碼
                        </button>
                      ) : null}
                      {party.fpsInfo ? (
                        <button
                          type="button"
                          onClick={handleCopyFps}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
                        >
                          {copiedFps ? (
                            <>
                              <Check className="h-3.5 w-3.5" /> 已複製號碼
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span className="truncate">複製：{party.fpsInfo}</span>
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              ) : (
                <p className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                  主辦人尚未設定 PayMe 或轉數快收款資料，請直接與主辦人確認轉帳方式。
                </p>
              )}
            </div>
          ) : null}

          {myPersonalSettlement.unpaidOtherOutgoing.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {myPersonalSettlement.unpaidOtherOutgoing.map(({ transfer, status }) => (
                <div
                  key={transfer.key}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2 text-xs ring-1 ring-slate-200/70"
                >
                  <span className="text-slate-700">
                    另需轉帳給 <strong>{transfer.toName}</strong>
                  </span>
                  <span className="font-bold text-brand-600">
                    {formatMoney(status.remainingAmount, party.currency)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {myPersonalSettlement.unpaidIncoming.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {myPersonalSettlement.unpaidIncoming.map(({ transfer, status }) => (
                <div
                  key={transfer.key}
                  className="flex items-center justify-between rounded-xl bg-emerald-50/70 px-3.5 py-2 text-xs ring-1 ring-emerald-200/80"
                >
                  <span className="text-emerald-900">
                    <strong>{transfer.fromName}</strong> 應轉帳給你
                  </span>
                  <span className="font-bold text-emerald-700">
                    +{formatMoney(status.remainingAmount, party.currency)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {!myPersonalSettlement.unpaidHostTransfer &&
          myPersonalSettlement.unpaidOtherOutgoing.length === 0 &&
          myPersonalSettlement.unpaidIncoming.length === 0 ? (
            <p className="mt-2.5 rounded-2xl bg-emerald-50/70 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
              {unassignedExpenses.length > 0
                ? '目前所有已分攤的項目你均已結清（另有待分攤開支將於確認後更新）。'
                : '你已結清所有費用，無需轉帳！'}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 頂層：主辦人收款資料與可點擊二維碼（PayMe 及轉數快） */}
      {hasAnyPayInfo || isAdmin ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <CreditCard className="h-4 w-4 text-brand-600" />
              主辦人收款資料
            </h2>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  if (!editingPayInfo) {
                    setPaymeLink(party.paymeLink ?? '');
                    setPaymeQrImage(party.paymeQrImage ?? '');
                    setFpsInfo(party.fpsInfo ?? '');
                    setFpsQrImage(party.fpsQrImage ?? '');
                    setQrUploadError('');
                  }
                  setEditingPayInfo((v) => !v);
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <Edit3 className="h-3.5 w-3.5" />
                {editingPayInfo ? '收起' : hasAnyPayInfo ? '編輯' : '設定收款資料'}
              </button>
            ) : null}
          </div>

          {savedPayInfo ? (
            <p className="mt-2 text-xs font-medium text-emerald-600">收款資料已更新 ✓</p>
          ) : null}

          {hasAnyPayInfo && !editingPayInfo ? (
            <div
              className={`mt-3 grid gap-3 ${hasPayme && hasFps ? 'grid-cols-2' : 'grid-cols-1'}`}
            >
              {/* PayMe 二維碼卡片 */}
              {hasPayme ? (
                <div className="flex flex-col items-center rounded-2xl bg-rose-50/50 p-3.5 text-center ring-1 ring-rose-100">
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">
                    <QrCode className="h-3 w-3" /> PayMe
                  </span>

                  {party.paymeQrImage || paymeQrValue ? (
                    <button
                      type="button"
                      onClick={() => setActiveQrModal('payme')}
                      title="點擊放大 PayMe 二維碼"
                      className="group mt-2.5 overflow-hidden rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/80 transition hover:scale-[1.02] hover:ring-brand-300"
                    >
                      {party.paymeQrImage ? (
                        <img
                          src={party.paymeQrImage}
                          alt="PayMe 收款二維碼"
                          className="h-32 w-32 object-contain sm:h-36 sm:w-36"
                        />
                      ) : (
                        <div className="flex h-32 w-32 items-center justify-center rounded bg-white p-1 sm:h-36 sm:w-36">
                          <QRCodeSVG
                            value={paymeQrValue}
                            size={132}
                            level="M"
                            includeMargin
                            className="h-full w-full"
                          />
                        </div>
                      )}
                      <span className="mt-1 block text-[10px] font-medium text-slate-400 group-hover:text-brand-600">
                        點擊放大二維碼
                      </span>
                    </button>
                  ) : null}

                  {party.paymeLink ? (
                    <a
                      href={party.paymeLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> 開啟 PayMe 轉帳
                    </a>
                  ) : null}
                </div>
              ) : null}

              {/* 轉數快 FPS 二維碼卡片 */}
              {hasFps ? (
                <div className="flex flex-col items-center rounded-2xl bg-indigo-50/50 p-3.5 text-center ring-1 ring-indigo-100">
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100/80 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                    <QrCode className="h-3 w-3" /> 轉數快 FPS
                  </span>

                  {party.fpsQrImage || fpsQrValue ? (
                    <button
                      type="button"
                      onClick={() => setActiveQrModal('fps')}
                      title="點擊放大轉數快二維碼"
                      className="group mt-2.5 overflow-hidden rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/80 transition hover:scale-[1.02] hover:ring-indigo-300"
                    >
                      {party.fpsQrImage ? (
                        <img
                          src={party.fpsQrImage}
                          alt="轉數快 FPS 收款二維碼"
                          className="h-32 w-32 object-contain sm:h-36 sm:w-36"
                        />
                      ) : (
                        <div className="flex h-32 w-32 items-center justify-center rounded bg-white p-1 sm:h-36 sm:w-36">
                          <QRCodeSVG
                            value={fpsQrValue}
                            size={132}
                            level="M"
                            includeMargin
                            className="h-full w-full"
                          />
                        </div>
                      )}
                      <span className="mt-1 block text-[10px] font-medium text-slate-400 group-hover:text-indigo-600">
                        點擊放大二維碼
                      </span>
                    </button>
                  ) : null}

                  {party.fpsInfo ? (
                    <button
                      type="button"
                      onClick={handleCopyFps}
                      className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                    >
                      {copiedFps ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> 已複製號碼
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span className="truncate">複製：{party.fpsInfo}</span>
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {!hasAnyPayInfo && !editingPayInfo && isAdmin ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-slate-500">
                尚未設定 PayMe 或轉數快資料。設定後會在頂部自動顯示可點擊的收款二維碼，方便參加者即時轉帳。
              </p>
              {hasCloudDefaultPayment ? (
                <button
                  type="button"
                  onClick={handleApplyCloudDefaultPayment}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                >
                  <Check className="h-3.5 w-3.5" /> 一鍵套用已保存的雲端收款資料
                </button>
              ) : null}
            </div>
          ) : null}

          {isAdmin && editingPayInfo ? (
            <form onSubmit={handleSavePayInfo} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              {/* PayMe 設定 */}
              <div className="space-y-1.5 rounded-2xl bg-slate-50 p-3">
                <label className="block text-xs font-semibold text-slate-700">PayMe 連結</label>
                <input
                  type="url"
                  value={paymeLink}
                  onChange={(e) => setPaymeLink(e.target.value)}
                  placeholder="https://payme.hsbc/..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-brand-500"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
                    <Upload className="h-3 w-3" />
                    {paymeQrImage ? '更換 PayMe 二維碼圖片' : '上傳自訂 PayMe 二維碼（選填）'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleQrImageUpload(e, 'payme')}
                      className="hidden"
                    />
                  </label>
                  {paymeQrImage ? (
                    <button
                      type="button"
                      onClick={() => setPaymeQrImage('')}
                      className="text-[11px] font-medium text-rose-600 hover:underline"
                    >
                      改用自動產生
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-400">未上傳時會由連結自動產生</span>
                  )}
                </div>
              </div>

              {/* 轉數快設定 */}
              <div className="space-y-1.5 rounded-2xl bg-slate-50 p-3">
                <label className="block text-xs font-semibold text-slate-700">
                  轉數快 FPS 電話／FPS ID／電郵
                </label>
                <input
                  type="text"
                  value={fpsInfo}
                  onChange={(e) => setFpsInfo(e.target.value)}
                  placeholder="例如：91234567 或 FPS ID"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-brand-500"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
                    <Upload className="h-3 w-3" />
                    {fpsQrImage ? '更換轉數快二維碼圖片' : '上傳銀行轉數快二維碼（選填）'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleQrImageUpload(e, 'fps')}
                      className="hidden"
                    />
                  </label>
                  {fpsQrImage ? (
                    <button
                      type="button"
                      onClick={() => setFpsQrImage('')}
                      className="text-[11px] font-medium text-rose-600 hover:underline"
                    >
                      改用自動產生
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-400">支援自動產生香港 HKQR 標準碼</span>
                  )}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200/80">
                <input
                  type="checkbox"
                  checked={saveAsCloudDefault}
                  onChange={(e) => setSaveAsCloudDefault(e.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
                <span>同時保存到雲端作為預設收款資料，下次開新局自動套用</span>
              </label>

              {qrUploadError ? (
                <p className="text-xs font-medium text-rose-600">{qrUploadError}</p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {hasCloudDefaultPayment ? (
                  <button
                    type="button"
                    onClick={handleApplyCloudDefaultPayment}
                    className="text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    套用雲端預設資料
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPayInfo(false)}
                    className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    儲存收款資料
                  </button>
                </div>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

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
          <div className="flex flex-wrap items-center gap-1.5">
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
        </div>

        {unassignedExpenses.length > 0 ? (
          <div className="mt-3 rounded-2xl bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
            尚有 <strong>{unassignedExpenses.length} 筆</strong>開支（共{' '}
            <strong>{formatMoney(unassignedTotal, party.currency)}</strong>
            ）尚未設定分攤成員，暫未計入下方轉帳；可隨時在下方「開支紀錄」點「設定分攤」。
          </div>
        ) : null}

        {transfers.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-center text-xs text-slate-500">
            {unassignedExpenses.length > 0
              ? '目前開支均為「待分攤」，設定分攤成員後將自動計算最少轉帳方案。'
              : '暫時未有待結算轉帳。新增開支並設定分攤後會自動計算最少轉帳方案。'}
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {transfers.map((t) => {
              const payment = party.settlementPayments[t.key];
              const payStatus = getTransferPaymentStatus(t, payment);
              const isFullPaid = payStatus.state === 'paid';
              const isPartialPaid = payStatus.state === 'partial';
              return (
                <div
                  key={t.key}
                  className={`rounded-2xl p-3.5 ring-1 transition ${
                    isFullPaid
                      ? 'bg-emerald-50/60 ring-emerald-200'
                      : isPartialPaid
                        ? 'bg-amber-50/70 ring-amber-200'
                        : 'bg-slate-50/80 ring-slate-200/80'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <span>{t.fromName}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                      <span>{t.toName}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-brand-600">
                        {formatMoney(t.amount, party.currency)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          isFullPaid
                            ? 'bg-emerald-100 text-emerald-800'
                            : isPartialPaid
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {isFullPaid ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            已付 ({payment?.method ?? '已確認'})
                          </>
                        ) : isPartialPaid ? (
                          <>
                            <Clock className="h-3 w-3" />
                            已收 {formatMoney(payStatus.paidAmount, party.currency)} · 仍欠{' '}
                            {formatMoney(payStatus.remainingAmount, party.currency)}
                          </>
                        ) : (
                          <>
                            <Clock className="h-3 w-3" /> 待付
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {payStatus.overpaidAmount > 0 ? (
                    <p className="mt-1.5 text-[11px] font-medium text-amber-700">
                      提示：原已記錄收款 {formatMoney(payStatus.paidAmount, party.currency)}，目前多收{' '}
                      {formatMoney(payStatus.overpaidAmount, party.currency)}
                    </p>
                  ) : null}

                  {isAdmin ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(['PayMe', 'FPS', 'Cash'] as PaymentMethod[]).map((m) => {
                        const active = isFullPaid && payment?.method === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleMarkPayment(t.key, t.amount, m)}
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
                      {isFullPaid || isPartialPaid ? (
                        <button
                          type="button"
                          onClick={() => handleMarkPayment(t.key, t.amount)}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Plus className="h-4 w-4 text-brand-600" />
              新增一筆開支
            </h2>
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 ${
                scanningReceipt ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <Camera className="h-3.5 w-3.5" />
              {scanningReceipt ? 'AI 掃單並存單中...' : '影相AI入單'}
              <input
                type="file"
                accept="image/*"
                disabled={scanningReceipt}
                onChange={handleScanReceipt}
                className="hidden"
              />
            </label>
          </div>

          {!mediaApiBase ? (
            <p className="mt-2 text-[11px] text-slate-400">
              提示：到「原圖相簿」分頁設定伺服器網址後，即可使用 AI 影相掃單並自動保存單據。
            </p>
          ) : null}

          {receiptUrl ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-indigo-50/80 px-3.5 py-2.5 ring-1 ring-indigo-200">
              <div className="flex min-w-0 items-center gap-2.5">
                <img
                  src={receiptUrl}
                  alt="已掃描單據縮圖"
                  className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-indigo-200"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-xs font-bold text-indigo-900">
                    <Receipt className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                    原版單據已自動保存
                  </p>
                  {receiptSummary ? (
                    <p className="mt-0.5 truncate text-[11px] text-indigo-800/80">
                      {receiptSummary}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setViewingReceipt({
                      title: title.trim() || '待儲存單據',
                      url: receiptUrl,
                      summary: receiptSummary || undefined,
                    })
                  }
                  className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                >
                  預覽
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptUrl('');
                    setReceiptKey('');
                    setReceiptSummary('');
                  }}
                  aria-label="移除單據"
                  className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}

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
                <label className="block text-xs font-semibold text-slate-600">分攤設定</label>
                <div className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAssignSplitNow(false)}
                    className={`flex-1 rounded-xl px-2.5 py-2 text-xs font-semibold transition ring-1 ${
                      !assignSplitNow
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    先記帳（稍後再分攤）
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignSplitNow(true)}
                    className={`flex-1 rounded-xl px-2.5 py-2 text-xs font-semibold transition ring-1 ${
                      assignSplitNow
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    立即分攤成員
                  </button>
                </div>
              </div>
            </div>

            {assignSplitNow ? (
              <>
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
              </>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                此開支會先記入活動總開支並標記為「待分攤」，待確認出席及分攤情況後，再於下方開支紀錄隨時設定成員。
              </p>
            )}

            {errorMsg ? <p className="text-xs font-medium text-rose-600">{errorMsg}</p> : null}

            <button
              type="submit"
              className="w-full rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              {assignSplitNow ? '新增開支並即時更新結算' : '新增開支（稍後再分攤）'}
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
            {party.expenses.map((exp) => {
              const isUnassigned = exp.participantIds.length === 0;
              const isEditingThis = editingExpenseId === exp.id;
              return (
                <div key={exp.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {CATEGORY_LABELS[exp.category]}
                        </span>
                        <p className="truncate text-sm font-semibold text-slate-900">{exp.title}</p>
                        {isUnassigned ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            待分攤
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {guestNameById(exp.paidByGuestId)} 墊付 ·{' '}
                        {isUnassigned
                          ? '尚未設定分攤成員'
                          : `${SPLIT_LABELS[exp.splitType]}（${exp.participantIds.length} 人分攤）`}
                      </p>
                      {exp.receiptSummary ? (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          AI 摘要：{exp.receiptSummary}
                        </p>
                      ) : null}
                      {exp.receiptUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setViewingReceipt({
                              title: exp.title,
                              url: exp.receiptUrl!,
                              summary: exp.receiptSummary,
                            })
                          }
                          className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                        >
                          <Receipt className="h-3 w-3" /> 查看原版單據
                        </button>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900">
                        {formatMoney(exp.amount, party.currency)}
                      </span>
                      {isAdmin ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              isEditingThis ? setEditingExpenseId(null) : openSplitEditor(exp)
                            }
                            className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                              isUnassigned
                                ? 'bg-amber-500 text-white hover:bg-amber-600'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {isEditingThis ? '收起' : isUnassigned ? '設定分攤' : '編輯分攤'}
                          </button>
                          <button
                            type="button"
                            aria-label="刪除開支"
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {isAdmin && isEditingThis ? (
                    <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600">分攤方式</label>
                        <div className="mt-1 flex gap-1.5">
                          {(['equal', 'custom_shares', 'exact'] as SplitType[]).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setEditSplitType(t)}
                              className={`flex-1 rounded-xl px-2 py-1.5 text-xs font-semibold transition ring-1 ${
                                editSplitType === t
                                  ? 'bg-brand-600 text-white ring-brand-600'
                                  : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {SPLIT_LABELS[t]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs font-semibold text-slate-600">
                            選擇分攤成員（已選 {editSelectedIds.length} 人）
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditSelectedIds(activeGuests.map((g) => g.id))}
                              className="text-[11px] font-semibold text-brand-600 hover:underline"
                            >
                              全選出席
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditSelectedIds(allGuests.map((g) => g.id))}
                              className="text-[11px] font-semibold text-slate-500 hover:underline"
                            >
                              全選全部
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 space-y-1.5">
                          {allGuests.map((g) => {
                            const checked = editSelectedIds.includes(g.id);
                            return (
                              <div
                                key={g.id}
                                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ring-1 transition ${
                                  checked
                                    ? 'bg-white ring-brand-200'
                                    : 'bg-slate-100/70 text-slate-400 ring-slate-200/60'
                                }`}
                              >
                                <label className="flex flex-1 cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleEditParticipant(g.id)}
                                    className="h-4 w-4 accent-brand-600"
                                  />
                                  <span className="font-medium text-slate-800">{g.name}</span>
                                </label>

                                {checked && editSplitType === 'custom_shares' && (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      value={editCustomShares[g.id] ?? '1'}
                                      onChange={(e) =>
                                        setEditCustomShares((prev) => ({
                                          ...prev,
                                          [g.id]: e.target.value,
                                        }))
                                      }
                                      className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-xs text-slate-900"
                                    />
                                    <span className="text-[11px] text-slate-500">份</span>
                                  </div>
                                )}

                                {checked && editSplitType === 'exact' && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-slate-500">
                                      {party.currency}
                                    </span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={editExactAmounts[g.id] ?? ''}
                                      onChange={(e) =>
                                        setEditExactAmounts((prev) => ({
                                          ...prev,
                                          [g.id]: e.target.value,
                                        }))
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

                      {editErrorMsg ? (
                        <p className="text-xs font-medium text-rose-600">{editErrorMsg}</p>
                      ) : null}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        {!isUnassigned ? (
                          <button
                            type="button"
                            onClick={() => handleSaveExpenseSplit(exp, true)}
                            className="text-xs font-medium text-slate-500 hover:text-rose-600 hover:underline"
                          >
                            改回待分攤
                          </button>
                        ) : (
                          <span />
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingExpenseId(null)}
                            className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveExpenseSplit(exp, false)}
                            className="rounded-xl bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                          >
                            儲存分攤並更新結算
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 放大二維碼彈窗 */}
      {activeQrModal ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveQrModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                {activeQrModal === 'payme'
                  ? 'PayMe 收款二維碼'
                  : activeQrModal === 'fps-personal'
                    ? `轉數快專屬付款碼（${formatMoney(personalDueAmount, party.currency)}）`
                    : '轉數快 FPS 收款二維碼'}
              </h3>
              <button
                type="button"
                aria-label="關閉"
                onClick={() => setActiveQrModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex justify-center rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
              {activeQrModal === 'payme' ? (
                party.paymeQrImage ? (
                  <img
                    src={party.paymeQrImage}
                    alt="PayMe 收款二維碼"
                    className="h-56 w-56 object-contain"
                  />
                ) : (
                  <QRCodeCanvas
                    ref={modalQrCanvasRef}
                    value={paymeQrValue}
                    size={224}
                    level="M"
                    includeMargin
                  />
                )
              ) : activeQrModal === 'fps-personal' ? (
                <QRCodeCanvas
                  ref={modalQrCanvasRef}
                  value={personalFpsQrValue}
                  size={224}
                  level="M"
                  includeMargin
                />
              ) : party.fpsQrImage ? (
                <img
                  src={party.fpsQrImage}
                  alt="轉數快 FPS 收款二維碼"
                  className="h-56 w-56 object-contain"
                />
              ) : (
                <QRCodeCanvas
                  ref={modalQrCanvasRef}
                  value={fpsQrValue}
                  size={224}
                  level="M"
                  includeMargin
                />
              )}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              {activeQrModal === 'fps-personal'
                ? `此二維碼已自動嵌入應付金額 ${formatMoney(personalDueAmount, party.currency)}，可先儲存圖片再於銀行 App 或 PayMe 匯入掃描，無須手動輸入銀碼。`
                : `可直接掃描，或點下方下載二維碼後於 ${activeQrModal === 'payme' ? 'PayMe' : '銀行 App'} 匯入付款。`}
            </p>

            <div className="mt-4 space-y-2">
              {activeQrModal === 'payme' && party.paymeLink ? (
                <a
                  href={party.paymeLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                >
                  <ExternalLink className="h-4 w-4" /> 直接開啟 PayMe 付款
                </a>
              ) : null}

              {(activeQrModal === 'fps' || activeQrModal === 'fps-personal') && party.fpsInfo ? (
                <button
                  type="button"
                  onClick={handleCopyFps}
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  {copiedFps ? (
                    <>
                      <Check className="h-4 w-4" /> 已複製轉數快號碼
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> 複製轉數快：{party.fpsInfo}
                    </>
                  )}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => handleShareModalQr(activeQrModal)}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <Share2 className="h-4 w-4" />{' '}
                {activeQrModal === 'fps-personal' ? '原生分享／儲存專屬付款碼' : '原生分享／儲存二維碼'}
              </button>

              <button
                type="button"
                onClick={() => handleDownloadModalQr(activeQrModal)}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                <Download className="h-4 w-4" />{' '}
                直接下載 PNG
              </button>

              <button
                type="button"
                onClick={() => setActiveQrModal(null)}
                className="w-full rounded-2xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 單據原圖查閱彈窗（儲存於 Cloudflare R2） */}
      {viewingReceipt ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setViewingReceipt(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-xs font-bold text-slate-900">
                  <Receipt className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                  單據查閱：{viewingReceipt.title}
                </p>
                {viewingReceipt.summary ? (
                  <p className="mt-0.5 text-[11px] text-slate-500">{viewingReceipt.summary}</p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="關閉單據預覽"
                onClick={() => setViewingReceipt(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-900/95 p-2">
              <img
                src={viewingReceipt.url}
                alt={`${viewingReceipt.title} 單據`}
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 p-3.5">
              <a
                href={buildDownloadUrl(viewingReceipt.url, `${viewingReceipt.title}_receipt.jpg`)}
                download={`${viewingReceipt.title}_receipt.jpg`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <Download className="h-4 w-4" /> 下載原版單據
              </a>
              <button
                type="button"
                onClick={() => setViewingReceipt(null)}
                className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
