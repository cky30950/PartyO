import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Download, Share2, X, Calendar, MapPin, Users, Wallet } from 'lucide-react';
import type { AppTheme, Party, Transfer } from '../types/party';
import { formatPartyDateTime, formatPartyLocation } from '../lib/calendar';
import { getApprovedGuests } from '../lib/partyStore';
import { getThemeTokens } from '../lib/themes';
import {
  formatMoney,
  getTransferPaymentStatus,
  sumExpensesTotal,
} from '../lib/settlement';

interface ShareCardModalProps {
  mode: 'invite' | 'settlement';
  party: Party;
  shareUrl: string;
  appTheme: AppTheme;
  transfers?: Transfer[];
  onClose: () => void;
}

export function ShareCardModal({
  mode,
  party,
  shareUrl,
  appTheme,
  transfers = [],
  onClose,
}: ShareCardModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);

  const t = getThemeTokens(appTheme);
  const approvedGuests = getApprovedGuests(party);
  const goingCount = approvedGuests.filter((g) => g.status === 'going').length;
  const totalSpent = sumExpensesTotal(party.expenses);
  const fullLocation = formatPartyLocation(party);
  const timeLabel = formatPartyDateTime(party.startTime, party.endTime);

  const safeTitle =
    party.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 32) || 'partyo';
  const fileName =
    mode === 'invite' ? `${safeTitle}_invite.png` : `${safeTitle}_settlement.png`;

  async function renderPngDataUrl(): Promise<string> {
    if (!cardRef.current) throw new Error('找不到卡片元素');
    return toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
    });
  }

  async function handleDownload() {
    setExporting(true);
    try {
      const dataUrl = await renderPngDataUrl();
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(mode === 'invite' ? '已下載邀請卡圖片' : '已下載費用結算圖片');
    } catch (err) {
      const detail = err instanceof Error ? err.message : '匯出失敗';
      toast.error(`匯出圖片失敗：${detail}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleNativeShare() {
    setExporting(true);
    try {
      const dataUrl = await renderPngDataUrl();
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: party.title,
          text:
            mode === 'invite'
              ? `${party.title} 邀請卡`
              : `${party.title} 費用結算明細`,
          files: [file],
        });
        toast.success('已開啟系統分享');
        return;
      }

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('裝置不支援直接分享圖片，已自動下載 PNG');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast.error('分享圖片失敗，請改用下載按鈕');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/65 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            {mode === 'invite' ? '派對邀請卡預覽' : '費用結算圖預覽'}
          </h3>
          <button
            type="button"
            aria-label="關閉"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 匯出目標卡片 DOM（動態套用主題色盤、外框風格與節日徽章） */}
        <div
          ref={cardRef}
          className="p-3.5"
          style={{
            backgroundColor: t.bg,
            border: t.frame === 'scroll' ? `4px double ${t.border}` : t.frame === 'dashed' ? `2px dashed ${t.border}` : `3px solid ${t.border}`,
            borderRadius: t.cardRadius,
            color: t.ink,
            boxShadow: t.frame === 'neon' ? `0 0 14px ${t.glow}` : undefined,
          }}
        >
          <div
            className="p-4"
            style={{
              backgroundColor: t.surface,
              border: t.frame === 'scroll' ? `3px double ${t.border}` : `2px solid ${t.border}`,
              borderRadius: t.btnRadius,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="inline-block rounded px-2 py-0.5 font-pixel text-[10px] font-bold tracking-wider"
                style={{ backgroundColor: t.badgeBg, color: t.badgeText }}
              >
                {t.emoji} {mode === 'invite' ? 'PARTY INVITE' : 'GOLD LEDGER'}
              </span>
            </div>

            <h4 className="mt-2.5 text-lg font-bold leading-snug" style={{ color: t.heading }}>
              {party.title}
            </h4>

            {mode === 'invite' ? (
              <div className="mt-3 space-y-2 text-xs" style={{ color: t.ink2 }}>
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: t.accent }} />
                  <span className="font-semibold">{timeLabel}</span>
                </div>

                {fullLocation ? (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: t.accent }} />
                    <span>{fullLocation}</span>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 shrink-0" style={{ color: t.accent }} />
                  <span>
                    搞手：{party.hostName} ·{' '}
                    {party.maxGuests
                      ? `${goingCount}/${party.maxGuests} 人出席`
                      : `${goingCount} 人已出席`}
                  </span>
                </div>

                {party.description.trim() ? (
                  <p
                    className="mt-2 line-clamp-3 whitespace-pre-line rounded p-2.5 text-[11px] leading-relaxed"
                    style={{
                      backgroundColor: t.surfaceSubtle,
                      border: `1px solid ${t.borderSoft}`,
                    }}
                  >
                    {party.description.trim()}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 space-y-2.5">
                <div
                  className="flex items-center justify-between rounded p-2.5"
                  style={{
                    backgroundColor: t.surfaceSubtle,
                    border: `1px solid ${t.borderSoft}`,
                  }}
                >
                  <span
                    className="inline-flex items-center gap-1 text-xs font-semibold"
                    style={{ color: t.inkMuted }}
                  >
                    <Wallet className="h-3.5 w-3.5" /> 活動總開支（{party.expenses.length} 筆）
                  </span>
                  <span className="text-sm font-bold" style={{ color: t.accent }}>
                    {formatMoney(totalSpent, party.currency)}
                  </span>
                </div>

                {transfers.length === 0 ? (
                  <p className="py-2 text-center text-xs" style={{ color: t.inkMuted }}>
                    所有人已結清，無需轉帳！
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {transfers.slice(0, 8).map((tr) => {
                      const st = getTransferPaymentStatus(tr, party.settlementPayments[tr.key]);
                      const badgeText =
                        st.state === 'paid'
                          ? '已付'
                          : st.state === 'partial'
                            ? `仍欠 ${formatMoney(st.remainingAmount, party.currency)}`
                            : '待付';
                      return (
                        <div
                          key={tr.key}
                          className="flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-[11px]"
                          style={{
                            backgroundColor: t.surfaceSubtle,
                            border: `1px solid ${t.borderSoft}`,
                          }}
                        >
                          <span className="truncate font-semibold" style={{ color: t.ink2 }}>
                            {tr.fromName} ➔ {tr.toName}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="font-bold" style={{ color: t.accent }}>
                              {formatMoney(tr.amount, party.currency)}
                            </span>
                            <span className="text-[10px]" style={{ color: t.inkMuted }}>
                              [{badgeText}]
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {transfers.length > 8 ? (
                      <p className="text-center text-[10px]" style={{ color: t.inkMuted }}>
                        另有 {transfers.length - 8} 筆請掃描二維碼查看完整明細
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* 底部掃碼區 */}
            {shareUrl ? (
              <div
                className="mt-3.5 flex items-center justify-between gap-3 pt-3"
                style={{ borderTop: `1px solid ${t.borderSoft}` }}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-bold" style={{ color: t.heading }}>
                    {mode === 'invite' ? '掃描二維碼報名及加日曆' : '掃描查看明細及收款碼'}
                  </p>
                  <p className="mt-0.5 text-[10px]" style={{ color: t.inkMuted }}>
                    長按識別或用相機掃描進入活動頁
                  </p>
                </div>
                <div className="shrink-0 rounded bg-white p-1">
                  <QRCodeSVG value={shareUrl} size={64} level="M" />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* 匯出按鈕 */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={handleNativeShare}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Share2 className="h-4 w-4" />
            {exporting ? '產生中...' : '分享圖片'}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleDownload}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exporting ? '產生中...' : '下載 PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}
