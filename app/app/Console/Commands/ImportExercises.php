<?php

namespace App\Console\Commands;

use App\Models\Exercise;
use App\Services\GeminiService;
use App\Support\ExerciseClassifier;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class ImportExercises extends Command
{
    protected $signature = 'exercises:import
        {--fresh : Apaga todos os exercícios antes de importar}
        {--gemini : Classifica os desconhecidos via Gemini ao final}';

    protected $description = 'Varre public/videos, categoriza cada exercício pelo nome e salva no banco';

    public function handle(ExerciseClassifier $classifier): int
    {
        $dir = public_path('videos');

        if (! is_dir($dir)) {
            $this->error("Pasta não encontrada: {$dir}");

            return self::FAILURE;
        }

        if ($this->option('fresh')) {
            Exercise::query()->delete();
            $this->warn('Exercícios existentes removidos.');
        }

        $groups = $this->groupFiles($dir);
        $this->info(count($groups).' exercícios detectados a partir dos vídeos.');

        $bar = $this->output->createProgressBar(count($groups));
        $usedSlugs = [];
        $imported = 0;

        foreach ($groups as $group) {
            $data = $classifier->classify($group['base']);
            $slug = $this->uniqueSlug($group['base'], $usedSlugs);
            $usedSlugs[$slug] = true;

            Exercise::updateOrCreate(
                ['slug' => $slug],
                [
                    'name' => $data['name'],
                    'name_raw' => $group['base'],
                    'muscle_group' => $data['muscle_group'],
                    'secondary_muscles' => $data['secondary_muscles'],
                    'equipment' => $data['equipment'],
                    'movement_pattern' => $data['movement_pattern'],
                    'is_unilateral' => $data['is_unilateral'],
                    'is_stretch' => $data['is_stretch'],
                    'video_path' => $group['video_path'],
                    'video_loop_path' => $group['video_loop_path'],
                    'classified_by' => 'rule',
                ]
            );

            $imported++;
            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);

        $this->reportDistribution();

        if ($this->option('gemini')) {
            $this->classifyMissingWithGemini(app(GeminiService::class));
        }

        $this->info("Importação concluída: {$imported} exercícios.");

        return self::SUCCESS;
    }

    /**
     * Agrupa arquivos, unindo variantes *_Textured.mov_begin/_loop/_end.
     *
     * @return array<string, array{base:string, video_path:string, video_loop_path:?string}>
     */
    private function groupFiles(string $dir): array
    {
        $files = collect(scandir($dir))
            ->filter(fn ($f) => Str::endsWith(strtolower($f), '.mp4'))
            ->values();

        $variants = []; // base => [variant => file]
        $singles = [];  // base => file

        foreach ($files as $file) {
            if (preg_match('/^(.+)_Textured\.mov_(begin|loop|end)\.mp4$/i', $file, $m)) {
                $variants[$m[1]][strtolower($m[2])] = $file;
            } else {
                $base = preg_replace('/\.mp4$/i', '', $file);
                $singles[$base] = $file;
            }
        }

        $groups = [];

        foreach ($variants as $base => $vs) {
            $loop = $vs['loop'] ?? null;
            $primary = $loop ?? ($vs['begin'] ?? ($vs['end'] ?? reset($vs)));
            $groups[$base] = [
                'base' => $base,
                'video_path' => $primary,
                'video_loop_path' => $loop,
            ];
        }

        foreach ($singles as $base => $file) {
            $groups[$base] = [
                'base' => $base,
                'video_path' => $file,
                'video_loop_path' => null,
            ];
        }

        return $groups;
    }

    private function uniqueSlug(string $base, array $used): string
    {
        $slug = Str::slug($base) ?: 'exercicio';
        $candidate = $slug;
        $i = 2;
        while (isset($used[$candidate])) {
            $candidate = $slug.'-'.$i++;
        }

        return $candidate;
    }

    private function reportDistribution(): void
    {
        $rows = Exercise::query()
            ->selectRaw('coalesce(muscle_group, "(desconhecido)") as m, count(*) as total')
            ->groupBy('m')
            ->orderByDesc('total')
            ->get();

        $this->table(['Músculo', 'Total'], $rows->map(fn ($r) => [$r->m, $r->total])->all());
    }

    private function classifyMissingWithGemini(GeminiService $gemini): void
    {
        $missing = Exercise::whereNull('muscle_group')->get();

        if ($missing->isEmpty()) {
            $this->info('Nenhum exercício desconhecido para o Gemini.');

            return;
        }

        $this->info("Enviando {$missing->count()} desconhecidos ao Gemini...");

        foreach ($missing->chunk(40) as $chunk) {
            try {
                $result = $gemini->classifyExercises(
                    $chunk->pluck('name_raw', 'slug')->all()
                );
            } catch (\Throwable $e) {
                $this->error('Falha no Gemini: '.$e->getMessage());

                return;
            }

            foreach ($result as $slug => $info) {
                $ex = $chunk->firstWhere('slug', $slug);
                if (! $ex || empty($info['muscle_group'])) {
                    continue;
                }
                $ex->update([
                    'muscle_group' => $info['muscle_group'],
                    'secondary_muscles' => $info['secondary'] ?? [],
                    'equipment' => $info['equipment'] ?? $ex->equipment,
                    'classified_by' => 'gemini',
                ]);
            }
        }

        $this->info('Reclassificação via Gemini concluída.');
        $this->reportDistribution();
    }
}
