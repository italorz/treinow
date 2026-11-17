A orientação usa `guidance.narracao` como roteiro: uma linha por fala, com 350 ms entre linhas e 800 ms entre blocos separados por linhas em branco. O vídeo original continua mudo e em loop. O player destaca o texto pelos cues do servidor ou pelos eventos de cada fala do navegador.

O fluxo é híbrido. `GET /v1/exercises/{id}/speech` exige usuário e apenas consulta o cache:

- Cache disponível: `200`, com `status: "ready"`, `audioUrl` assinada por 15 minutos, `cues`, `durationSeconds` e `text`.
- Cache ausente: `202`, com `status: "preparing"`, `text` e `lines` (objetos com `text` e `pause` em milissegundos, incluindo pausas entre blocos). Agenda o preparo sem sintetizar na requisição.
- TTS desabilitado: `503` com `detail`. Roteiro ausente: `404`.

O agendamento tenta `get_arq_pool().enqueue_job("warm_speech", exercise_id, _job_id=f"speech-{cache_key}")` em segundo plano, com limite de 500 ms para o Redis. O identificador deduplica trabalhos no arq; retorno `None` indica trabalho já existente. Se o arq falhar, a API usa uma fila em processo, single-flight por chave. Uma única thread de síntese executa os trabalhos em sequência fora do event loop, com `os.nice(10)` e Kokoro `num_threads=1`. Falhas de preparo são registradas e permitem nova tentativa no próximo clique. O fallback local depende da vida do processo da API; o arq é o caminho preferencial.

O worker registra `warm_speech(ctx, exercise_id)`, que consulta o roteiro atual e sintetiza no mesmo cache. Seu resultado não fica retido no Redis, permitindo reaquecimento se o cache for perdido. O cron `warm_planned_speech` roda aos minutos 0 e 30, consulta somente `WorkoutPlan.active`, inclui exercícios principais e reservas desses planos, pula roteiros ausentes e áudios já disponíveis e aquece até 20 áudios por execução. A síntese compartilha a thread de prioridade baixa com os trabalhos sob demanda. O cron tem timeout de uma hora para acomodar CPUs lentas.

Ao receber `preparing` ou erro, a interface inicia imediatamente a Web Speech API pt-BR, mantendo pausas por linha/bloco, destaque, pausa, retomada e parar. Exibe a nota discreta “Usando a voz do navegador enquanto a voz do instrutor é preparada.” Não há polling: o próximo clique consulta novamente o servidor e usa o áudio se estiver pronto. Sem Web Speech, o texto continua disponível com mensagem explicativa.

`GET /v1/media/{id}/speech` valida assinatura antes da consulta ao exercício e suporta Range (206/416). Também apenas lê o cache: se o áudio tiver sido removido, devolve 404 e o player pode usar o navegador, sem iniciar uma síntese longa na rota de mídia.

O áudio é MP3 mono a 64 kbps, com WAV quando `lameenc` não está instalado. O cache usa SHA-256 da versão do motor, voz, velocidade e roteiro; diretórios sem escrita usam LRU em memória de 50 itens. API e worker montam o volume gravável `tts-cache` no mesmo caminho `/data/tts-cache`. Para compartilhar resultados entre processos, esse volume precisa aceitar escrita; o LRU é apenas uma contingência local.

| Variável | Padrão |
| --- | --- |
| `TTS_MODELS_DIR` | `/app/models/kokoro-int8-multi-lang-v1_0` |
| `TTS_VOICE` | `pm_alex` (43); também `pf_dora` (42), `pm_santa` (44) |
| `TTS_SPEED` | `0.95` |
| `TTS_ENABLED` | `true` |
| `TTS_CACHE_DIR` | `/data/tts-cache` |

O Dockerfile inclui somente `model.int8.onnx`, `voices.bin`, `tokens.txt` e `espeak-ng-data`. `sherpa-onnx` e `sherpa-onnx-core` estão fixados em 1.12.34, validada com esse modelo e o frontend espeak. A dependência nativa é explícita porque o metadata do sdist 1.x a omite.

Validação da API (Docker acessível para testcontainers/Postgres, sem iniciar o compose):

```bash
cd /root/treinow/app/apps/api
uv run --frozen --group dev pytest
```

O teste real de Kokoro é pulado quando os arquivos do modelo não existem no diretório configurado. Os testes com motor mockado verificam geração e persistência sem precisar do modelo, além de single-flight, arq, fallback local, cache pronto e limite do cron.

Validação da interface:

```bash
cd /root/treinow/app
npm run typecheck -w @treinow/web
npm test
npm run build
```

No navegador autenticado, abra um exercício com cache vazio e clique em “Ouvir orientação do instrutor”. Confira a fala imediata do navegador, nota, vídeo mudo, destaque, pausa, retomada e parar. Depois do preparo em segundo plano, um novo clique deve usar o áudio do servidor. Repita com TTS desabilitado para validar o fallback por erro.

Medição anterior nesta VPS, com duas threads: roteiro de 102 palavras, 9 linhas e 3 blocos; 94,135 s incluindo carregamento inicial para 40,110 s de áudio. Esse custo motivou o preparo assíncrono; a configuração atual usa uma thread de prioridade baixa e não depende do tempo de síntese para iniciar a orientação.

Resultado desta validação: API com Postgres via testcontainers, 60 testes aprovados e 1 pulado (modelo Kokoro ausente), em 74,48 s; um aviso de depreciação Starlette/httpx. Web: typecheck, 7 testes e build de produção aprovados.
