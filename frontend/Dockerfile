FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_ENABLE_DEVELOPMENT_AUTH=false
ENV VITE_ENABLE_DEVELOPMENT_AUTH=$VITE_ENABLE_DEVELOPMENT_AUTH
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
