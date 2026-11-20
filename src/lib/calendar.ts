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

export function generateICS(party: Party, shareUrl = ''): string {
  const dtStamp = toCalendarUtcString(new Date().toISOString());
  const dtStart = toCalendarUtcString(party.startTime);
  const dtEnd = toCalendarUtcString(party.endTime);
  const uid = `${party.id}@partyo.app`;

  const descriptionParts = [
    party.description.trim(),
    party.hostName ? `搞手：${party.hostName}` : '',
    shareUrl ? `派對詳情、報名及 AA 結算：${shareUrl}` : '',
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
  const end = toCalendarUtcString(party.endTime);

  const detailsParts = [
    party.description.trim(),
    party.hostName ? `搞手：${party.hostName}` : '',
    shareUrl ? `活動報名及 AA 拆帳頁面：${shareUrl}` : '',
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

export function formatPartyDateTime(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
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

  const sameDay =
    !Number.isNaN(end.getTime()) &&
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (Number.isNaN(end.getTime())) {
    return `${dateFmt.format(start)} ${timeFmt.format(start)}`;
  }
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

export function buildWhatsAppInviteText(party: Party, shareUrl: string): string {
  const gcalUrl = buildGoogleCalendarUrl(party, shareUrl);
  const timeLabel = formatPartyDateTime(party.startTime, party.endTime);
  const fullLocation = formatPartyLocation(party);
  const mapQuery = [party.location?.trim(), party.address?.trim()].filter(Boolean).join(' ');
  const lines = [
    `🎉 *${party.title}*`,
    `📅 時間：${timeLabel}`,
    party.location ? `📍 地點：${party.location}` : '',
    party.address ? `🏠 地址：${party.address}` : '',
    fullLocation ? `🗺️ Google 地圖：${buildGoogleMapsUrl(mapQuery)}` : '',
    party.description ? `📝 備註：${party.description}` : '',
    '',
    `👉 撳入嚟填名 RSVP 同睇 AA 數：`,
    shareUrl,
    '',
    `🗓️ 一鍵加入 Google 日曆：`,
    gcalUrl,
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));

  return lines.join('\n');
}
