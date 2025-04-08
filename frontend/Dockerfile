FROM node:latest AS build

WORKDIR /dist/src/app

RUN npm cache clean --force
COPY ./frontend/ .
COPY ./env/.env .env

RUN npm install --legacy-peer-deps
RUN npm run build

FROM nginx:latest AS ng

COPY --from=build /dist/src/app/fe/browser /usr/share/nginx/html/lissy
COPY ./frontend/nginx.conf  /etc/nginx/conf.d/default.conf