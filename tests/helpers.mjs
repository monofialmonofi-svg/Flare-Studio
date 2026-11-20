import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');

export async function startServer(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamma-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const fullEnv = {
    ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', SIGNUP_LIMIT_PER_HOUR: '1000',
    UPLOAD_LIMIT_PER_HOUR: '1000', NODE_NO_WARNINGS: '1', ...env,
  };
  const proc = spawn('node', ['server/index.js'], { cwd: root, env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error('server did not start\n' + log);
  }
  const sql = () => new DatabaseSync(path.join(dataDir, 'lamma.db'));
  return {
    base, dataDir, port, env: fullEnv, log: () => log, sql,
    outbox: (to) => { const d = sql(); const rows = d.prepare('SELECT * FROM outbox WHERE to_email = ? ORDER BY id').all(to); d.close(); return rows; },
    lastToken: (to) => {
      const body = [...fakeOutboxFor(sql, to)].pop()?.body ?? '';
      return /token=([\w-]+)/.exec(body)?.[1];
    },
    stop: async () => { proc.kill('SIGTERM'); await new Promise((r) => proc.once('exit', r)); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}
function fakeOutboxFor(sql, to) { const d = sql(); const rows = d.prepare('SELECT * FROM outbox WHERE to_email = ? ORDER BY id').all(to); d.close(); return rows; }

export class Client {
  constructor(base, headers = {}) { this.base = base; this.cookie = ''; this.headers = headers; }
  async req(method, url, { json, form, headers = {} } = {}) {
    const h = { ...this.headers, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)) this.cookie = '';
      else this.cookie = pair;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers, res };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, json, o) { return this.req('POST', u, { json, ...o }); }
  patch(u, json) { return this.req('PATCH', u, { json }); }
  del(u, json) { return this.req('DELETE', u, { json }); }
  upload(url, fields, files, method = 'POST') {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields || {})) form.append(k, v);
    for (const f of files) form.append(f.field ?? 'files', new Blob([f.buffer], { type: f.type }), f.name);
    return this.req(method, url, { form });
  }
}

let counter = 0;
export async function newUser(server, name, extra = {}) {
  const c = new Client(server.base);
  const n = name ?? `user${++counter}`;
  const email = `${n}@example.com`;
  const r = await c.post('/api/auth/signup', { email, username: n, displayName: `اسم ${n}`, password: 'secret123', ...extra });
  if (r.status !== 201) throw new Error('signup failed ' + JSON.stringify(r.data));
  c.user = r.data.user; c.email = email; c.username = n;
  return c;
}

export async function makeAdmin(server, email) {
  execFileSync('node', ['server/cli/make-admin.js', email], { cwd: root, env: server.env, stdio: 'pipe' });
}

// ---------- ملفات اختبار ----------
export async function jpeg(width = 1200, height = 800, seed = 1) {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 31 + seed * 17 + ((i / 3) | 0) % 255) & 255;
  return sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}
export async function jpegWithOrientation(width, height, orientation = 6) {
  return sharp({ create: { width, height, channels: 3, background: '#7a3cff' } }).withMetadata({ orientation }).jpeg().toBuffer();
}
export async function noisyPng(w, h) {
  const b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return sharp(b, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

export function makeVideo({ w = 360, h = 640, seconds = 2, vcodec = 'libx264', ext = 'mp4', audio = true } = {}) {
  const out = path.join(os.tmpdir(), `lamma-vid-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${w}x${h}:rate=25`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  args.push('-c:v', vcodec);
  if (vcodec === 'libx264') args.push('-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', ext === 'mkv' ? 'libvorbis' : 'aac', '-shortest');
  args.push(out);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
  const buf = fs.readFileSync(out);
  fs.rmSync(out);
  return buf;
}
