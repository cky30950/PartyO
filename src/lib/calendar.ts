import type { Party } from '../types/party';

/**
 * 將本地時間字串 (YYYY-MM-DDTHH:mm) 轉成 UTC 格式 YYYYMMDDTHHMMSSZ
 */
export function toCalendarUtcString(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 未指定結束時間時，日曆預設 2 小時
const OPEN_ENDED_GRACE_MS = 6 * 60 * 60 * 1000; // 未指定結束時間時，至少保留開始後 6 小時或當日結束

export function hasEndTime(endTime?: string): boolean {
  if (!endTime?.trim()) return false;
  return !Number.isNaN(new Date(endTime).getTime());
}

/**
 * 判斷活動是否已結束：
 * - 有結束時間：超過結束時間即視為已結束
 * - 未指定結束時間：超過開始當日 23:59:59 及開始後 6 小時（取較晚者）視為已結束
 */
export function isPartyEnded(
  party: Pick<Party, 'startTime' | 'endTime' | 'manuallyEnded'>,
  now: Date = new Date()
): boolean {
  if (party.manuallyEnded === true) return true;
  if (party.manuallyEnded === false) return false;

  if (hasEndTime(party.endTime)) {
    const end = new Date(party.endTime!);
    if (!Number.isNaN(end.getTime())) {
      return now.getTime() > end.getTime();
    }
  }

  const start = new Date(party.startTime);
  if (Number.isNaN(start.getTime())) return false;

  const endOfStartDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    23,
    59,
    59,
    999
  );
  const cutoff = Math.max(endOfStartDay.getTime(), start.getTime() + OPEN_ENDED_GRACE_MS);
  return now.getTime() > cutoff;
}

/**
 * 取得寫入日曆用的結束時間（若未指定或早於開始時間，預設為開始時間後 2 小時）
 */
function resolveCalendarEndUtcString(startTime: string, endTime?: string): string {
  const start = new Date(startTime);
  if (hasEndTime(endTime)) {
    const end = new Date(endTime!);
    if (Number.isNaN(start.getTime()) || end.getTime() > start.getTime()) {
      return toCalendarUtcString(endTime!);
    }
  }
  if (!Number.isNaN(start.getTime())) {
    return toCalendarUtcString(new Date(start.getTime() + DEFAULT_DURATION_MS).toISOString());
  }
  return toCalendarUtcString(new Date(Date.now() + DEFAULT_DURATION_MS).toISOString());
}

export function generateICS(party: Party, shareUrl = ''): string {
  const dtStamp = toCalendarUtcString(new Date().toISOString());
  const dtStart = toCalendarUtcString(party.startTime);
  const dtEnd = resolveCalendarEndUtcString(party.startTime, party.endTime);
  const uid = `${party.id}@partyo.app`;

  const descriptionParts = [
    party.description.trim(),
    !hasEndTime(party.endTime) ? '註：活動未指定結束時間' : '',
    party.hostName ? `搞手：${party.hostName}` : '',
    shareUrl ? `派對詳情、報名及費用結算：${shareUrl}` : '',
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PartyO//Party Planner PWA//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(party.title)}`,
    `LOCATION:${escapeIcsText(formatPartyLocation(party))}`,
    `DESCRIPTION:${escapeIcsText(descriptionParts.join('\n\n'))}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

export function downloadICS(party: Party, shareUrl = ''): void {
  const icsContent = generateICS(party, shareUrl);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = party.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'partyo_event';
  link.href = url;
  link.download = `${safeName}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildGoogleCalendarUrl(party: Party, shareUrl = ''): string {
  const start = toCalendarUtcString(party.startTime);
  const end = resolveCalendarEndUtcString(party.startTime, party.endTime);

  const detailsParts = [
    party.description.trim(),
    !hasEndTime(party.endTime) ? '註：活動未指定結束時間' : '',
    party.hostName ? `搞手：${party.hostName}` : '',
    shareUrl ? `活動報名及費用分攤頁面：${shareUrl}` : '',
  ].filter(Boolean);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: party.title,
    dates: `${start}/${end}`,
    details: detailsParts.join('\n\n'),
    location: formatPartyLocation(party),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function formatPartyDateTime(startTime: string, endTime?: string): string {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return startTime;

  const dateFmt = new Intl.DateTimeFormat('zh-HK', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
  const timeFmt = new Intl.DateTimeFormat('zh-HK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (!hasEndTime(endTime)) {
    return `${dateFmt.format(start)} ${timeFmt.format(start)}`;
  }

  const end = new Date(endTime!);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}

export function formatPartyLocation(party: Pick<Party, 'location' | 'address'>): string {
  const loc = party.location?.trim() ?? '';
  const addr = party.address?.trim() ?? '';
  if (loc && addr && !addr.includes(loc)) return `${loc}（${addr}）`;
  return loc || addr;
}

export function buildGoogleMapsUrl(location: string): string {
  const trimmed = location.trim();
  if (!trimmed) return 'https://www.google.com/maps/';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

export function buildShortPartyUrl(partyId: string, go?: 'cal' | 'map'): string {
  if (typeof window === 'undefined') return '';
  const base = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams({ p: partyId });
  if (go) params.set('go', go);
  return `${base}?${params.toString()}`;
}

export function buildWhatsAppInviteText(party: Party, shareUrl: string): string {
  const shortPartyUrl = buildShortPartyUrl(party.id) || shareUrl;
  const shortCalUrl = buildShortPartyUrl(party.id, 'cal') || buildGoogleCalendarUrl(party, shortPartyUrl);
  const timeLabel = formatPartyDateTime(party.startTime, party.endTime);
  const fullLocation = formatPartyLocation(party);
  const mapQuery = [party.location?.trim(), party.address?.trim()].filter(Boolean).join(' ');
  const shortMapUrl = buildShortPartyUrl(party.id, 'map') || buildGoogleMapsUrl(mapQuery);
  const lines = [
    `🎉 *${party.title}*`,
    `📅 時間：${timeLabel}`,
    party.location ? `📍 地點：${party.location}` : '',
    party.address ? `🏠 地址：${party.address}` : '',
    fullLocation ? `🗺️ Google 地圖：${shortMapUrl}` : '',
    party.description ? `📝 備註：${party.description}` : '',
    '',
    `👉 點擊進入活動及查看明細：`,
    shortPartyUrl,
    '',
    `🗓️ 一鍵加入 Google 日曆：`,
    shortCalUrl,
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));

  return lines.join('\n');
}
