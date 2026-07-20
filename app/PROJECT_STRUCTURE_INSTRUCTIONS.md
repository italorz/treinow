# Instruções reutilizáveis para novos projetos

Use este documento como blueprint para criar outro produto com assunto, marca e regras de negócio diferentes, mas mantendo a arquitetura operacional deste projeto. O novo projeto deve ser independente, porém preparado para executar na mesma VPS sem colisões de portas, nomes, volumes, bancos, buckets ou variáveis de ambiente.

## 1. Princípios

- Preserve a separação entre frontend, backend, contratos compartilhados e scripts.
- Não reutilize nomes, textos, entidades, coleções, buckets ou segredos do projeto de origem.
- Escolha um `project-slug` único, em minúsculas, usando apenas letras, números e hífens. Exemplo: `novo-produto`.
- Use o mesmo stack-base: Python 3.12+ (FastAPI, backend), React + TypeScript + Vite (frontend), PostgreSQL (SQLAlchemy async + Alembic), Redis/arq, MinIO e Docker Compose.
- Mantenha o backend stateless; sessões, filas, arquivos e dados devem ficar nos serviços apropriados.
- Variáveis sensíveis devem existir apenas no `.env` da implantação. O repositório deve conter somente `.env.example` sem segredos reais.

## 2. Estrutura obrigatória

```text
<project-slug>/
├─ apps/
│  ├─ api/
│  │  ├─ app/
│  │  │  ├─ main.py          # cria o FastAPI app: middlewares, routers, /health
│  │  │  ├─ worker.py        # workers arq (filas) e jobs assíncronos
│  │  │  ├─ config.py        # validação das variáveis com pydantic-settings
│  │  │  ├─ db.py            # engine/Session async (SQLAlchemy), Redis, MinIO
│  │  │  ├─ models.py        # ORM (SQLAlchemy) — modelo de persistência
│  │  │  ├─ schemas/         # Pydantic público (contratos de request/response)
│  │  │  ├─ routers/         # rotas HTTP por domínio
│  │  │  └─ validators.py    # regras de validação de negócio (espelha o TS do front)
│  │  ├─ alembic/            # migrations do schema Postgres
│  │  ├─ tests/              # pytest (unitário + integração via testcontainers)
│  │  ├─ Dockerfile
│  │  └─ pyproject.toml
│  └─ web/
│     ├─ src/
│     │  ├─ main.tsx
│     │  ├─ shell.tsx
│     │  ├─ api.ts
│     │  ├─ pages/
│     │  └─ styles.css
│     ├─ public/
│     ├─ Dockerfile
│     ├─ nginx.conf
│     ├─ package.json
│     └─ vite.config.ts
├─ packages/
│  └─ contracts/
│     ├─ src/index.ts        # schemas/tipos e validadores — consumidos só pelo frontend
│     ├─ package.json
│     └─ tsconfig.json
├─ scripts/                  # importação, seed, validação e tarefas auxiliares
├─ catalog/                  # somente se o produto tiver catálogo/dataset
├─ public-assets/             # assets estáticos específicos do novo produto
├─ compose.yaml
├─ package.json               # workspaces só de packages/contracts e apps/web
├─ package-lock.json
├─ .env.example
├─ .gitignore
├─ .dockerignore
└─ README.md
```

`apps/api` é um projeto Python autônomo (gerenciado com `uv` + `pyproject.toml`), não faz parte dos workspaces npm — o `package.json` raiz lista só `apps/web` e `packages/contracts`:

```json
{
  "private": true,
  "type": "module",
  "workspaces": ["apps/web", "packages/contracts"]
}
```

Use nomes de pacotes com o mesmo slug para o que continua em TypeScript, por exemplo `@novo-produto/web` e `@novo-produto/contracts` (o nome do pacote Python em `apps/api/pyproject.toml` segue a mesma convenção: `novo-produto-api`). Atualize também todos os imports internos, comandos de build e referências nos Dockerfiles.

## 3. Responsabilidade de cada camada

### `apps/web`

- React + TypeScript + Vite como PWA quando fizer sentido.
- Acesso à API concentrado em `src/api.ts`.
- Rotas e telas organizadas em `src/pages/`.
- Em produção, gerar arquivos estáticos e servi-los com Nginx.
- O Nginx deve encaminhar `/v1/` e `/health` para `http://api:3000` dentro da rede Docker e usar fallback para `index.html`.

### `apps/api`

