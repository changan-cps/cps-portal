'use strict';
// Run: node --test sso/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createSim } = require('../sim');

const APPS = [
  { id: 'lean-quest', name: 'Lean Quest', url: 'https://changan-cps.github.io/lean-quest/' },
  { id: 'cps-pjo-audit', name: 'CPS PJO Audit', url: 'https://changan-cps.github.io/cps-pjo-audit/', sso: 'ticket', roles: ['admin', 'auditor', 'viewer'] },
];
function boot() {
  const sim = createSim();
  const ok = (action, data) => { const r = sim.post(action, data); assert.ok(r.ok, action + ': ' + JSON.stringify(r)); return r.data; };
  const fail = (action, data, code) => { const r = sim.post(action, data); assert.equal(r.ok, false, action); assert.equal(r.code, code, JSON.stringify(r)); };
  const admin = ok('setup', { username: 'boss', name: 'Boss', password: 'secret1', apps: APPS, news: ['hello'] });
  return { sim, ok, fail, admin };
}
const users = extra => [{ username: 'boss', name: 'Boss', role: 'admin' }].concat(extra);

test('setup runs once and signs the admin in', () => {
  const { sim, ok, fail, admin } = boot();
  assert.equal(sim.post('status').data.setup, false);
  assert.equal(admin.user.role, 'admin');
  assert.equal(admin.apps.length, 2);
  assert.equal(admin.users.length, 1);
  assert.deepEqual(admin.news, ['hello']);
  fail('setup', { username: 'x2', password: 'secret1' }, 'FORBIDDEN');
  assert.equal(ok('me', { token: admin.token }).user.username, 'boss');
  assert.ok(!JSON.stringify(admin).includes('hash'), 'no password hash leaves the server');
});

test('login: wrong password, lock-out, case-insensitive username', () => {
  const { sim, ok, fail } = boot();
  assert.equal(ok('login', { username: 'BOSS', password: 'secret1' }).user.username, 'boss');
  for (let i = 0; i < 5; i++) fail('login', { username: 'boss', password: 'nope' }, 'BAD_LOGIN');
  fail('login', { username: 'boss', password: 'secret1' }, 'LOCKED');
  sim.cache.clear();
  ok('login', { username: 'boss', password: 'secret1' });
  fail('login', { username: 'ghost', password: 'secret1' }, 'BAD_LOGIN');
});

test('non-admin sees only granted apps and cannot save', () => {
  const { ok, fail, admin } = boot();
  const saved = ok('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: users([
    { username: 'somchai', name: 'Somchai', role: 'user', apps: ['cps-pjo-audit', 'nope'], roles: { 'cps-pjo-audit': 'auditor' }, pw: 'pass123' }]) });
  assert.equal(saved.users.length, 2);
  const s = ok('login', { username: 'somchai', password: 'pass123' });
  assert.deepEqual(s.apps.map(a => a.id), ['cps-pjo-audit']);
  assert.equal(s.users, undefined, 'user list is admin-only');
  assert.deepEqual(s.user.roles, { 'cps-pjo-audit': 'auditor' });
  fail('save', { token: s.token, apps: [], news: [], users: users([]) }, 'FORBIDDEN');
  fail('ticket', { token: s.token, app: 'lean-quest' }, 'FORBIDDEN');
  fail('check', { token: s.token, app: 'lean-quest' }, 'FORBIDDEN');
  assert.equal(ok('check', { token: s.token, app: 'cps-pjo-audit' }).user.role, 'auditor');
});

