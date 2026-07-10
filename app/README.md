# Treinow

PWA de treinos multi-tenant com React, Fastify, MongoDB, Redis/BullMQ e MinIO. Os datasets dos gráficos são agregados pelo worker Node.js e servidos pelo Fastify.

## Início rápido

1. Copie `.env.example` para `.env` e gere segredos fortes.
2. Execute `npm install && npm run catalog`.
3. Execute `docker compose up --build`.
4. Abra `http://localhost:8080`.

O catálogo é criado localmente a partir de `videos/`; nenhum vídeo é enviado a serviços de IA.
