<?php

namespace Database\Seeders;

use App\Models\Exercise;
use App\Models\User;
use App\Models\WorkoutDay;
use App\Services\ExerciseSwapService;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $swap = new ExerciseSwapService();

        $user = User::updateOrCreate(
            ['email' => 'lucas.silva@email.com'],
            ['name' => 'Lucas Silva', 'password' => Hash::make('senha1234')]
        );

        $user->preference()->updateOrCreate([], [
            'objetivo' => 'hipertrofia',
            'nivel' => 'intermediario',
            'dias_por_semana' => 5,
            'duracao_min' => '60-75',
            'sexo' => 'masculino',
            'idade' => 28,
            'peso' => 78,
            'altura' => 175,
            'local' => 'academia',
            'equipamentos' => ['maquina', 'halter', 'barra', 'cabo'],
            'musculos_prioritarios' => ['peitoral', 'costas', 'pernas'],
            'restricoes' => ['ombro_direito'],
            'evitar_unilaterais' => false,
            'treinos_intensos' => true,
        ]);

        // Semana de exemplo (5 treinos + 2 descansos), preenchida com exercícios reais.
        $plan = [
            1 => ['Peito e tríceps', ['peitoral', 'triceps'], 60],
            2 => ['Costas e bíceps', ['costas', 'biceps'], 65],
            3 => ['Pernas', ['pernas', 'panturrilha'], 70],
            4 => ['Ombros', ['ombro', 'trapezio'], 55],
            5 => ['Peito e tríceps', ['peitoral', 'triceps'], 60],
            6 => ['Descanso ativo', [], null, true],
            0 => ['Descanso', [], null, true],
        ];

        foreach ($plan as $weekday => $config) {
            [$title, $muscles, $duration] = $config;
            $isRest = $config[3] ?? false;

            $day = WorkoutDay::updateOrCreate(
                ['user_id' => $user->id, 'weekday' => $weekday],
                [
                    'title' => $title,
                    'focus_muscles' => $muscles,
                    'duration_min' => $duration,
                    'is_rest' => $isRest,
                    'source' => 'manual',
                ]
            );

            $day->exercises()->detach();

            if ($isRest || empty($muscles)) {
                continue;
            }

            $exercises = Exercise::query()
                ->whereIn('muscle_group', $muscles)
                ->where('is_stretch', false)
                ->whereNotNull('muscle_group')
                ->inRandomOrder()
                ->limit(6)
                ->get();

            // Reserva por exercício (mesmo alvo/equipamento halter), evitando
            // repetir dentro do dia qualquer exercício já usado como principal
            // ou já escalado como reserva de outro exercício.
            $usedIds = $exercises->pluck('id')->all();

            $position = 1;
            foreach ($exercises as $exercise) {
                $reserve = $swap->alternatives($exercise, 6)
                    ->reject(fn ($alt) => in_array($alt->id, $usedIds, true))
                    ->first();

                if ($reserve) {
                    $usedIds[] = $reserve->id;
                }

                $day->exercises()->attach($exercise->id, [
                    'position' => $position++,
                    'sets' => 4,
                    'reps' => '10-12',
                    'rest_seconds' => 60,
                    'reserve_exercise_id' => $reserve?->id,
                ]);
            }
        }
    }
}
