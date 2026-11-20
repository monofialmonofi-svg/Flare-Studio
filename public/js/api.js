import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

async function parse(res) {
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code || 'error', e?.message || t('حدث خطأ غير متوقع'), e);
  }
  return data;
}

export async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api${url}`, opts); } catch { throw new ApiError(0, 'network', t('تعذّر الاتصال بالخادم. تحقق من الإنترنت')); }
  return parse(res);
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const del = (u, b) => api('DELETE', u, b);

/** رفع ملفات مع تقدّم (XHR لأن fetch لا يعرض تقدّم الرفع). */
export function upload(url, fields, files, { onProgress, method = 'POST', signal } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields || {})) form.append(k, v);
    for (const f of files) form.append(f.field || 'files', f.file, f.file.name);
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${url}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.upload.onload = () => onProgress?.(1, 'processing');
    xhr.onerror = () => reject(new ApiError(0, 'network', t('انقطع الاتصال أثناء الرفع')));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', t('أُلغي الرفع')));
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const e = data?.error;
      reject(new ApiError(xhr.status, e?.code || 'error', e?.message || t('تعذّر رفع الملف'), e));
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}
