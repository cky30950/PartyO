/* eslint-disable no-undef */
// PartyO Web Push / Firebase Cloud Messaging background notification handler

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'PartyO 活動提醒', body: event.data.text() } };
  }

  const notif = payload.notification || {};
  const data = payload.data || {};
  const title = notif.title || data.title || 'PartyO 活動提醒';
  const body = notif.body || data.body || '你報名的派對快要開始了！';
  const url =
    (payload.fcmOptions && payload.fcmOptions.link) ||
    data.url ||
    (data.partyId ? `./?p=${encodeURIComponent(data.partyId)}` : './');

  const options = {
    body,
    icon: notif.icon || './icon.svg',
    badge: './icon.svg',
    tag: data.tag || (data.partyId ? `partyo-${data.partyId}` : 'partyo-reminder'),
    renotify: true,
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const resolvedUrl = new URL(targetUrl, self.registration.scope).href;
      for (const client of clientList) {
        if (client.url === resolvedUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(resolvedUrl);
      }
      return undefined;
    })
  );
});
