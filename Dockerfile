FROM node:20-bookworm-slim

WORKDIR /app

COPY mimo-backend/package*.json ./
RUN npm ci --omit=dev

COPY mimo-backend/api ./api

EXPOSE 3000

CMD ["node", "api/server.js"]