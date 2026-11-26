FROM node:26-slim

WORKDIR /backend

COPY backend/package*.json ./

RUN npm ci --omit=dev

COPY backend/ ./

COPY frontend/modules/ /frontend/modules/