- FastAPI/uvicorn escutando em `0.0.0.0`, gerenciado com `uv` (`pyproject.toml` + `uv.lock`).
- `app/config.py` deve validar todas as variáveis com `pydantic-settings` antes de iniciar.
- `app/main.py` deve expor `/health`, documentação automática (`/docs`) e endpoints versionados em `/v1/`.
- `app/worker.py` deve conter somente processamento assíncrono: jobs `arq` (fila Redis), imports, notificações, geração de dados e tarefas demoradas. Cron recorrente vai em `cron_jobs` do próprio worker (sem depender de cron do SO).
- Coloque regras de domínio em módulos próprios (`app/*.py`) e cubra-as com `pytest`; use `testcontainers` para testes de integração que dependem de Postgres real (constraints, cascades).
- Use sessão + CSRF (double-submit cookie) para mutações via navegador, rate limiting (`slowapi`), headers de segurança equivalentes ao Helmet, autorização por tenant quando necessário, e logs sem senhas, tokens ou dados sensíveis.
- Separe sempre o modelo de persistência (`app/models.py`, SQLAlchemy) do schema público de resposta (`app/schemas/`, Pydantic) via uma camada de `app/mappers.py` — nunca serialize o modelo ORM diretamente, para não vazar campos sensíveis (hashes, segredos cifrados).
- Cifra de segredos em repouso (`app/security.py`): AES-256-GCM (`cryptography`); hash de senha: `hashlib.scrypt` (parâmetros explícitos — não confie nos defaults do SO/versão do Python).

### `packages/contracts`

- Centralize schemas Zod, tipos, formatos de request/response e os **validadores de negócio** (CPF, telefone, etc.) usados pelo **frontend**.
- Como o backend agora é Python (não há mais um único runtime TypeScript compartilhado entre api e web), os mesmos validadores de negócio precisam ter uma réplica manual em `apps/api/app/validators.py`. Qualquer mudança de regra (ex.: algoritmo de validação de um documento) deve ser replicada nos dois arquivos — não existe mais um pacote de contratos compartilhado em runtime entre front e back, só o formato JSON (mantido idêntico) via o schema Pydantic (`app/schemas/`) espelhando `packages/contracts/src/index.ts` schema a schema.
- O contrato TS deve ser compilado antes do frontend.

## 4. Compose e serviços

O `compose.yaml` deve manter estes serviços, salvo se o novo produto realmente não precisar de algum deles:

| Serviço | Função | Porta interna | Publicar no host? |
|---|---|---:|---|
| `web` | frontend/Nginx | 80 | Não; publicar somente pelo proxy reverso |
| `api` | API FastAPI/uvicorn | 3000 | Não |
| `worker` | jobs `arq` | — | Não |
| `postgres` | banco PostgreSQL | 5432 | Não |
| `redis` | Redis persistente para filas/sessões | 6379 | Não |
| `minio` | armazenamento S3 compatível | 9000 | Não |
| `minio` | console administrativo | 9001 | Não, salvo necessidade explícita |

Regras do Compose:

- Não use `container_name`; deixe o Compose gerar nomes isolados.
- Defina um nome exclusivo para o projeto Compose, por exemplo `name: <project-slug>`.
- Use volumes nomeados exclusivos, como `<project-slug>-postgres-data`, `<project-slug>-redis-data` e `<project-slug>-minio-data`.
- Use uma rede interna própria do projeto e não conecte serviços de projetos diferentes.
- Mantenha `restart: unless-stopped`, healthchecks e `depends_on` condicionado à saúde dos serviços.
- API e worker podem usar o mesmo Dockerfile de produção, mas devem ter comandos de inicialização diferentes (`uvicorn app.main:app ...` vs `python -m app.worker`). Rode as migrations (`alembic upgrade head`) antes de subir o `uvicorn`, por exemplo com `command: sh -c "alembic upgrade head && uvicorn ..."` no serviço `api`; o `worker` deve depender da saúde do `api` para nunca rodar antes das migrations.
- Use `read_only: true` e `tmpfs` quando compatível com a aplicação.
- O serviço `web` deve depender da saúde da API; API e worker devem depender da saúde de PostgreSQL, Redis e MinIO.
- A imagem `python:3.12-slim` não tem `wget`/`curl` — o healthcheck do `api` deve usar a stdlib: `["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:3000/health')"]`.

## 5. Política de portas para a mesma VPS

A opção preferencial é publicar apenas o frontend através do proxy reverso da VPS/Coolify e manter todos os serviços do Compose sem `ports:`. `expose:` não publica uma porta no host; ele apenas documenta a porta disponível na rede Docker.

Se for indispensável publicar portas diretamente no host, reserve um bloco exclusivo para cada projeto e registre-o no README. Nunca reutilize a mesma porta entre projetos. Exemplo:

```yaml
services:
  web:
    ports: ["18080:80"]
  # api, mongo, redis e minio continuam sem ports por padrão
```

Não publique MongoDB, Redis ou MinIO na internet. Caso a API precise ser acessada diretamente, use uma porta externa exclusiva, como `13001:3000`, e restrinja-a por firewall. A porta interna da API continua sendo `3000`; somente a porta do host deve variar.

