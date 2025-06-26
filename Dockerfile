# Stage 1: build
FROM node:18-alpine AS build

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

# Stage 2: produção
FROM node:18-alpine

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules

# ✅ Adicione estas linhas
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.env ./

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
