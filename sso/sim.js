'use strict';
// Local stand-in for Google Apps Script so sso/Code.gs can be tested with Node.
//   node sso/sim.js [port]   → serves the SSO API on http://localhost:<port>/ (default 8124), data in memory
//   require('./sim').createSim() → { post(action, data), run(fnName), props }
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');

const toBuf = v => Buffer.isBuffer(v) ? v : Array.isArray(v) ? Buffer.from(v.map(b => (b + 256) % 256)) : Buffer.from(String(v), 'utf8');
const toBytes = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));   // Apps Script bytes are signed

function createSim() {
  const props = {}, cache = new Map();
  const ctx = {
    console, JSON, Date, Math, Number, String, Array, Object, Error, RegExp,
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (value, key) => toBytes(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64Encode: v => toBuf(v).toString('base64'),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toBytes(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: v => ({ getBytes: () => toBytes(toBuf(v)), getDataAsString: () => toBuf(v).toString('utf8') }),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      setProperties: o => { for (const k in o) { if (String(o[k]).length > 9000) throw new Error('property too large'); props[k] = String(o[k]); } },
      deleteProperty: k => { delete props[k]; },
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; },
      put: (k, v, sec) => cache.set(k, { v: String(v), exp: Date.now() + (sec || 600) * 1000 }),
      remove: k => cache.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  const raw = body => JSON.parse(ctx.doPost({ postData: { contents: body } }).text);
  return {
    props, cache, ctx,
    raw,
    post: (action, data) => raw(JSON.stringify(Object.assign({ action }, data))),
    run: (name, ...a) => ctx[name](...a),
  };
}
module.exports = { createSim };

if (require.main === module) {
  const sim = createSim(), port = Number(process.argv[2]) || 8124;
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'POST') { res.end(JSON.stringify({ ok: true, data: { service: 'cps-sso (sim)' } })); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(sim.raw(body))); });
  }).listen(port, () => console.log('CPS SSO sim on http://localhost:' + port + '/  secret=' + sim.run('showSecret')));
}
