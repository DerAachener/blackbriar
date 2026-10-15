# Die Oberfläche wird auf der Maschine gebaut, die das Image baut; das Ergebnis ist für jede Plattform gleich
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
# Kurzcode des Commits, aus dem das Image gebaut ist; steht in der App neben der Versionsnummer
ARG GIT_SHA=
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787 \
    APP_COMMIT=$GIT_SHA
COPY package*.json CHANGELOG.md ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 8787
CMD ["node", "server/index.ts"]
