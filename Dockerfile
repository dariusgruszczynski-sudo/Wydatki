FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instalacja zależności (tylko express) — osobna warstwa dla lepszego cache.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Kod aplikacji
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Dane trzymamy w wolumenie, żeby przetrwały restart/przebudowę.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

# Prosty healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3000/api/auth/status >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
