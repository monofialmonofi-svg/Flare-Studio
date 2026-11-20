import { createApp, startMaintenance } from './app.js';
import { config } from './config.js';

const app = createApp();
await startMaintenance();
const server = app.listen(config.port, () => {
  console.log(`LAMMA | لَمّة يعمل على ${config.appUrl}  (${config.isProd ? 'production' : 'development'})`);
});
// الرفع الكبير يحتاج وقتًا (معالجة الفيديو متزامنة داخل الطلب في هذه النسخة)
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 60 * 1000;

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
