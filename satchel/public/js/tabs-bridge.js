/* Satchel tabs bridge: classic script loaded first in every app page.
 *  - Embedded in the shell (iframe named tk-tab-*): talks to the shell by postMessage.
 *  - Opened top-level: redirects into the shell so app pages always show inside the shell. */
(function () {
  'use strict';
  var embedded = false;
  try { embedded = window.parent !== window && String(window.name || '').indexOf('tk-tab-') === 0; } catch (e) { embedded = false; }

  var HOME_PATHS = ['/', '/home.html', '/almanac', '/almanac/', '/margin', '/margin/', '/ledger', '/ledger/', '/stride', '/stride/', '/tunnel', '/tunnel/'];

  function appKey() {
    var p = location.pathname;
    var keys = ['almanac', 'margin', 'ledger', 'stride', 'tunnel'];
    for (var i = 0; i < keys.length; i++) if (p.indexOf('/' + keys[i] + '/') === 0) return keys[i];
    if (p === '/account') return 'settings';
    return '';
  }

  if (!embedded) {
    try {
      var standalone = navigator.webdriver && /(^|[?&])tk-standalone=1(&|$)/.test(location.search);
      // /account also works as a page of its own (two-step sign-in setup sends people there).
      if (window.top === window && !standalone && location.pathname !== '/account') {
        location.replace('/?open=' + encodeURIComponent(location.pathname + location.search));
      }
    } catch (e) { /* ignore */ }
    window.SatchelTabs = {
      embedded: false,
      goHome: function () { location.href = '/'; },
      open: function (path) { location.href = path; },
      activate: function () { /* already the whole window */ },
      settingsChanged: function () { /* no shell to tell */ }
    };
    return;
  }

  function post(msg) {
    try {
      msg.source = 'satchel-tab';
      window.parent.postMessage(msg, location.origin);
    } catch (e) { /* ignore */ }
  }

  window.SatchelTabs = {
    embedded: true,
    goHome: function () { post({ type: 'home' }); },
    open: function (path) { post({ type: 'open', path: String(path) }); },
    // Bring this app to the front without reloading or navigating it (e.g. a reminder was clicked).
    activate: function () { post({ type: 'activate' }); },
    // Settings page only: the account name, photo or time zone changed.
    settingsChanged: function () { post({ type: 'settings' }); }
  };

  try { document.documentElement.classList.add('tk-embedded'); } catch (e) { /* ignore */ }

  // ---- navigation requested by the shell (another page of this app was opened) ----
  // Apps listen for 'satchel:navigate' and call preventDefault() to handle it in place;
  // otherwise the page simply loads the new address.
  window.addEventListener('message', function (e) {
    try {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      var msg = e.data;
      if (!msg || msg.source !== 'satchel-shell') return;
      if (msg.type === 'settings') {
        // The Satchel time zone changed in Settings: apps pick it up without reloading.
        window.dispatchEvent(new CustomEvent('satchel:settings', { detail: { timeZone: typeof msg.timeZone === 'string' ? msg.timeZone : '' } }));
        return;
      }
      if (msg.type !== 'navigate' || typeof msg.path !== 'string') return;
      var u = new URL(msg.path, location.href);
      if (u.origin !== location.origin || u.pathname.split('/')[1] !== location.pathname.split('/')[1]) return;
      var ev = new CustomEvent('satchel:navigate', { cancelable: true, detail: { path: u.pathname + u.search, params: u.searchParams } });
      if (window.dispatchEvent(ev)) location.replace(u.pathname + u.search);
    } catch (err) { /* ignore */ }
  });

  // ---- meta ----
  var lastMeta = '';
  function sendMeta() {
    try {
      var title = String(document.title || '').split(' — ')[0].trim();
      var path = location.pathname + location.search;
      var key = path + '\n' + title;
      if (key === lastMeta) return;
      lastMeta = key;
      post({ type: 'meta', app: appKey(), path: path, title: title });
    } catch (e) { /* ignore */ }
  }
  // Apps rewrite their address after acting on a link (?tab=plan&meal=…), so report those
  // changes too: the shell must remember the plain page, not a one-time action to replay.
  try {
    ['pushState', 'replaceState'].forEach(function (name) {
      var original = history[name];
      history[name] = function () { var r = original.apply(this, arguments); setTimeout(sendMeta, 0); return r; };
    });
    window.addEventListener('popstate', sendMeta);
  } catch (e) { /* ignore */ }
  document.addEventListener('DOMContentLoaded', function () {
    sendMeta();
    try {
      var obs = new MutationObserver(sendMeta);
      var t = document.querySelector('head > title');
      if (t) obs.observe(t, { childList: true, characterData: true, subtree: true });
      obs.observe(document.head, { childList: true });
    } catch (e) { /* ignore */ }
  });

  // ---- keyboard: Ctrl+Alt+1..6 jumps to Home / an app in the shell sidebar ----
  window.addEventListener('keydown', function (e) {
    try {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
      var m = /^Digit([1-6])$/.exec(e.code || '');
      if (!m) return;
      e.preventDefault();
      post({ type: 'goto', index: Number(m[1]) - 1 });
    } catch (err) { /* ignore */ }
  });

  // ---- home links ----
  document.addEventListener('click', function (e) {
    try {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || (a.target && a.target !== '_self')) return;
      var u = new URL(a.getAttribute('href'), location.href);
      if (u.origin !== location.origin) return;
      if (HOME_PATHS.indexOf(u.pathname) === -1) return;
      e.preventDefault();
      post({ type: 'home' });
    } catch (err) { /* ignore */ }
  }, true);
})();
