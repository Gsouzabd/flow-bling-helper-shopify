# Stage 1: build
FROM node:18-alpine AS build

# ✅ Adiciona compatibilidade com dependências nativas como rollup
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./

# ✅ Instala as dependências de forma limpa
RUN npm ci

# ✅ Força a instalação dos binários nativos opcionais (bug fix)
RUN npm rebuild

# 🔧 Garante que o remix CLI funcione
ENV PATH="./node_modules/.bin:$PATH"

COPY . .

RUN npm run build

# Stage 2: produção
FROM node:18-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.env ./

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
