FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
EXPOSE 3000
# Les migrations sont appliquées avant le démarrage (elles sont additives).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
