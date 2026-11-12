# ---------- etapa 1: compila o TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- etapa 2: imagem final, só com o necessário para rodar ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

# não roda como root
USER node
EXPOSE 3000

# o /health consulta os serviços de trás, por isso o timeout é mais folgado
HEALTHCHECK --interval=30s --timeout=15s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["node", "dist/main.js"]
