# Guia de erros — migração Node/Fastify/MongoDB → Python/FastAPI/PostgreSQL

Registro dos problemas reais enfrentados ao reescrever o backend do jus-claude e cortar a
produção para a nova stack. Serve como checklist para os próximos projetos que seguirem o
mesmo blueprint (`PROJECT_STRUCTURE_INSTRUCTIONS.md`).

---

## 1. Build quebrado por referência cruzada entre Dockerfiles

**Sintoma:** `docker compose build` falhou no serviço `web` com
`"/apps/api/package.json": not found`, mesmo o Dockerfile do `api` estando correto.

**Causa:** `apps/web/Dockerfile` copiava `apps/api/package.json` (resquício de quando `apps/api`
era workspace npm) só para o `npm install` da raiz resolver os workspaces. Ao remover o
`package.json` da API (agora projeto Python), essa linha ficou órfã.

**Fix:** remover a linha `COPY apps/api/package.json apps/api/` do Dockerfile do `web`.

**Lição:** ao remover um workspace npm, `grep -rn "apps/api/package.json"` (ou equivalente) em
**todos** os Dockerfiles do monorepo, não só no dele próprio — dependências cruzadas de build
context são fáceis de esquecer. Rode `docker compose build` (todos os serviços, não só o que
mudou) antes de fazer push, não só o serviço que você editou.

---

## 2. `python:3.12-slim` não tem `wget`/`curl`

**Sintoma:** healthcheck do serviço `api` sempre falhava (`exec: "wget": not found`) mesmo com a
aplicação respondendo normalmente.

**Causa:** Dockerfiles Node costumam usar `wget -qO- http://.../health` no healthcheck; a imagem
`python:3.12-slim` (Debian slim) não inclui `wget` nem `curl` por padrão, e instalá-los via `apt`
infla a imagem à toa.

**Fix:** usar a stdlib do próprio Python no healthcheck:
```yaml
test: ["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:3000/health')"]
```

---

## 3. Symlink Linux (`lib64 -> lib`) quebra o `.venv` montado em host Windows

**Sintoma:** `uv sync` local (Windows) passou a falhar com
`failed to remove file '.venv\lib64': Acesso negado` depois de eu ter rodado um container Linux
com um bind-mount do repositório para testar algo pontualmente.

**Causa:** um container Linux criou `.venv/lib64` como symlink relativo (`lib64 -> lib`, prática
comum de venvs Python no Linux) dentro do `.venv` que estava bind-mounted no host Windows. NTFS
não lida bem com esse tipo de link criado por um processo Linux, e ferramentas Windows (inclusive
o próprio `uv`) não conseguem apagá-lo depois.

**Fix:** `rm -f .venv/lib64` manualmente (Git Bash consegue remover, mesmo o Windows Explorer não
conseguindo) e rodar `uv sync` de novo.

**Lição:** evite rodar containers Linux com bind-mount direto no `.venv` de um checkout Windows.
Se precisar de um ambiente Linux para depurar, prefira copiar o projeto para dentro do container
(`COPY`) em vez de montar o `.venv` do host.

---

## 4. Git Bash "engole" paths em `docker run -v`/`-w` (Windows)

**Sintoma:** `docker run -w /repo/apps/api ...` falhava com
`the working directory 'C:/Program Files/Git/repo/apps/api' is invalid`.

**Causa:** o Git Bash (MSYS2) reescreve automaticamente argumentos que parecem paths Unix
(`/repo/...`) para paths Windows antes de passá-los ao Docker — quebra qualquer path que deveria
ser interpretado *dentro* do container Linux.

**Fix:** prefixar o comando com `MSYS_NO_PATHCONV=1` (desliga a reescrita para aquele comando).

```bash
MSYS_NO_PATHCONV=1 docker run --rm --network minha-rede -v "/c/projeto:/repo" -w /repo/apps/api ...
```

---

