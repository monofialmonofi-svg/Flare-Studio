export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const badRequest = (code, message, extra) => new HttpError(400, code, message, extra);
export const unauthorized = (message = 'يجب تسجيل الدخول أولًا') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'ليست لديك صلاحية لتنفيذ هذا الإجراء') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'غير موجود') => new HttpError(404, 'not_found', message);
export const conflict = (code, message) => new HttpError(409, code, message);
export const tooMany = (message = 'محاولات كثيرة، حاول لاحقًا', extra) => new HttpError(429, 'rate_limited', message, extra);

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
