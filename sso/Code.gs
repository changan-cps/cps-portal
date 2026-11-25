/**
 * CPS SSO — central login + permission service for the CPS Digital Platform portal.
 * Google Apps Script web app (Deploy ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone).
 *
 * The portal POSTs JSON ({action, ...}) as text/plain. Every answer is {ok, data} or {ok:false, code, message}.
 * Users, apps, per-app permissions and announcements live in this script's Script Properties
 * (no spreadsheet needed). Passwords are stored salted + hashed, never in clear text.
 *
 * Other apps trust the portal through short-lived signed TICKETS:
 *   ticket = base64url(JSON {u, n, app, role, exp, jti}) + "." + base64url(HMAC-SHA256(part1, SSO_SECRET))
 * An app that knows SSO_SECRET can verify a ticket without calling this service.
 * Run showSecret() from the editor to read the secret, then store it in each app's Script Properties.
 */
var SESSION_HOURS = 12;          // normal login
var REMEMBER_DAYS = 30;          // "remember me on this device"
var TICKET_SECONDS = 120;        // hand-off ticket lifetime
var APPTOKEN_HOURS = 12;         // app token lifetime (backends that check every request)
var PW_ITERATIONS = 1000;
var MAX_FAILS = 5, LOCK_SECONDS = 900;
var CHUNK = 8000;                // Script Properties allow ~9 KB per value

function doGet() { return json_({ ok: true, data: { service: 'cps-sso', setup: !load_().users.length } }); }

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ACTIONS[req.action];
    if (!fn) throw err_('BAD_REQUEST', 'Unknown action');
    out = { ok: true, data: fn(req) };
  } catch (x) {
    if (x && x.code) out = { ok: false, code: x.code, message: x.message };
    else { console.error(x && x.stack || x); out = { ok: false, code: 'SERVER', message: String(x && x.message || x) }; }
  }
  return json_(out);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message) { var e = new Error(message); e.code = code; return e; }

// ------------------------------------------------------------------ storage
function props_() { return PropertiesService.getScriptProperties(); }
function load_() {
  var p = props_(), n = Number(p.getProperty('DB_N') || 0), s = '';
  for (var i = 0; i < n; i++) s += p.getProperty('DB_' + i) || '';
  var db = s ? JSON.parse(s) : {};
  db.users = db.users || []; db.apps = db.apps || []; db.news = db.news || []; db.contact = db.contact || ''; db.rev = db.rev || 0;
  return db;
}
function save_(db) {
  db.rev = (db.rev || 0) + 1;
  var p = props_(), s = JSON.stringify(db), old = Number(p.getProperty('DB_N') || 0), n = Math.ceil(s.length / CHUNK), set = { DB_N: String(n) };
  for (var i = 0; i < n; i++) set['DB_' + i] = s.substr(i * CHUNK, CHUNK);
  p.setProperties(set);
  for (var j = n; j < old; j++) p.deleteProperty('DB_' + j);
}
function locked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function secret_() {
  var p = props_(), s = p.getProperty('SSO_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SSO_SECRET', s); }
  return s;
}
/** Run from the editor: prints the shared secret to copy into the other apps' Script Properties (SSO_SECRET). */
function showSecret() { var s = secret_(); console.log('SSO_SECRET = ' + s); return s; }

// ------------------------------------------------------------------ crypto helpers
function b64_(bytesOrString) { return Utilities.base64EncodeWebSafe(bytesOrString).replace(/=+$/, ''); }
function unb64_(s) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4))).getDataAsString('UTF-8'); }
function sign_(part) { return b64_(Utilities.computeHmacSha256Signature(part, secret_())); }
function seal_(obj) { var part = b64_(Utilities.newBlob(JSON.stringify(obj)).getBytes()); return part + '.' + sign_(part); }
function open_(token) {
  var m = /^([\w-]+)\.([\w-]+)$/.exec(String(token || ''));
  if (!m || sign_(m[1]) !== m[2]) return null;
  try { var o = JSON.parse(unb64_(m[1])); return o && o.exp > Date.now() ? o : null; } catch (e) { return null; }
}
function hashPw_(password, salt) {
  var h = Utilities.computeHmacSha256Signature(String(password), String(salt)), saltBytes = Utilities.newBlob(String(salt)).getBytes();
  for (var i = 1; i < PW_ITERATIONS; i++) h = Utilities.computeHmacSha256Signature(h, saltBytes);
  return Utilities.base64Encode(h);
}
function setPassword_(u, password) {
  password = String(password || '');
  if (password.length < 6) throw err_('VALIDATION', 'Password must be at least 6 characters');
  u.salt = Utilities.getUuid(); u.hash = hashPw_(password, u.salt); u.pv = (u.pv || 0) + 1;
}

