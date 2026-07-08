# Treinow — Controle de Treino de Academia

App Laravel 13 + Tailwind 4 + Alpine.js + SQLite. Categoriza automaticamente ~1190
vídeos de exercícios (em `app/public/videos/`) por grupo muscular e equipamento a
partir do nome do arquivo, e oferece 4 telas: **Hoje**, **Exercícios** (Écorché
clicável), **Semana** e **Eu** (perfil que gera treino via Gemini).

Todo o código vive em `app/` (o diretório `backend/` não é usado).

## Como rodar

```bash
cd app
composer install          # se ainda não instalado
npm install               # se ainda não instalado
php artisan migrate:fresh # cria as tabelas (SQLite em database/database.sqlite)
php artisan exercises:import --fresh   # categoriza e importa os 965 exercícios
php artisan db:seed        # cria o usuário "Lucas Silva" + semana de exemplo

npm run build              # (ou `npm run dev` para hot reload)
php artisan serve          # http://127.0.0.1:8000
```

## Categorização dos exercícios

- **Regras (PHP)** — `app/App/Support/ExerciseClassifier.php` parseia o nome do
  arquivo (prefixo de equipamento `BB`=barra, `DB`=halter, `CB`=cabo, `LV`=máquina…
  + palavra-chave do movimento) e resolve ~94% dos exercícios. Distribuição atual:
  pernas, core, peitoral, ombro, costas, glúteos, tríceps, bíceps, panturrilha,
  antebraço, trapézio; ~62 ficam como *desconhecido*.
- **Fallback Gemini (opcional)** — para classificar os desconhecidos restantes:

  ```bash
  php artisan exercises:import --fresh --gemini   # exige GEMINI_API_KEY
  ```

## Gemini (geração de treino + fallback)

Adicione sua chave em `app/.env`:

```
GEMINI_API_KEY=sua_chave_aqui
GEMINI_MODEL=gemini-2.0-flash
```

Na tela **Eu**, preencha o formulário e clique em **Gerar treino customizado**:
o `GeminiService` monta um plano semanal usando apenas exercícios do catálogo e
grava em `workout_days`. Sem a chave, o botão apenas avisa que a chave é necessária
(o restante do app funciona normalmente).

## Écorché (mapa muscular clicável) — imagens a gerar

A tela **Exercícios** usa **imagem + hotspots**. Enquanto as imagens não existem,
um placeholder é exibido; os hotspots já funcionam. Gere as duas imagens (via
Codex/GPT-5.5 ou outra ferramenta de imagem) e salve em:

- `app/public/images/ecorche-frente.png`
- `app/public/images/ecorche-verso.png`

**Especificação das imagens** (PNG, fundo transparente, corpo inteiro, proporção
~1:2.2, pose anatômica neutra em pé, simétrica, estilo ilustração muscular em tons
de cinza como o mockup):

- **Frente (anterior):** peitoral, deltoides, bíceps, antebraços, reto
  abdominal/oblíquos, quadríceps, panturrilha (tibial).
- **Verso (posterior):** trapézio, dorsais/latíssimo, deltoide posterior, tríceps,
  lombar, glúteos, isquiotibiais, panturrilha (gastrocnêmio).

**Prompt sugerido:**

> Full-body anatomical écorché illustration, {anterior|posterior} view, standing
> neutral symmetrical pose, detailed superficial muscle groups clearly delineated,
> clean medical-illustration style, soft grayscale shading, transparent background,
> no text, centered, full body from head to feet.

Depois de inserir as imagens, ajuste as coordenadas dos hotspots (em %) no topo de
`app/resources/views/exercicios.blade.php` (`$frontSpots` / `$backSpots`, no formato
`[músculo, left%, top%, width%, height%]`) para casar com a anatomia das imagens.
Opcional: gerar overlays azuis por músculo para o destaque de seleção.

## Funcionalidades por tela

- **Hoje** (`/`): exercícios do treino do dia (vídeo em loop, lazy), barra de
  progresso, **Trocar** (substitui máquina → alternativa com halter via
  `ExerciseSwapService`) e marcar como concluído.
- **Exercícios** (`/exercicios`): Écorché frente/verso + chips; clicar num músculo
  carrega os exercícios com **scroll infinito** (`/api/exercicios?muscle=&page=`).
- **Semana** (`/semana`): os 7 dias do usuário, com foco e destaque do dia atual.
- **Eu** (`/eu`): formulário rastreável (selects/checkboxes) → preferências +
  geração de treino por IA.

## Testes

```bash
cd app && php artisan test
```

Cobrem o classificador (músculo/equipamento/stretch/unilateral), a paginação da API,
a substituição inteligente (só halter, mesmo músculo) e a ação de concluir.
