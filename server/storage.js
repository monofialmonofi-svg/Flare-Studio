// طبقة التخزين: ملفات الوسائط لا تُخزَّن في قاعدة البيانات أبدًا، فقط مفاتيحها.
// التنفيذ الحالي: قرص محلي. للإنتاج على نطاق واسع: نفّذ نفس الواجهة على S3/R2 وضع CDN أمامه
// (يكفي ضبط MEDIA_BASE_URL على عنوان الـCDN).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { randomHex } from './util.js';

export const mediaRoot = path.join(config.dataDir, 'media');
export const tmpRoot = path.join(config.dataDir, 'tmp');
await fs.mkdir(mediaRoot, { recursive: true });
await fs.mkdir(tmpRoot, { recursive: true });

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]*$/;
function abs(key) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error('invalid storage key');
  return path.join(mediaRoot, key);
}

export const newKey = (prefix) => {
  const id = randomHex(16);
  return `${prefix}/${id.slice(0, 2)}/${id}`;
};
export const tmpPath = (ext = '') => path.join(tmpRoot, randomHex(12) + ext);

export const storage = {
  url: (key) => (key ? `${config.mediaBaseUrl}/${key}` : null),
  async putBuffer(key, buf) {
    const p = abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const part = `${p}.${randomHex(4)}.part`;
    await fs.writeFile(part, buf);
    await fs.rename(part, p);
    return buf.length;
  },
  async putFile(key, src) {
    const p = abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    try {
      await fs.rename(src, p);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fs.copyFile(src, p);
      await fs.unlink(src);
    }
    return (await fs.stat(p)).size;
  },
  async remove(key) {
    if (!key) return;
    await fs.rm(abs(key), { force: true });
  },
  async removeMany(keys) {
    await Promise.all(keys.filter(Boolean).map((k) => storage.remove(k).catch(() => {})));
  },
};

export async function cleanupTmp(files = []) {
  await Promise.all(files.map((f) => fs.rm(f.path ?? f, { force: true }).catch(() => {})));
}
