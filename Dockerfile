# LAMMA | لَمّة — صورة الإنتاج (Railway أو أي منصة حاويات)
FROM node:22-bookworm-slim

# ffmpeg/ffprobe لمعالجة الفيديو؛ ca-certificates لاتصالات SMTP/HTTPS
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1

WORKDIR /app

# الاعتماديات أولًا للاستفادة من كاش الطبقات (sharp يأتي بملفات جاهزة لـ linux/glibc)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# مجلد البيانات (قاعدة البيانات + الوسائط). على Railway اربطه بـ Volume على المسار /data
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server/index.js"]
