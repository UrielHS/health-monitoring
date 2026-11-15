# Construir desde la raíz del repo: docker build -f apps/server/Dockerfile .
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
# install y no ci: si alguien agregó una dependencia y no actualizó el package-lock, la imagen igual se construye.
RUN npm install --workspace @astro/server --include-workspace-root --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npx -w @astro/server prisma generate

WORKDIR /app/apps/server
ENV NODE_ENV=production
EXPOSE 3000
# db push crea o actualiza las tablas al arrancar (suficiente para el prototipo).
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx src/index.ts"]
