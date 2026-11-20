import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { tmpRoot, tmpPath } from './storage.js';
import path from 'node:path';

const diskStorage = multer.diskStorage({
  destination: tmpRoot,
  filename: (req, file, cb) => cb(null, path.basename(tmpPath())),
});

const make = (limits, accept) =>
  multer({
    storage: diskStorage,
    limits: { fileSize: limits.fileSize, files: limits.files, fields: 20, fieldSize: 64 * 1024, parts: 40 },
    fileFilter: (req, file, cb) => {
      // الفحص الحقيقي لمحتوى الملف يتم لاحقًا في media.js؛ هذا مجرد فلتر أولي.
      if (!accept.some((p) => file.mimetype.startsWith(p))) {
        return cb(new HttpError(400, 'bad_file_type', 'نوع الملف غير مسموح'));
      }
      cb(null, true);
    },
  });

export const postUpload = make(
  { fileSize: config.limits.videoBytes, files: config.limits.maxImagesPerPost },
  ['image/', 'video/'],
).array('files', config.limits.maxImagesPerPost);

export const singleImageUpload = make({ fileSize: config.limits.avatarBytes, files: 1 }, ['image/']).single('file');

export function multerErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: [413, 'file_too_large', 'حجم الملف أكبر من المسموح'],
      LIMIT_FILE_COUNT: [400, 'too_many_files', `الحد الأقصى ${config.limits.maxImagesPerPost} ملفات`],
      LIMIT_UNEXPECTED_FILE: [400, 'bad_field', 'حقل ملفات غير متوقع'],
    };
    const [s, c, m] = map[err.code] || [400, 'upload_error', 'تعذّر رفع الملف'];
    return next(new HttpError(s, c, m));
  }
  next(err);
}