## 5. `RequestValidationError` do FastAPI não é serializável em JSON (Pydantic v2)

**Sintoma:** `TypeError: Object of type ValueError is not JSON serializable` ao devolver erros de
validação — o handler de erro customizado quebrava tentando montar a própria resposta de erro.

**Causa:** em Pydantic v2, `exc.errors()` inclui um campo `ctx` que pode conter a **instância da
exceção Python original** (não uma string), e `json.dumps` puro não sabe serializar isso.

**Fix:** usar `fastapi.encoders.jsonable_encoder` com um encoder customizado para `Exception`:
```python
from fastapi.encoders import jsonable_encoder
detalhes = jsonable_encoder(exc.errors(), exclude={"input"}, custom_encoder={Exception: str})
```

---

## 6. Timestamps gravados sem timezone (Postgres `timestamp` em vez de `timestamptz`)

**Sintoma:** a migration gerada pelo Alembic criou colunas `TIMESTAMP` (sem timezone) em vez de
`TIMESTAMPTZ`, mesmo o código Python usando `datetime.now(timezone.utc)` (timezone-aware) em
todo lugar.

**Causa:** SQLAlchemy, ao inferir o tipo de coluna a partir da anotação Python `datetime`, usa
`DateTime()` (sem timezone) por padrão — a informação de timezone do valor em runtime não afeta
o DDL gerado.

**Fix:** declarar explicitamente no `Base`:
```python
class Base(DeclarativeBase):
    type_annotation_map = {datetime: DateTime(timezone=True)}
```
Isso vale para **todas** as colunas `Mapped[datetime]` do projeto de uma vez, sem precisar anotar
cada `mapped_column()` individualmente.

---

## 7. `pytest-asyncio` + fixture `session`-scoped (testcontainers) = `RuntimeError: attached to a different loop`

**Sintoma:** testes de integração com um Postgres efêmero via `testcontainers` funcionavam
isoladamente, mas falhavam em bateria com `attached to a different loop` ou
`cannot perform operation: another operation is in progress`.

**Causa:** o modo padrão do `pytest-asyncio` cria um **novo event loop por teste** (escopo
`function`), mas a *engine* async do SQLAlchemy (e a conexão `asyncpg` por trás dela) foi criada
uma única vez num fixture `scope="session"` — conexões async não podem ser reaproveitadas entre
event loops diferentes.

**Fix:** alinhar o escopo do loop ao escopo da fixture, em `pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
```

---

## 8. `alembic upgrade head` exige *todas* as variáveis de ambiente da aplicação, não só `DATABASE_URL`

**Sintoma:** rodar `alembic upgrade head` isoladamente (ex.: só com `DATABASE_URL` setada) falha
com `ValidationError` pedindo `REDIS_URL`, `SESSION_SECRET`, etc.

**Causa:** `alembic/env.py` importa `app.config.load_config()` para pegar a URL do banco, e esse
`Config` (Pydantic Settings) valida **o schema inteiro** de uma vez — não dá para carregar só um
campo.

**Fix:** não é bug, é esperado — mas documente isso: qualquer ambiente que rode `alembic upgrade
head` (incluindo o serviço `migrate` do compose) precisa do `.env`/`env_file` completo, não só de
`DATABASE_URL`.

---

## 9. Cifra/hash com formato compatível ao runtime antigo — o item mais crítico

**Contexto:** ao trocar a linguagem do backend com **dados de produção já cifrados** (senhas,
tokens de API), o formato de cifra/hash precisa bater **byte a byte** com o runtime antigo, senão
usuários reais ficam bloqueados sem erro óbvio (scrypt sempre "funciona", só devolve hash
diferente).

**O que garantiu que funcionasse:**
- Gerar vetores fixos (IV/salt **fixos**, não aleatórios) a partir do código Node antigo
  (`createCipheriv`, `scryptSync`) *antes* de apagar aquele código.
