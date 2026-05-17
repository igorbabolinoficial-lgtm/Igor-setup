FROM node:22-alpine

WORKDIR /app

# better-sqlite3 precisa de build tools nativos (gyp + Python). Removidas após build pra imagem menor.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && ln -sf python3 /usr/bin/python

# Instala deps do server principal — força --omit=dev mesmo se NODE_ENV vier setado
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Build do subprojeto 3D escritorio/ (Sala dos Agentes)
COPY escritorio/package.json escritorio/package-lock.json* ./escritorio/
RUN cd escritorio && npm install --include=dev --no-audit --no-fund

# Build do subprojeto 3D showcase/ (vitrine pública de imóveis)
COPY showcase/package.json showcase/package-lock.json* ./showcase/
RUN cd showcase && npm install --include=dev --no-audit --no-fund

# Copia código
COPY . .

# Builds: gera public/escritorio/ e public/showcase/. Apaga node_modules dos subs pra encolher.
RUN cd escritorio && npm run build && rm -rf node_modules
RUN cd showcase   && npm run build && rm -rf node_modules

# Remove deps de build pra encolher imagem
RUN apk del .build-deps

ENV NODE_ENV=production
ENV PORT=3003
ENV DB_PATH=/data/igor.db
# Cérebro Obsidian vai dentro do repo em /app/cerebro (DNA dos prompts em prod)
ENV OBSIDIAN_PATH=/app/cerebro
# Fotos dos imóveis no volume persistente (não no container, pra não perder em redeploy)
ENV ASSETS_DIR=/data/assets/imoveis

# Cria diretório /data pra montagem de volume Coolify (preserva o banco entre redeploys)
RUN mkdir -p /data

EXPOSE 3003

VOLUME ["/data"]

# Coolify usa pra detectar app travado e fazer restart automatico
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3003/api/saude || exit 1

CMD ["node", "server.js"]
