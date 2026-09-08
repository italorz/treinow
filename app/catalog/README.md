# Catálogo ativo e relações

`npm run catalog` cruza `exercicios_por_categoria.csv`, `videos_identificados.csv` e as tabelas `ExerciseEntity`/`ExerciseMuscleEntity` de `AppDb1`, sempre por ID. A geração falha em caso de campo divergente, ID duplicado, variante ausente ou arquivo inválido. `manifest.json` registra a versão, contagens e hashes das fontes.

São 3.001 exercícios, 3.792 vínculos masculino/feminino e 3.791 MP4 únicos. Um arquivo participa de dois vínculos. Os 55 registros de `videos_sem_relacao.csv` não têm exercício identificado: continuam documentados na fonte, mas os arquivos MP4 correspondentes foram apagados do desenvolvimento e não entram na imagem, na biblioteca ou na geração automática.

## Conhecimento disponível à aplicação

Em cada exercício, `classification.knowledge` preserva:

- ID do exercício na fonte e tipo (`Strength`, `Stretching`, `Aerobic`).
- Todos os músculos, grupo traduzido, `isTarget` e participação original (fração 0–1).
- Músculos-alvo separados dos auxiliares. O principal é o alvo com maior participação; empates são resolvidos pelo nome para resultado determinístico. Isso não atribui exclusividade ao primeiro músculo.
- Equipamento original, secundário e requisitos normalizados. Equipamentos especiais possuem categorias próprias e não viram peso corporal por padrão.
- Modalidades de medição: carga, repetições, distância e duração.
- Popularidade e escores GPT da fonte, identificados como escores da fonte.
- Regra e chave de substituição. Padrões não reconhecidos recebem chave individual e não são usados para equivalência automática.

As participações são dados da biblioteca de origem, não medições nem validação clínica. Complexidade (experiência 1–2/3–4/5), aquecimento, articulações e alvos de substituição são regras derivadas versionadas. O detalhe da API expõe `knowledge` e `videoVariants`.

## Nomes em português

`names.pt-BR.json` contém um nome de exibição por ID da nova fonte. O build usa esse mapa estático, sem tradução online, e falha se faltar um nome. `scripts/translate-catalog.py` é uma ferramenta opcional de preparação usando o provedor Gemini configurado na aplicação; envia somente IDs temporários e nomes de exercícios, nunca perfis ou dados pessoais. Não é executada no build nem na produção. Alterações no mapa devem ser revisadas e validadas com `npm run catalog:test`.

`nameRaw` preserva o nome original para rastreabilidade, busca e manutenção das regras existentes; não é exibido ao usuário. `name-overrides.pt-BR.json` contém as correções humanas de termos ambíguos. Equipamentos, posições, pegadas, lateralidade e versões permanecem diferenciados na tradução. Os IDs e vínculos de vídeo não mudam quando o nome muda. O manifesto registra a cobertura e os hashes das traduções.

## Ativação e planos existentes

Por solicitação explícita do responsável pelo banco de teste, esta migração **apaga** o catálogo legado e suas relações. Antes de reutilizá-la em outro banco com histórico real, revisar essa política e fazer backup.

O worker verifica todos os arquivos e uploads antes de gravar em uma transação. Faz upsert dos exercícios novos por ID estável e apaga exercícios ausentes do catálogo, planos da versão anterior (ou contendo IDs legados), sessões desses planos e sessões que referenciam exercícios legados, além dos logs dependentes. Depois remove do bucket de produção todo objeto de vídeo que não pertença à nova relação, preservando objetos que não sejam vídeo. Os snapshots analíticos afetados são invalidados e seu recálculo é enfileirado. Usuários, perfis, medidas, vínculos de conta e consentimentos não são apagados. Biblioteca, busca, contadores, recomendações, player e motor usam a mesma fronteira (`is_active` e versão v2).

O ranking do motor combina escolhas explícitas do perfil (objetivo, nível, intensidade, dias, duração, equipamentos, músculos prioritários e restrições) com músculos-alvo, equipamento secundário, modalidade de medição, experiência, popularidade e escore da fonte. Também evita repetição recente e penaliza excesso do mesmo padrão de movimento. A validação final continua exigindo IDs ativos, equipamento compatível, relações anatômicas exatas para reservas e regras de segurança já configuradas.

Planos são enfileirados para perfis sem plano ativo e alunos afetados; planos já atualizados não são apagados em nova execução. A API não serve planos da biblioteca anterior. A geração continua respeitando bloqueios de perfil/lesão existentes, que podem exigir ação no perfil.

O log de importação informa ativos, inativos, exercícios/planos/sessões/logs apagados, vídeos verificados e planos enfileirados. Reexecutar a importação é idempotente e reenvia planos pendentes caso a fila não tenha sido completada. `/health` permite conferir a versão e as contagens do catálogo carregado.