- Escrever um teste Python que decifra/verifica esses vetores fixos com a implementação nova —
  se esse teste passa, qualquer dado real já cifrado continua válido.
- Reproduzir os parâmetros exatos do scrypt do Node (`N=16384, r=8, p=1`, que são os defaults do
  `crypto.scryptSync` do Node, não os defaults do `hashlib.scrypt` do Python — é preciso passá-los
  explicitamente).
- `cryptography.hazmat...AESGCM.encrypt()` devolve `ciphertext || tag` concatenados; o formato
  antigo (`iv-hex:tag-hex:ciphertext-hex`) guarda os 16 bytes finais (tag) separados — é preciso
  fatiar manualmente antes de formatar a string.

**Lição:** esse é o único passo da migração que não tem "tentar de novo": se o formato não bater,
a única forma de descobrir é um usuário real não conseguir logar. Escreva o golden test **antes**
de escrever qualquer outra coisa, e não prossiga sem ele passando.

---

## 10. Corte de produção: falha do serviço `migrate` (o incidente real)

Este foi o problema mais sério — derrubou a produção por ~35 minutos. Documentado em detalhe
porque é o tipo de erro que só aparece com dados reais, nunca em teste local.

### 10.1 — Slugs duplicados na origem (Mongo)

**Sintoma:** o serviço one-off `migrate` (que roda `alembic upgrade head` + o script de migração
dentro da própria rede Docker do deploy) saiu com `exit 1`; como `api`/`worker`/`web` dependiam
dele (`depends_on: migrate: condition: service_completed_successfully`), **nenhum serviço da
aplicação subiu** — só a infraestrutura (Postgres/Redis/Mongo/MinIO) ficou de pé. O domínio
passou a devolver 404 do proxy (Traefik sem nenhum backend saudável registrado).

**Causa raiz:** dois documentos de `tenants` no Mongo tinham o **mesmo `slug`** — dado legado,
provavelmente anterior ao índice único atual (`{slug:1}` único) ter sido criado com sucesso na
coleção. O script de migração fazia `session.add()` de cada tenant num laço e um único
`session.flush()` no final — o SQLAlchemy agrupa isso num `INSERT ... VALUES (...), (...), ...`
em lote, e dois valores de `slug` iguais no **mesmo** INSERT batem direto no
`UniqueViolation`, mesmo sem nenhum dado prévio no destino.

**Fix:** desambiguar slugs duplicados durante a migração em vez de abortar tudo — na primeira
ocorrência mantém o slug original, nas seguintes acrescenta um sufixo (`-dup2`, `-dup3`, ...) e
imprime um aviso para revisão manual depois:
```python
slugs_vistos: dict[str, int] = {}
for doc in mongo.tenants.find({}):
    slug = doc["slug"]
    if slug in slugs_vistos:
        slugs_vistos[slug] += 1
        slug_final = f"{slug}-dup{slugs_vistos[slug]}"
        print(f"AVISO: tenant {doc['_id']} slug duplicado -> {slug_final}")
    else:
        slugs_vistos[slug] = 1
        slug_final = slug
    ...
```

**Lição:** **nunca assuma que os índices únicos da origem foram sempre respeitados**,
especialmente em bases que passaram por testes manuais, seeds antigos ou mudanças de schema no
meio do caminho. Um script de migração para produção precisa tratar colisão como caso esperado,
não exceção.

### 10.2 — Resíduo da tentativa que falhou bloqueou a tentativa seguinte

**Sintoma:** depois do fix acima, uma segunda tentativa de deploy **também** falhou — mas dessa
vez porque o Postgres de destino já tinha dados (`tenants=12, usuarios=13, clientes=24, ...`)
deixados pela primeira tentativa.

**Causa:** a expectativa era que o `with Session(engine) as session:` fizesse ROLLBACK automático
ao sair do bloco por exceção — e em teoria faz — mas, na prática, a primeira tentativa deixou
dados parcialmente commitados no Postgres real de produção (o mecanismo exato não foi
100% confirmado; pode ter sido uma interação entre o Coolify reiniciando o container e o
encerramento do processo Python antes do rollback completar).

