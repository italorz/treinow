# Treinow

PWA de treinos com React/TypeScript, API e worker em Go, PostgreSQL 16, Redis e armazenamento de vídeos compatível com S3. Os jobs usam River no PostgreSQL; sessões e limites de acesso continuam no Redis.

## Início rápido

1. Execute `npm install` e `npm run setup` para gerar a configuração local e o catálogo.
2. Configure o acesso ao armazenamento de vídeos no `.env`.
3. Use `compose.yaml` no Coolify e associe um domínio ao serviço `web`.

Consulte [o backend Go](apps/api-go/README.md) para variáveis de ambiente, execução e testes isolados. O código Python foi preservado como referência de migração e rollback, mas não é executado na imagem atual.

O catálogo é criado localmente a partir de `packages/acervo-videos/catalogo/videos_identificados.csv` e dos arquivos em `packages/acervo-videos/HD/Sem categoria/`; nenhum vídeo é enviado a serviços de IA.
