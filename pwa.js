'use strict';

/* PWA installation and update handling for the GitHub Pages subpath. */
(function () {
  const card = document.getElementById('install-card');
  const installButton = document.getElementById('install-button');
  const iosButton = document.getElementById('ios-install-button');
  const dismissButton = document.getElementById('install-dismiss');
  const help = document.getElementById('install-help');
  if (!card || !installButton || !iosButton || !dismissButton || !help) return;

  let installPrompt = null;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function showCard() {
    if (!isStandalone && sessionStorage.getItem('lb_install_dismissed') !== '1') {
      card.hidden = false;
    }
  }

  function showIOSHelp() {
    help.textContent = 'In Safari, tap the Share button, scroll down, choose “Add to Home Screen”, then tap “Add”.';
    help.hidden = false;
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function (error) {
        console.warn('Service worker registration failed:', error);
      });
    });
  }

  if (isStandalone) return;

  if (isIOS) {
    iosButton.hidden = false;
    iosButton.addEventListener('click', showIOSHelp);
    showCard();
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
    showCard();
  });

  installButton.addEventListener('click', async function () {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
    card.hidden = true;
  });

  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    card.hidden = true;
  });

  dismissButton.addEventListener('click', function () {
    sessionStorage.setItem('lb_install_dismissed', '1');
    card.hidden = true;
  });
})();
