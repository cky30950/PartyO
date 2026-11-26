import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';

// 主動檢查 PWA 新版本：每次切回前景或每 5 分鐘檢查一次，發現新版立即切換並自動重整
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });
      window.addEventListener('online', checkForUpdate);
      window.setInterval(checkForUpdate, 5 * 60 * 1000);
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster position="top-center" toastOptions={{ className: 'rpg-toast' }} />
    <App />
  </StrictMode>
);
