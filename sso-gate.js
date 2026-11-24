/* CPS SSO gate — makes an app on changan-cps.github.io usable only through the CPS Digital Platform portal.
 *
 * Put this as the FIRST script in the app's <head>:
 *   <script src="/cps-portal/sso-gate.js" data-app="ie-digital-program"></script>
 * data-app = the app's id in the portal (Settings ▸ Apps / Links).
 *
 * Modes
 *   (default)     Whole page: hidden until the CPS SSO server confirms the signed-in portal user may use the app;
 *                 otherwise the visitor is sent to the portal to sign in (and back afterwards) or sees a lock page.
 *   data-ticket   Launcher for an app on another origin (Apps Script): same check, but it also gets a 2-minute signed
 *                 ticket → window.CPS_SSO = {ticket, at, renew()} and a "cps-sso" event on document.
 *   data-token    Whole page, for an app whose own backend checks every request (IE Digital): also keeps a signed
 *                 app token. window.cpsAppToken() returns it ('' when none); window.CPS_READY resolves when the
 *                 first check is done; window.cpsGateReset() forgets the cached result.
 *   data-manual   Only parts of the app are protected (e.g. Lean Quest: trainees play freely, facilitator views are
 *                 locked). Nothing happens at load; the app calls
 *                     CPS_GATE.require().then(function (ok) { if (ok) openTheProtectedView(); })
 *                 CPS_GATE.ok is true once a check has passed.
 *
 * Does nothing until the portal has SSO switched on (cps-portal/sso.json), so it is safe to ship early.
 * Note: this is a client-side lock on a public site. It stops ordinary visitors; it is not a substitute
 * for server-side checks on anything confidential.
 */