test('save: validation and stale revision', () => {
  const { ok, fail, admin } = boot();
  fail('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: users([{ username: 'new', role: 'user' }]) }, 'VALIDATION'); // no password
  fail('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: [{ username: 'boss', role: 'user' }] }, 'VALIDATION');       // no admin left
  fail('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: [{ username: 'other', role: 'admin', pw: 'pass123' }] }, 'VALIDATION'); // deleted self
  fail('save', { token: admin.token, rev: admin.rev, apps: [{ id: 'x', url: 'javascript:alert(1)' }], news: [], users: users([]) }, 'VALIDATION');
  const v = ok('save', { token: admin.token, rev: admin.rev, apps: APPS, news: ['a', ''], users: users([]) });
  assert.deepEqual(v.news, ['a']);
  fail('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: users([]) }, 'CONFLICT');
  ok('login', { username: 'boss', password: 'secret1' });   // password untouched by save without pw
});

test('ticket is signed, short-lived and carries the portal role', () => {
  const { sim, ok, admin } = boot();
  const v = ok('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: users([
    { username: 'viewer1', role: 'user', apps: ['cps-pjo-audit'], pw: 'pass123' }]) });
  assert.equal(v.users[1].roles['cps-pjo-audit'], 'viewer', 'defaults to the least-privileged (last) role');
  const s = ok('login', { username: 'viewer1', password: 'pass123' });
  const { ticket, url } = ok('ticket', { token: s.token, app: 'cps-pjo-audit' });
  assert.equal(url, APPS[1].url);
  const [part, sig] = ticket.split('.');
  const expect = crypto.createHmac('sha256', sim.run('showSecret')).update(part).digest('base64url');
  assert.equal(sig, expect, 'apps can verify with plain HMAC-SHA256 + the shared secret');
  const p = JSON.parse(Buffer.from(part, 'base64url').toString());
  assert.equal(p.u, 'viewer1'); assert.equal(p.app, 'cps-pjo-audit'); assert.equal(p.role, 'viewer'); assert.equal(p.t, 'k');
  assert.ok(p.exp - Date.now() <= 120000 && p.exp > Date.now());
  // admin gets the first (highest) role by default; a ticket is not a session
  const a = JSON.parse(Buffer.from(ok('ticket', { token: admin.token, app: 'cps-pjo-audit' }).ticket.split('.')[0], 'base64url').toString());
  assert.equal(a.role, 'admin');
  assert.equal(sim.post('me', { token: ticket }).code, 'AUTH');
});

test('tampered tokens, password change and deleted users are rejected', () => {
  const { sim, ok, fail, admin } = boot();
  const [part, sig] = admin.token.split('.');
  const forged = Buffer.from(JSON.stringify({ t: 's', u: 'boss', pv: 1, exp: Date.now() + 1e9 })).toString('base64url');
  fail('me', { token: forged + '.' + sig }, 'AUTH');
  fail('me', { token: part + '.AAAA' }, 'AUTH');
  fail('me', { token: '' }, 'AUTH');
  const v = ok('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: users([{ username: 'tmp', role: 'user', pw: 'pass123' }]) });
  const t = ok('login', { username: 'tmp', password: 'pass123' });
  const p = ok('profile', { token: t.token, name: '  New   Name ', password: 'newpass1' });
  assert.equal(p.user.name, 'New Name');
  fail('me', { token: t.token }, 'AUTH');                      // old token dies with the old password
  ok('me', { token: p.token });
  fail('login', { username: 'tmp', password: 'pass123' }, 'BAD_LOGIN');
  ok('login', { username: 'tmp', password: 'newpass1' });
  const now = ok('me', { token: admin.token });
  ok('save', { token: admin.token, rev: now.rev, apps: APPS, news: [], users: users([]) });   // delete tmp
  fail('me', { token: p.token }, 'AUTH');
  assert.ok(v.rev < now.rev);
});

test('large data is split across properties', () => {
  const { sim, ok, admin } = boot();
  const many = users(Array.from({ length: 150 }, (_, i) => ({ username: 'user' + i, name: 'ผู้ใช้ทดสอบ ' + i, role: 'user', apps: ['lean-quest'], pw: 'pass123' })));
  const v = ok('save', { token: admin.token, rev: admin.rev, apps: APPS, news: [], users: many });
  assert.equal(v.users.length, 151);
  assert.ok(Number(sim.props.DB_N) > 1);
  assert.equal(ok('login', { username: 'user149', password: 'pass123' }).user.name, 'ผู้ใช้ทดสอบ 149');
});
