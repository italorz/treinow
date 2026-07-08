<?php

namespace App\Services;

use App\Models\Exercise;
use App\Models\UserPreference;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class GeminiService
{
    private const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

    public function configured(): bool
    {
        return ! empty(config('services.gemini.key'));
    }

    private function generate(string $prompt, array $schema): array
    {
        if (! $this->configured()) {
            throw new RuntimeException('GEMINI_API_KEY não configurada no .env.');
        }

        $model = config('services.gemini.model');
        $url = self::ENDPOINT."/{$model}:generateContent";

        $response = Http::timeout(120)
            ->withQueryParameters(['key' => config('services.gemini.key')])
            ->acceptJson()
            ->post($url, [
                'contents' => [[
                    'parts' => [['text' => $prompt]],
                ]],
                'generationConfig' => [
                    'temperature' => 0.4,
                    'responseMimeType' => 'application/json',
                    'responseSchema' => $schema,
                ],
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Gemini retornou erro '.$response->status().': '.$response->body());
        }

        $text = data_get($response->json(), 'candidates.0.content.parts.0.text');

        if (! $text) {
            throw new RuntimeException('Resposta do Gemini vazia.');
        }

        return json_decode($text, true) ?? [];
    }

    /**
     * Classifica exercícios desconhecidos.
     *
     * @param  array<string,string>  $namesBySlug  slug => name_raw
     * @return array<string, array{muscle_group:string, secondary:array, equipment:string}>
     */
    public function classifyExercises(array $namesBySlug): array
    {
        $muscles = implode(', ', array_keys(Exercise::MUSCLES));
        $equipment = implode(', ', array_keys(Exercise::EQUIPMENT));

        $list = collect($namesBySlug)
            ->map(fn ($name, $slug) => "- {$slug}: {$name}")
            ->implode("\n");

        $prompt = <<<TXT
        Você é um especialista em educação física. Classifique cada exercício abaixo
        (nome derivado do nome de um arquivo de vídeo) informando o grupo muscular
        primário, músculos secundários e o equipamento.

        Grupos musculares permitidos: {$muscles}.
        Equipamentos permitidos: {$equipment}.

        Retorne um array JSON, um objeto por exercício, usando exatamente o "slug" fornecido.

        Exercícios:
        {$list}
        TXT;

        $schema = [
            'type' => 'ARRAY',
            'items' => [
                'type' => 'OBJECT',
                'properties' => [
                    'slug' => ['type' => 'STRING'],
                    'muscle_group' => ['type' => 'STRING'],
                    'secondary' => ['type' => 'ARRAY', 'items' => ['type' => 'STRING']],
                    'equipment' => ['type' => 'STRING'],
                ],
                'required' => ['slug', 'muscle_group', 'equipment'],
            ],
        ];

        $result = $this->generate($prompt, $schema);

        $out = [];
        foreach ($result as $item) {
            if (! empty($item['slug'])) {
                $out[$item['slug']] = [
                    'muscle_group' => $item['muscle_group'] ?? null,
                    'secondary' => $item['secondary'] ?? [],
                    'equipment' => $item['equipment'] ?? null,
                ];
            }
        }

        return $out;
    }

    /**
     * Gera um plano semanal a partir das preferências do usuário e do catálogo disponível.
     *
     * @param  Collection<int,Exercise>  $catalog
     * @return array<int, array{weekday:int, title:string, focus_muscles:array, duration_min:int, is_rest:bool, exercises:array}>
     */
    public function generateWorkout(UserPreference $prefs, Collection $catalog): array
    {
        // Catálogo compacto: slug + músculo + equipamento (limita tokens).
        $catalogText = $catalog
            ->map(fn (Exercise $e) => "{$e->slug} | {$e->muscle_group} | {$e->equipment} | {$e->name}")
            ->implode("\n");

        $p = $prefs->toArray();
        $prefsText = json_encode([
            'objetivo' => $p['objetivo'] ?? null,
            'nivel' => $p['nivel'] ?? null,
            'dias_por_semana' => $p['dias_por_semana'] ?? null,
            'duracao_min' => $p['duracao_min'] ?? null,
            'sexo' => $p['sexo'] ?? null,
            'local' => $p['local'] ?? null,
            'equipamentos' => $p['equipamentos'] ?? [],
            'musculos_prioritarios' => $p['musculos_prioritarios'] ?? [],
            'restricoes' => $p['restricoes'] ?? [],
            'evitar_unilaterais' => $p['evitar_unilaterais'] ?? false,
            'treinos_intensos' => $p['treinos_intensos'] ?? false,
        ], JSON_UNESCAPED_UNICODE);

        $prompt = <<<TXT
        Monte um plano de treino semanal (7 dias, weekday 0=domingo a 6=sábado) para um usuário
        de academia com base nas preferências abaixo. Distribua os dias de treino conforme
        "dias_por_semana" e marque os demais como descanso (is_rest=true, sem exercícios).

        Use SOMENTE exercícios do catálogo fornecido, referenciando pelo "slug" exato.
        Respeite os equipamentos disponíveis e priorize os músculos prioritários e o objetivo.
        Cada dia de treino deve ter de 5 a 8 exercícios com sets, reps e descanso adequados ao nível.

        Preferências do usuário:
        {$prefsText}

        Catálogo (slug | musculo | equipamento | nome):
        {$catalogText}
        TXT;

        $schema = [
            'type' => 'ARRAY',
            'items' => [
                'type' => 'OBJECT',
                'properties' => [
                    'weekday' => ['type' => 'INTEGER'],
                    'title' => ['type' => 'STRING'],
                    'focus_muscles' => ['type' => 'ARRAY', 'items' => ['type' => 'STRING']],
                    'duration_min' => ['type' => 'INTEGER'],
                    'is_rest' => ['type' => 'BOOLEAN'],
                    'exercises' => [
                        'type' => 'ARRAY',
                        'items' => [
                            'type' => 'OBJECT',
                            'properties' => [
                                'slug' => ['type' => 'STRING'],
                                'sets' => ['type' => 'INTEGER'],
                                'reps' => ['type' => 'STRING'],
                                'rest_seconds' => ['type' => 'INTEGER'],
                            ],
                            'required' => ['slug'],
                        ],
                    ],
                ],
                'required' => ['weekday', 'is_rest'],
            ],
        ];

        return $this->generate($prompt, $schema);
    }
}