(function () {
  'use strict';
  var script = document.currentScript, app = script.getAttribute('data-app');
  // data-admin-app: a page whose admin view is "#admin" on the same file is checked as that app instead
  if (location.hash === '#admin' && script.getAttribute('data-admin-app')) app = script.getAttribute('data-admin-app');
  var wantTicket = script.hasAttribute('data-ticket'), manual = script.hasAttribute('data-manual'), wantToken = script.hasAttribute('data-token');
  var portal = new URL('.', script.src).href;                       // …/cps-portal/
  var TOKEN_KEY = 'cpsPortal.sso', OK_KEY = 'cpsGate.ok.' + app, OK_MS = 10 * 60 * 1000, GRACE_MS = 7 * 24 * 3600 * 1000;
  var ssoUrl = '';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function last() { try { return JSON.parse(get(OK_KEY)) || {}; } catch (e) { return {}; } }
  function tokenOk(s) { return !wantToken || (!!s.tok && s.exp > Date.now() + 5 * 60000); }
  window.cpsAppToken = function () { var s = last(); return s.t === get(TOKEN_KEY) && s.tok && s.exp > Date.now() ? s.tok : ''; };
  window.cpsGateReset = function () { try { localStorage.removeItem(OK_KEY); } catch (e) { /* ignore */ } };
  function toPortal() { location.replace(portal + '?next=' + encodeURIComponent(location.href)); }
  function post(action) {
    return fetch(ssoUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: get(TOKEN_KEY), app: app }) })
      .then(function (r) { return r.json(); });
  }

  /** Resolves {status: 'ok' | 'off' | 'auth' | 'forbidden' | 'offline', ticket?}. 'off' = SSO not switched on. */
  function check() {
    var token = get(TOKEN_KEY), seen = last();
    // checked a moment ago with this same sign-in: don't make every page load wait for the server
    if (!wantTicket && token && seen.t === token && Date.now() - seen.at < OK_MS && tokenOk(seen)) return Promise.resolve({ status: 'ok' });
    return fetch(portal + 'sso.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }, function () { return undefined; })
      .then(function (cfg) {
        if (cfg === null || (cfg && !/^https?:\/\//.test(cfg.url || ''))) return { status: 'off' };
        if (cfg === undefined) throw new Error('offline');
        ssoUrl = cfg.url;
        if (!token) return { status: 'auth' };
        return post(wantTicket ? 'ticket' : wantToken ? 'apptoken' : 'check').then(function (j) {
          if (j.ok) { set(OK_KEY, JSON.stringify({ t: token, at: Date.now(), tok: j.data.apptoken, exp: j.data.exp })); window.CPS_USER = j.data.user; return { status: 'ok', ticket: j.data.ticket }; }
          if (j.code === 'AUTH') { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } return { status: 'auth' }; }
          if (j.code === 'FORBIDDEN') return { status: 'forbidden' };
          throw new Error(j.message || j.code);
        });
      })
      .catch(function () {
        // server unreachable: someone verified on this device in the last 7 days may keep working (e.g. flaky Wi-Fi on the line)
        return { status: !wantTicket && token && seen.t === token && Date.now() - seen.at < GRACE_MS && (!wantToken || seen.exp > Date.now()) ? 'ok' : 'offline' };
      });
  }

  var TEXT = {
    forbidden: ['ไม่มีสิทธิ์ใช้ส่วนนี้ · No access', 'ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ใน CPS Digital Platform · 请联系管理员开通权限'],
    offline: ['เชื่อมต่อไม่ได้ · Cannot connect', 'ตรวจอินเทอร์เน็ตแล้วเปิดใหม่ผ่าน CPS Digital Platform · 请检查网络后重试']
  };
  /** Lock screen. replace=true takes over the page; otherwise it is an overlay that can be closed. */
  function lock(kind, replace) {
    var draw = function () {
      var box = document.createElement('div');
      box.setAttribute('role', 'alertdialog');
      box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#f2f5f9;color:#132238;font:16px/1.6 "Segoe UI","Leelawadee UI","Microsoft YaHei",sans-serif;text-align:center;padding:24px';
      box.innerHTML = '<div style="max-width:420px;background:#fff;border:1px solid #d6dee9;border-radius:16px;padding:28px 24px">' +
        '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#00467f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
        '<h1 style="font-size:21px;margin:8px 0;color:#00467f"></h1><p style="margin:0 0 18px;color:#4f5f76"></p>' +
        '<a style="display:inline-flex;align-items:center;min-height:48px;background:#00467f;color:#fff;font-weight:700;padding:0 22px;border-radius:8px;text-decoration:none">CPS Digital Platform</a>' +
        (replace ? '' : ' <button type="button" style="margin-left:8px;min-height:48px;background:#fff;border:1px solid #7a8aa0;color:inherit;padding:0 18px;border-radius:8px;font:inherit;cursor:pointer">ปิด · Close</button>') + '</div>';
      box.querySelector('h1').textContent = TEXT[kind][0];
      var contact = ''; try { contact = localStorage.getItem('cpsPortal.contact') || ''; } catch (e) {}
      box.querySelector('p').textContent = TEXT[kind][1] + (contact ? ' · ' + contact : '');
      box.querySelector('a').href = portal;
      if (replace) document.body.innerHTML = ''; else box.querySelector('button').onclick = function () { box.remove(); };
      document.body.appendChild(box);
    };
    if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw);
  }

  // ---------------------------------------------------------------- manual mode: the app decides what to protect
  if (manual) {
    var pending = null;
    window.CPS_GATE = {
      ok: false,
      require: function () {
        if (window.CPS_GATE.ok) return Promise.resolve(true);
        if (!pending) pending = check().then(function (r) {
          pending = null;
          if (r.status === 'ok' || r.status === 'off') { window.CPS_GATE.ok = true; return true; }
          if (r.status === 'auth') toPortal(); else lock(r.status, false);
          return false;
        });
        return pending;
      }
    };
    return;
  }

  // ---------------------------------------------------------------- whole page (and launcher) mode
  var hide = document.createElement('style');
  hide.textContent = 'html{visibility:hidden!important}';
  document.documentElement.appendChild(hide);
  function show() { if (hide.parentNode) hide.parentNode.removeChild(hide); }

  window.CPS_READY = check().then(function (r) {
    if (r.status === 'auth') { toPortal(); return; }
    if (r.status === 'forbidden' || r.status === 'offline') { lock(r.status, true); show(); return; }
    show();
    if (wantTicket) {
      // CPS_SSO.renew() → Promise of a fresh ticket (tickets expire; ask again right before opening the app)
      window.CPS_SSO = { ticket: r.ticket || null, at: Date.now(), renew: function () {
        if (!ssoUrl) return Promise.resolve(null);
        return post('ticket').then(function (j) { if (!j.ok && j.code === 'AUTH') toPortal(); return j.ok ? j.data.ticket : null; }, function () { return null; });
      } };
      document.dispatchEvent(new CustomEvent('cps-sso'));
    }
  });
})();
