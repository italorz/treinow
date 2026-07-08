# syntax=docker/dockerfile:1

# ---- Estágio 1: compilar assets (Vite + Tailwind + Alpine) ----
FROM node:20-alpine AS assets
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

# ---- Estágio 2: runtime PHP (FrankenPHP) ----
FROM dunglas/frankenphp:1-php8.4 AS app
WORKDIR /app

RUN install-php-extensions pdo_sqlite intl zip opcache

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Código da aplicação (subpasta app/ do repositório)
COPY app/ /app
# Assets compilados no estágio anterior
COPY --from=assets /app/public/build /app/public/build

# .env base — o Coolify sobrescreve via variáveis de ambiente
RUN cp -n .env.example .env || true

RUN composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist

# SQLite + permissões de escrita
RUN mkdir -p database storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache \
    && touch database/database.sqlite \
    && chmod -R 777 storage bootstrap/cache database

COPY Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint && chmod +x /usr/local/bin/entrypoint

ENV APP_ENV=production
ENV APP_DEBUG=false
EXPOSE 80
ENTRYPOINT ["entrypoint"]
