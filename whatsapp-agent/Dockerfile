FROM node:22-alpine

WORKDIR /app

# ffmpeg pra converter MP3 (ElevenLabs) -> OGG/Opus (WhatsApp PTT)
RUN apk add --no-cache ffmpeg

# better-sqlite3 precisa de build tools nativos
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && ln -sf python3 /usr/bin/python

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Remove deps de build pra encolher imagem
RUN apk del .build-deps

# Volume pro SQLite local persistir entre redeploys
RUN mkdir -p /data
ENV DB_PATH=/data/wa-agent.db

EXPOSE 3030

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3030/health || exit 1

CMD ["node", "server.js"]