// ------------------------------------------------------------------ users / sessions
function isAdmin_(u) { return u.role === 'admin'; }
function findUser_(db, username) {
  var n = String(username || '').trim().toLowerCase();
  for (var i = 0; i < db.users.length; i++) if (db.users[i].username.toLowerCase() === n) return db.users[i];
  return null;
}
function publicUser_(u) { return { username: u.username, name: u.name || u.username, role: u.role, apps: u.apps || [], roles: u.roles || {} }; }
function canUse_(u, app) { return isAdmin_(u) || (u.apps || []).indexOf(app.id) >= 0; }
function publicApp_(a) { var o = {}; for (var k in a) o[k] = a[k]; return o; }
function token_(u, remember) {
  var ms = remember ? REMEMBER_DAYS * 86400000 : SESSION_HOURS * 3600000;
  return seal_({ t: 's', u: u.username, pv: u.pv || 0, exp: Date.now() + ms });
}
/** Returns the signed-in user for a session token, or throws AUTH. Deleted users and old passwords are rejected. */
function session_(db, token) {
  var s = open_(token), u = s && s.t === 's' ? findUser_(db, s.u) : null;
  if (!u || (u.pv || 0) !== s.pv) throw err_('AUTH', 'Please sign in again');
  return u;
}
/** What the portal shows this user: admins get everything, others only the apps they are allowed. */
function view_(db, u) {
  var out = { user: publicUser_(u), rev: db.rev, news: db.news, contact: db.contact,
    apps: db.apps.filter(function (a) { return canUse_(u, a); }).map(publicApp_) };
  if (isAdmin_(u)) { out.users = db.users.map(publicUser_); out.locked = lockedNames_(db); }
  return out;
}
/** Usernames (lower case) currently locked out after too many wrong passwords. */
function lockedNames_(db) {
  var keys = db.users.map(function (u) { return 'fail:' + u.username.toLowerCase(); });
  var got = keys.length ? CacheService.getScriptCache().getAll(keys) : {};
  return keys.filter(function (k) { return Number(got[k] || 0) >= MAX_FAILS; }).map(function (k) { return k.slice(5); });
}
function cleanName_(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
function cleanUsername_(s) {
  var n = String(s || '').trim();
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(n)) throw err_('VALIDATION', 'Username: 2–40 characters, a-z 0-9 . _ - only');
  return n;
}
function cleanApps_(list) {
  var seen = {};
  return (Array.isArray(list) ? list : []).map(function (a) {
    var id = String(a.id || '').trim(), url = String(a.url || '').trim();
    if (!/^[a-z0-9-]{1,60}$/.test(id) || seen[id]) throw err_('VALIDATION', 'Bad or duplicate app id: ' + id);
    if (!/^https?:\/\//i.test(url)) throw err_('VALIDATION', 'App link must start with http:// or https://');
    seen[id] = true;
    return { id: id, name: String(a.name || id).slice(0, 80), url: url.slice(0, 500), desc: String(a.desc || '').slice(0, 200),
      icon: String(a.icon || '').slice(0, 8), color: String(a.color || '').slice(0, 9), kind: a.kind === 'quick' ? 'quick' : 'tile',
      server: a.server === 'factory' ? 'factory' : 'external', sso: a.sso === 'ticket' ? 'ticket' : '',
      roles: (Array.isArray(a.roles) ? a.roles : []).map(function (r) { return String(r).trim().slice(0, 30); }).filter(String).slice(0, 12) };
  });
}

// ------------------------------------------------------------------ actions
var ACTIONS = {
  status: function () { var db = load_(); return { setup: !db.users.length, contact: db.contact }; },

  /** First run only: create the first admin (optionally importing the portal's existing apps / news). */
  setup: function (r) {
    return locked_(function () {
      var db = load_();
      if (db.users.length) throw err_('FORBIDDEN', 'Already set up');
      var u = { username: cleanUsername_(r.username), name: cleanName_(r.name) || String(r.username).trim(), role: 'admin', apps: [], roles: {} };
      setPassword_(u, r.password);
      db.users.push(u);
      db.apps = cleanApps_(r.apps); db.news = (Array.isArray(r.news) ? r.news : []).map(String).slice(0, 50);
      save_(db); secret_();
      var v = view_(db, u); v.token = token_(u, !!r.remember); return v;
    });
  },

  login: function (r) {
    var db = load_(), name = String(r.username || '').trim().toLowerCase(), cache = CacheService.getScriptCache(), key = 'fail:' + name;
    var fails = Number(cache.get(key) || 0);
    if (fails >= MAX_FAILS) throw err_('LOCKED', 'Too many wrong passwords. Try again in 15 minutes.');
    var u = findUser_(db, name);
    if (!u || hashPw_(r.password, u.salt) !== u.hash) { cache.put(key, String(fails + 1), LOCK_SECONDS); throw err_('BAD_LOGIN', 'Incorrect username or password'); }
    cache.remove(key);
    var v = view_(db, u); v.token = token_(u, !!r.remember); return v;
  },

  me: function (r) { var db = load_(); return view_(db, session_(db, r.token)); },

  /** Change own display name / password. Returns a fresh token (the old one stops working after a password change). */
  profile: function (r) {
    return locked_(function () {
      var db = load_(), u = session_(db, r.token), old = open_(r.token);
      if (r.name != null) { var n = cleanName_(r.name); if (!n) throw err_('VALIDATION', 'Display name is required'); u.name = n; }
      if (r.password) setPassword_(u, r.password);
      save_(db);
      var v = view_(db, u); v.token = seal_({ t: 's', u: u.username, pv: u.pv || 0, exp: old.exp }); return v;
    });
  },

  /** Admin: replace apps, announcements and the user list (passwords only change where `pw` is given). */
  save: function (r) {
    return locked_(function () {
      var db = load_(), me = session_(db, r.token);
      if (!isAdmin_(me)) throw err_('FORBIDDEN', 'Admins only');
      if (r.rev != null && r.rev !== db.rev) throw err_('CONFLICT', 'Someone else changed the settings. Reloading.');
      var apps = cleanApps_(r.apps), ids = {}, seen = {};
      apps.forEach(function (a) { ids[a.id] = a; });
      var users = (Array.isArray(r.users) ? r.users : []).map(function (x) {
        var username = cleanUsername_(x.username), key = username.toLowerCase();
        if (seen[key]) throw err_('VALIDATION', 'Duplicate username: ' + username);
        seen[key] = true;
        var old = findUser_(db, username) || {};
        var u = { username: old.username || username, name: cleanName_(x.name) || username, role: x.role === 'admin' ? 'admin' : 'user',
          apps: (Array.isArray(x.apps) ? x.apps : []).filter(function (id, i, a) { return ids[id] && a.indexOf(id) === i; }),
          roles: {}, salt: old.salt, hash: old.hash, pv: old.pv || 0 };
        u.apps.forEach(function (id) { var want = x.roles && x.roles[id], list = ids[id].roles; if (list.length) u.roles[id] = list.indexOf(want) >= 0 ? want : list[list.length - 1]; });
        if (x.pw) { setPassword_(u, x.pw); CacheService.getScriptCache().remove('fail:' + key); }
        if (!u.hash) throw err_('VALIDATION', 'New user ' + username + ' needs a password');
        return u;
      });
      if (!users.some(isAdmin_)) throw err_('VALIDATION', 'There must be at least 1 Admin');
      if (!seen[me.username.toLowerCase()]) throw err_('VALIDATION', 'You cannot delete your own account');
      db.apps = apps; db.users = users;
      db.news = (Array.isArray(r.news) ? r.news : []).map(function (s) { return String(s).slice(0, 300); }).filter(String).slice(0, 50);
      if (r.contact != null) db.contact = String(r.contact).replace(/\s+/g, ' ').trim().slice(0, 200);
      save_(db);
      return view_(db, findUser_(db, me.username));
    });
  },

  /** Admin: lift the wrong-password lock on one user straight away. */
  unlock: function (r) {
    var db = load_(), me = session_(db, r.token);
    if (!isAdmin_(me)) throw err_('FORBIDDEN', 'Admins only');
    var name = String(r.username || '').trim().toLowerCase();
    if (!findUser_(db, name)) throw err_('VALIDATION', 'No such user');
    CacheService.getScriptCache().remove('fail:' + name);
    return view_(db, me);
  },

  /** Hand-off ticket for one app. Only issued when this user is allowed to use it. */
  ticket: function (r) {
    var db = load_(), u = session_(db, r.token);
    var app = db.apps.filter(function (a) { return a.id === r.app; })[0];
    if (!app || !canUse_(u, app)) throw err_('FORBIDDEN', 'You do not have access to this app');
    var role = (u.roles || {})[app.id] || '';
    if (!role && app.roles.length) role = isAdmin_(u) ? app.roles[0] : app.roles[app.roles.length - 1];
    return { ticket: seal_({ t: 'k', u: u.username, n: u.name || u.username, app: app.id, role: role, exp: Date.now() + TICKET_SECONDS * 1000, jti: Utilities.getUuid() }), url: app.url };
  },

  /**
   * App token for an app whose own backend must check every request (IE Digital…): like a ticket but reusable
   * until it expires. The backend verifies the signature with SSO_SECRET — no call to this service needed.
   *   base64url(JSON {t:'a', u, n, app, role, exp}) + "." + base64url(HMAC-SHA256(part1, SSO_SECRET))
   */
  apptoken: function (r) {
    var db = load_(), u = session_(db, r.token);
    var app = db.apps.filter(function (a) { return a.id === r.app; })[0];
    if (!app || !canUse_(u, app)) throw err_('FORBIDDEN', 'You do not have access to this app');
    var exp = Date.now() + APPTOKEN_HOURS * 3600000, role = (u.roles || {})[app.id] || '';
    return { apptoken: seal_({ t: 'a', u: u.username, n: u.name || u.username, app: app.id, role: role, exp: exp }), exp: exp,
      user: { username: u.username, name: u.name || u.username, role: role } };
  },

  /** For static apps on the same site (Lean Quest, IE Digital…): is this signed-in user allowed to use `app`? */
  check: function (r) {
    var db = load_(), u = session_(db, r.token);
    var app = db.apps.filter(function (a) { return a.id === r.app; })[0];
    if (!app || !canUse_(u, app)) throw err_('FORBIDDEN', 'You do not have access to this app');
    return { user: { username: u.username, name: u.name || u.username, role: (u.roles || {})[app.id] || '' } };
  }
};