Além de portas, isole obrigatoriamente:

- domínio/subdomínio e configuração do proxy reverso;
- nome do projeto Compose e nomes dos volumes;
- `DATABASE_URL`, incluindo o nome do banco Postgres;
- senha e URL do Redis;
- credenciais e bucket do MinIO;
- nomes de filas `arq`, se houver workers dos dois projetos na mesma infraestrutura;
- chaves de sessão, CSRF, JWT e webhooks;
- diretórios de backup e logs.

Antes do deploy, confira:

```bash
docker compose -p <project-slug> config
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -ltnp
```

O segundo comando deve confirmar que nenhuma porta externa escolhida já está ocupada.

## 6. Variáveis de ambiente

Comece o `.env.example` com os nomes abaixo e adapte o conteúdo ao produto:

```dotenv
APP_ENV=production
PUBLIC_URL=https://<dominio-do-projeto>
PORT=3000
DATABASE_URL=postgresql+asyncpg://<usuario>:<senha>@postgres:5432/<project_slug>
POSTGRES_DB=<project_slug>
POSTGRES_USER=<usuario>
POSTGRES_PASSWORD=<senha>
REDIS_URL=redis://:<senha>@redis:6379
SESSION_SECRET=<segredo-com-pelo-menos-32-caracteres>
CSRF_SECRET=<segredo-com-pelo-menos-32-caracteres>
ENCRYPTION_KEY=<32-bytes-em-hexadecimal-64-chars>
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=<credencial-exclusiva>
MINIO_SECRET_KEY=<segredo-exclusivo>
MINIO_BUCKET=<project-slug>-assets
```

Use valores exclusivos por projeto. Não copie o `.env` de outro projeto e não commite tokens, senhas, chaves de API ou credenciais do proxy/Coolify.

## 7. Scripts e fluxo de desenvolvimento

O `package.json` raiz deve oferecer, no mínimo (a API é Python — os scripts de `build`/`test` do backend chamam `uv`, não `npm`):

```json
{
  "scripts": {
    "build": "npm run build -w @<slug>/contracts && npm run build -w @<slug>/web",
    "test": "npm run test -w @<slug>/web",
    "test:api": "cd apps/api && uv run pytest",
    "setup": "node scripts/create-dev-env.mjs",
    "dev:api": "cd apps/api && uv run uvicorn app.main:app --reload",
    "dev:worker": "cd apps/api && uv run python -m app.worker",
    "dev:web": "npm run dev -w @<slug>/web"
  }
}
```

Fluxo esperado:

1. Copiar `.env.example` para `.env` e gerar segredos locais.
2. Instalar dependências com `npm install` (frontend/contracts) e `uv sync` dentro de `apps/api` (backend).
3. Executar scripts de seed/importação, quando existirem.
4. Rodar `npm run test`, `npm run test:api` e `npm run build`; dentro de `apps/api`, `uv run alembic upgrade head` contra um Postgres local antes de testar manualmente.
5. Validar `docker compose config`.
6. Subir com `docker compose -p <project-slug> up -d --build`.
7. Verificar `/health`, logs, filas e persistência após reiniciar os containers.

## 8. Deploy na VPS

- Crie um diretório e um projeto Compose separados para cada produto.
- Configure o domínio do novo projeto no proxy reverso apontando para o serviço `web` na porta interna 80.
- Não aponte o domínio para a API diretamente, salvo necessidade documentada.
- Garanta que o proxy injete HTTPS e que `PUBLIC_URL` use o domínio HTTPS final.
- Faça backup separado dos três volumes persistentes.
- Atualize por projeto (`docker compose -p <project-slug> pull/build/up`), sem derrubar os demais projetos.
- Depois do deploy, teste login, uma operação que grava no PostgreSQL, um job `arq`, acesso a arquivo no MinIO e o endpoint `/health`.

## 9. Critérios de aceite

O novo projeto só está pronto quando:

- a estrutura de pastas e workspaces estiver presente;
- não houver referências acidentais ao nome ou domínio do projeto de origem;
- `npm run test`, `npm run build` e `uv run pytest` (dentro de `apps/api`) passarem;
- o Compose for válido e os healthchecks ficarem saudáveis;
- o frontend acessar a API pelo proxy sem CORS desnecessário;
- os dados sobreviverem a `docker compose down` seguido de `up`;
- nenhum serviço interno estiver exposto publicamente sem justificativa;
- portas, volumes, banco, bucket, domínio e segredos estiverem exclusivos do novo projeto;
- README e `.env.example` documentarem o deploy e o rollback.
API para deploy do projeto:
          "type": "http",
          "url": "http://89.117.72.98:8000/mcp",
          "headers": {
            "Authorization": "Bearer <TOKEN-DE-DEPLOY-REDIGIDO>"

