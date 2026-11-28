import { useState } from 'react';
import { toast } from 'sonner';
import { Calendar, Download, ExternalLink, Copy, Check, MapPin, Image as ImageIcon, Share2 } from 'lucide-react';
import type { AppTheme, Party } from '../types/party';
import {
  buildGoogleCalendarUrl,
  buildGoogleMapsUrl,
  buildWhatsAppInviteText,
  downloadICS,
  formatPartyDateTime,
  hasEndTime,
} from '../lib/calendar';
import { shareTextOrUrl } from '../lib/webShare';
import { ShareCardModal } from './ShareCardModal';

interface CalendarTabProps {
  party: Party;
  shareUrl: string;
  appTheme: AppTheme;
}

export function CalendarTab({ party, shareUrl, appTheme }: CalendarTabProps) {
  const [copiedKey, setCopiedKey] = useState<'link' | 'whatsapp' | null>(null);
  const [showInviteCard, setShowInviteCard] = useState(false);

  const gcalUrl = buildGoogleCalendarUrl(party, shareUrl);
  const whatsappText = buildWhatsAppInviteText(party, shareUrl);

  async function copyText(text: string, key: 'link' | 'whatsapp') {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(key === 'whatsapp' ? '已複製 WhatsApp 邀請文字' : '已複製派對連結');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error('複製失敗，請手動選取複製');
    }
  }

  async function handleNativeShareInvite() {
    const outcome = await shareTextOrUrl({
      title: party.title,
      text: whatsappText,
      url: shareUrl,
    });
    if (outcome === 'shared' || outcome === 'cancelled') return;
    await copyText(whatsappText, 'whatsapp');
  }

  return (
    <div className="space-y-5">
      {/* 一鍵加入日曆 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-brand-600">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">一鍵加入個人日曆</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              無需登入帳號，iPhone／Android／電腦均可即時匯入活動時間與地點。
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-800">
              {formatPartyDateTime(party.startTime, party.endTime)}
            </p>
            {!hasEndTime(party.endTime) ? (
              <p className="mt-0.5 text-[11px] text-slate-400">
                未指定結束時間，匯入日曆時預設為 2 小時（可自行調整）
              </p>
            ) : null}
            {party.location || party.address ? (
              <a
                href={buildGoogleMapsUrl(
                  [party.location?.trim(), party.address?.trim()].filter(Boolean).join(' ')
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {party.location}
                  {party.address && party.address !== party.location ? `（${party.address}）` : ''}
                  {' · 在 Google 地圖查看'}
                </span>
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              downloadICS(party, shareUrl);
              toast.success('已下載 .ics 日曆檔');
            }}
            className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            <Download className="h-4 w-4" />
            下載 .ics 日曆檔（Apple / Outlook）
          </button>

          <a
            href={gcalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            <ExternalLink className="h-4 w-4" />
            加入 Google Calendar
          </a>
        </div>
      </section>

      {/* WhatsApp 邀請訊息產生器 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">WhatsApp 群組邀請範本</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              已自動附上活動詳情、報名短連結及 Google Calendar 一鍵加入連結。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowInviteCard(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            <ImageIcon className="h-3.5 w-3.5" /> 匯出邀請卡圖片
          </button>
        </div>

        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200/70">
          {whatsappText}
        </pre>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          <button
            type="button"
            onClick={handleNativeShareInvite}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            <Share2 className="h-4 w-4" />
            分享
          </button>

          <button
            type="button"
            onClick={() => copyText(whatsappText, 'whatsapp')}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-200"
          >
            {copiedKey === 'whatsapp' ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" /> 已複製訊息
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> 複製邀請文字
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => copyText(shareUrl, 'link')}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-200"
          >
            {copiedKey === 'link' ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" /> 已複製連結
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> 只複製派對連結
              </>
            )}
          </button>
        </div>
      </section>

      {showInviteCard ? (
        <ShareCardModal
          mode="invite"
          party={party}
          shareUrl={shareUrl}
          appTheme={appTheme}
          onClose={() => setShowInviteCard(false)}
        />
      ) : null}
    </div>
  );
}
