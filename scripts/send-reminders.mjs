import admin from 'firebase-admin';

const SERVICE_ACCOUNT_RAW = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  'https://cheungec-ea477-default-rtdb.firebaseio.com';
const APP_BASE_URL = (process.env.PARTYO_APP_URL || '').trim().replace(/\/?$/, '/');
const TIMEZONE_OFFSET = process.env.PARTY_TIMEZONE_OFFSET || '+08:00';

if (!SERVICE_ACCOUNT_RAW) {
  console.error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT_JSON，無法執行推送檢查。');
  process.exit(1);
}

const serviceAccount = JSON.parse(SERVICE_ACCOUNT_RAW);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL,
});

const db = admin.database();
const messaging = admin.messaging();

/**
 * 解析派對本地時間字串（例如 "2026-12-25T19:00"），在 UTC 環境下補上香港時區 +08:00
 */
function parsePartyStartTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const hasExplicitTz = /([zZ]|[+-]\d{2}:\d{2})$/.test(trimmed);
  const isoCandidate = hasExplicitTz ? trimmed : `${trimmed}${TIMEZONE_OFFSET}`;
  const d = new Date(isoCandidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalTime(date) {
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

const REMINDER_WINDOWS = [
  {
    key: 'h24',
    label: '明日開局提醒',
    minHoursBefore: 2.5,
    maxHoursBefore: 24.5,
    buildTitle: (party) => `⏰ 明天開局：${party.title}`,
    buildBody: (party, startDate) => {
      const timeText = formatLocalTime(startDate);
      const loc = party.location ? ` · ${party.location}` : '';
      return `距離活動開始不到 24 小時（${timeText}${loc}），記得準時出席！`;
    },
  },
  {
    key: 'h2',
    label: '即將開局提醒',
    minHoursBefore: -0.1,
    maxHoursBefore: 2.5,
    buildTitle: (party) => `🎉 2 小時內開局：${party.title}`,
    buildBody: (party, startDate) => {
      const timeText = formatLocalTime(startDate);
      const loc = party.location ? `地點：${party.location}` : '點擊查看活動詳情與地圖';
      return `${timeText} 開始，${loc}`;
    },
  },
];

async function run() {
  const now = new Date();
  const [partiesSnap, tokensSnap, sentSnap] = await Promise.all([
    db.ref('parties').once('value'),
    db.ref('partyPushTokens').once('value'),
    db.ref('partyRemindersSent').once('value'),
  ]);

  const parties = partiesSnap.val() || {};
  const allTokens = tokensSnap.val() || {};
  const allSent = sentSnap.val() || {};

  let totalSentCount = 0;

  for (const [partyId, party] of Object.entries(parties)) {
    if (!party || party.manuallyEnded) continue;

    const startDate = parsePartyStartTime(party.startTime);
    if (!startDate) continue;

    const hoursUntilStart = (startDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntilStart < -0.5 || hoursUntilStart > 25) continue;

    const partyTokensMap = allTokens[partyId] || {};
    const tokenEntries = Object.entries(partyTokensMap).filter(
      ([, rec]) => rec && typeof rec.token === 'string' && rec.token.trim().length > 0
    );
    if (tokenEntries.length === 0) continue;

    const sentForParty = allSent[partyId] || {};

    for (const win of REMINDER_WINDOWS) {
      if (sentForParty[win.key]) continue;
      if (hoursUntilStart > win.maxHoursBefore || hoursUntilStart <= win.minHoursBefore) {
        continue;
      }

      const title = win.buildTitle(party);
      const body = win.buildBody(party, startDate);
      const linkUrl = APP_BASE_URL
        ? `${APP_BASE_URL}?p=${encodeURIComponent(partyId)}`
        : `./?p=${encodeURIComponent(partyId)}`;

      const tokens = tokenEntries.map(([, rec]) => rec.token);

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: {
          partyId,
          title,
          body,
          url: linkUrl,
          tag: `partyo-${partyId}-${win.key}`,
        },
        webpush: {
          notification: {
            title,
            body,
            icon: APP_BASE_URL ? `${APP_BASE_URL}icon.svg` : './icon.svg',
            badge: APP_BASE_URL ? `${APP_BASE_URL}icon.svg` : './icon.svg',
          },
          ...(APP_BASE_URL ? { fcmOptions: { link: linkUrl } } : {}),
        },
      });

      console.log(
        `[${win.label}] ${party.title} (${partyId}): 成功 ${response.successCount} / 失敗 ${response.failureCount}`
      );

      // 自動清理失效的裝置 Token
      const cleanupTasks = [];
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          const code = res.error?.code || '';
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            const [uid] = tokenEntries[idx];
            cleanupTasks.push(db.ref(`partyPushTokens/${partyId}/${uid}`).remove());
          }
        }
      });
      if (cleanupTasks.length > 0) {
        await Promise.all(cleanupTasks);
        console.log(`已清理 ${cleanupTasks.length} 個失效的推送 Token`);
      }

      if (response.successCount > 0) {
        totalSentCount += response.successCount;
        await db.ref(`partyRemindersSent/${partyId}/${win.key}`).set(now.toISOString());
      }
    }
  }

  console.log(`推送檢查完成，共發送 ${totalSentCount} 則手機提醒。`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('執行推送提醒腳本失敗：', err);
    process.exit(1);
  });
