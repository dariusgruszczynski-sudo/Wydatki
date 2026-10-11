FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY lib ./lib
COPY routes ./routes
COPY data ./data
COPY public ./public

ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
