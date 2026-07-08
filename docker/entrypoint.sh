#!/bin/sh
set -e
cd /app

# Gera APP_KEY se não vier por variável de ambiente nem estiver no .env
if [ -z "${APP_KEY}" ]; then
	if ! grep -q '^APP_KEY=base64:' .env 2>/dev/null; then
		php artisan key:generate --force
	fi
fi

php artisan config:clear || true

# Cria o arquivo SQLite se não existir (ex.: primeiro boot com volume vazio)
[ -f database/database.sqlite ] || touch database/database.sqlite

# Migrações
php artisan migrate --force

# Importa exercícios e popula a semana de exemplo apenas se o banco estiver vazio
COUNT=$(php artisan tinker --execute="echo App\\Models\\Exercise::count();" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ "${COUNT:-0}" = "0" ]; then
	echo ">> Importando exercicios e populando a semana..."
	php artisan exercises:import
	php artisan db:seed --force
fi

exec frankenphp run --config /etc/caddy/Caddyfile
