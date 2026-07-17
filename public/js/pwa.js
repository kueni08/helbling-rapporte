'use strict';

(() => {
  const installButtons = [...document.querySelectorAll('[data-pwa-install]')];
  let installPrompt = null;
  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const setInstallVisible = visible => installButtons.forEach(button => { button.hidden = !visible; });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (!isInstalled()) setInstallVisible(true);
  });

  installButtons.forEach(button => button.addEventListener('click', async () => {
      if (!installPrompt) return;
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      setInstallVisible(false);
    }));

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    setInstallVisible(false);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
})();
