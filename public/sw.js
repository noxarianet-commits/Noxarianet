// Service Worker for NoxariaNet Wallet system notifications & WebView Push
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

let lastPushTime = 0;
let lastPushContent = '';

// Push Notification Event Listener (FCM / Web Push / Android WebView Push)
self.addEventListener('push', (event) => {
  let data = { title: 'NoxariaNet Wallet', body: 'Pemberitahuan transaksi baru!' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const now = Date.now();
  const contentKey = `${data.title || ''}:${data.body || ''}`;
  if (now - lastPushTime < 5000 || contentKey === lastPushContent) {
    console.log('[SW Push] Anti-spam active. Ignoring duplicate push notification.');
    return;
  }
  lastPushTime = now;
  lastPushContent = contentKey;
  setTimeout(() => { if (lastPushContent === contentKey) lastPushContent = ''; }, 5000);

  const options = {
    body: data.body || 'Ada pembaruan status transaksi pada akun Anda.',
    icon: data.icon || '/loading screen noxa.png',
    badge: '/loading screen noxa.png',
    vibrate: [200, 100, 200],
    tag: 'noxa-single-notification',
    renotify: false,
    data: {
      url: data.url || '/'
    }
  };

  const promiseChain = self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  }).then((windowClients) => {
    let isForeground = false;
    for (let i = 0; i < windowClients.length; i++) {
      const client = windowClients[i];
      if (client.focused || client.visibilityState === 'visible') {
        isForeground = true;
        break;
      }
    }
    // Only trigger system card if user is NOT currently inside the active app
    if (!isForeground) {
      return self.registration.showNotification(data.title || 'NoxariaNet Wallet', options);
    }
  });

  event.waitUntil(promiseChain);
});

// Notification Click Event Listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