**Fix definitivo — não confiar só no rollback automático:** adicionar uma checagem de pré-voo que
recusa migrar para um destino que já tenha qualquer linha nas tabelas da aplicação, com uma
mensagem clara (em vez de deixar o erro real — um `UniqueViolation` genérico — mascarar a causa):
```python
def verificar_destino_vazio(self, session):
    tabelas = [Tenant, Usuario, Membro, CnjToken, Convite, Cliente, Lead, Notificacao]
    ocupadas = [f"{m.__tablename__}={n}" for m in tabelas
                if (n := session.execute(select(func.count()).select_from(m)).scalar_one()) > 0]
    if ocupadas:
        raise RuntimeError(f"Postgres de destino já tem dados ({', '.join(ocupadas)}). "
                            f"TRUNCATE as tabelas antes de tentar de novo.")
```
Sem essa checagem, a segunda falha apareceu como o **mesmo tipo de erro genérico** da primeira,
consumindo mais um ciclo de diagnóstico até ficar claro que a causa já era outra.

**Recuperação:** como não havia usuários reais na nova base ainda, a saída mais rápida foi truncar
manualmente as tabelas de aplicação no Postgres de destino (mantendo `alembic_version` intacta) e
rodar o deploy de novo:
```sql
TRUNCATE TABLE canais, clientes, cnj_tokens, convites, leads, membros,
               mensagens, notificacoes, processos, tenants, usuarios
  RESTART IDENTITY CASCADE;
```

### 10.3 — Sem acesso a log do container que falhou

**Sintoma:** a API de deploy do Coolify (`GET /api/v1/applications/{uuid}/logs`) devolvia
`"Application is not running."` — o log do *deployment* (docker compose build/up) não inclui o
stdout/stderr do container que efetivamente falhou (`migrate`), só o resultado
(`service "migrate" didn't complete successfully: exit 1`).

**Causa:** a API do Coolify usada não expõe logs de containers individuais de um serviço
`docker compose` sob demanda quando a aplicação não está com o container principal saudável;
sem acesso SSH/exec direto à VPS, não havia como puxar `docker logs <container>` remotamente.

**Fix/contorno:** o usuário abriu uma sessão de terminal direta na VPS e rodou
`docker logs <nome-do-container-migrate> --tail 300` manualmente, colando o resultado de volta.

**Lição:** ao planejar um corte de produção sem acesso SSH direto, **garanta de antemão** um
canal para pegar logs de um container que falhe no meio do deploy (acesso SSH à mão, ou um passo
do próprio serviço que grave o traceback em algum lugar acessível — ex.: um arquivo num volume
compartilhado, ou publicar o log num endpoint HTTP temporário). Descobrir isso *durante* um
incidente custa tempo de indisponibilidade.

### 10.4 — Checklist para o próximo corte de produção com dados reais

- [ ] Rodar o script de migração em `--dry-run` contra um **dump real** (não só dados de dev/seed)
      antes do dia do corte, para pegar anomalias de dado (duplicatas, campos ausentes) com calma.
- [ ] Ter um canal de acesso a logs de container (SSH ou equivalente) **pronto antes** de começar,
      não descoberto durante o incidente.
- [ ] Adicionar, desde a primeira versão do script de migração, uma checagem de pré-voo que
      recusa migrar para um destino não vazio — é barato de escrever e evita o ciclo de
      diagnóstico mais longo do processo todo.
- [ ] Tratar toda constraint única da origem como potencialmente violada por dado legado —
      desambiguar e avisar, não abortar a migração inteira por um registro.
- [ ] Definir de antemão o critério de rollback: se X minutos de indisponibilidade forem
      atingidos sem resolução, reverter para a versão anterior (branch/commit conhecido bom) em
      vez de continuar iterando em produção.
