FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci --no-fund
COPY frontend/tsconfig.json frontend/index.html ./
COPY frontend/src ./src
RUN npm run build

FROM docker.io/library/nginx:stable-alpine
COPY deploy/frontend-nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
