/* CPS SSO gate — makes a static app on changan-cps.github.io usable only through the CPS Digital Platform portal.
 *
 * Put this as the FIRST script in the app's <head>:
 *   <script src="/cps-portal/sso-gate.js" data-app="lean-quest"></script>
 * data-app = the app's id in the portal (Settings ▸ Apps / Links).
 *
 * What it does: hides the page, asks the CPS SSO server whether the person signed in to the portal
 * may use this app, then shows the page — or sends them to the portal to sign in (and back afterwards).
 * Does nothing until the portal has SSO switched on (cps-portal/sso.json), so it is safe to ship early.
 *
 * Note: this is a client-side lock on a public site. It stops ordinary visitors; it is not a substitute
 * for server-side checks on anything confidential.
 */
(function () {
  'use strict';
  var script = document.currentScript, app = script.getAttribute('data-app');
  // data-admin-app: a page whose admin view is "#admin" on the same file (Lean Quest) is checked as that app instead
  if (location.hash === '#admin' && script.getAttribute('data-admin-app')) app = script.getAttribute('data-admin-app');
  var portal = new URL('.', script.src).href;                       // …/cps-portal/
  var TOKEN_KEY = 'cpsPortal.sso', OK_KEY = 'cpsGate.ok.' + app, OK_MS = 10 * 60 * 1000, GRACE_MS = 7 * 24 * 3600 * 1000;
  var hide = document.createElement('style');
  hide.textContent = 'html{visibility:hidden!important}';
  document.documentElement.appendChild(hide);

  // data-ticket: this page is a launcher for an app on another origin (Apps Script). Instead of a yes/no check it
  // gets a 2-minute signed ticket and announces it: window.CPS_SSO = {ticket} + a "cps-sso" event on document.
  // CPS_SSO.renew() → Promise of a fresh ticket (tickets expire; ask again right before opening the app).
  var wantTicket = script.hasAttribute('data-ticket'), ssoUrl = '';
  function askTicket() {
    return fetch(ssoUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ticket', token: get(TOKEN_KEY), app: app }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok && j.code === 'AUTH') toPortal(); return j.ok ? j.data.ticket : null; });
  }
  function show(ticket) {
    if (hide.parentNode) hide.parentNode.removeChild(hide);
    if (wantTicket && !window.CPS_SSO) {
      window.CPS_SSO = { ticket: ticket || null, at: Date.now(),
        renew: function () { return ssoUrl ? askTicket().catch(function () { return null; }) : Promise.resolve(null); } };
      document.dispatchEvent(new CustomEvent('cps-sso'));
    }
  }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function toPortal() { location.replace(portal + '?next=' + encodeURIComponent(location.href)); }
  function block(title, text) {
    var draw = function () {
      document.body.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#06132b;color:#eaf1ff;font:16px/1.6 \'Segoe UI\',sans-serif;text-align:center;padding:24px">' +
        '<div><div style="font-size:44px">🔒</div><h1 style="font-size:22px;margin:8px 0"></h1><p style="margin:0 0 18px;opacity:.85"></p>' +
        '<a style="display:inline-block;background:#3b9bff;color:#04122b;font-weight:700;padding:10px 22px;border-radius:8px;text-decoration:none">CPS Digital Platform</a></div></div>';
      document.querySelector('h1').textContent = title; document.querySelector('p').textContent = text;
      document.querySelector('a').href = portal;
      wantTicket = false;          // blocked: no ticket, and the launcher must not start the app
      show();
    };
    if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw);
  }
  function last() { try { return JSON.parse(get(OK_KEY)) || {}; } catch (e) { return {}; } }

  var token = get(TOKEN_KEY), seen = last();
  // checked a moment ago with this same sign-in: don't make every page load wait for the server
  if (!wantTicket && token && seen.t === token && Date.now() - seen.at < OK_MS) { show(); return; }

  fetch(portal + 'sso.json?_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; }, function () { return undefined; })
    .then(function (cfg) {
      if (cfg === null || (cfg && !/^https?:\/\//.test(cfg.url || ''))) { show(); return; }     // SSO not switched on yet
      if (cfg === undefined) throw new Error('offline');
      ssoUrl = cfg.url;
      if (!token) { toPortal(); return; }
      return fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: wantTicket ? 'ticket' : 'check', token: token, app: app }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { set(OK_KEY, JSON.stringify({ t: token, at: Date.now() })); window.CPS_USER = j.data.user; show(j.data.ticket); }
          else if (j.code === 'AUTH') { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } toPortal(); }
          else if (j.code === 'FORBIDDEN') block('ไม่มีสิทธิ์ใช้แอปนี้ · No access', 'ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ใน CPS Digital Platform · 请联系管理员开通权限');
          else throw new Error(j.message || j.code);
        });
    })
    .catch(function () {
      // server unreachable: someone verified on this device in the last 7 days may keep working (e.g. flaky Wi-Fi on the line)
      if (!wantTicket && token && seen.t === token && Date.now() - seen.at < GRACE_MS) show();
      else block('เชื่อมต่อไม่ได้ · Cannot connect', 'ตรวจอินเทอร์เน็ตแล้วเปิดใหม่ผ่าน CPS Digital Platform · 请检查网络后重试');
    });
})();
