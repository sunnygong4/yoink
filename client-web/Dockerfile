FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY client-web/package*.json ./
RUN npm ci

COPY client-web/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY client-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
