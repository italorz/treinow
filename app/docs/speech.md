A orientação do instrutor é lida no próprio navegador, com a Web Speech API (`window.speechSynthesis`). O vídeo original continua mudo e em loop. Não há síntese no servidor, cache de áudio nem preparo em segundo plano.

O botão “Ouvir orientação do instrutor” aparece sempre que houver texto para falar:

- Se o exercício já tem `executionGuide.narracao`, esse roteiro é usado: uma linha por fala, com 350 ms entre linhas e 800 ms entre blocos separados por linhas em branco.
- Se o roteiro novo ainda não existe, a interface monta o texto a partir das seções “Como executar”, “Como evitar lesões” e “Sinais de carga excessiva”, ou, na falta delas, das dicas gerais de `exercise_guidance`.
- O texto visível, as seções e o aviso (“Orientação geral, não substitui um profissional.”) permanecem na tela.

A voz preferida é uma voz feminina em pt-BR (por exemplo Google português do Brasil, Microsoft Francisca, Maria ou Thalita, Luciana, Joana, Fernanda ou Vitória). Se essa voz ainda não tiver carregado, o player espera o evento `voiceschanged`. Sem uma voz feminina, usa qualquer voz pt-BR ou portuguesa; se nenhuma estiver disponível, fala com o idioma `pt-BR` na voz padrão do navegador.

O player destaca a linha em leitura, permite pausar, retomar e parar, e interrompe a fala ao trocar de exercício. Sem Web Speech, o texto continua visível com uma mensagem explicativa.

Validação da API (Docker acessível para testcontainers/Postgres, sem iniciar o compose):

```bash
cd /root/treinow/app/apps/api
uv run --frozen --group dev pytest
```

Validação da interface:

```bash
cd /root/treinow/app
npm run typecheck -w @treinow/web
npm test
npm run build
```

No navegador autenticado, abra um exercício com roteiro e outro ainda só com as dicas gerais, clique em “Ouvir orientação do instrutor” e confira a voz feminina do navegador, o vídeo mudo, o destaque, a pausa, a retomada e o parar. A rede não deve chamar `/v1/exercises/{id}/speech`.
