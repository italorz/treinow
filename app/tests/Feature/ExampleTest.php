<?php

namespace Tests\Feature;

use App\Models\Exercise;
use App\Models\User;
use App\Models\WorkoutDay;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExampleTest extends TestCase
{
    use RefreshDatabase;

    private function makeExercise(array $attrs = []): Exercise
    {
        static $i = 0;
        $i++;

        return Exercise::create(array_merge([
            'slug' => 'ex-'.$i,
            'name' => 'Exercício '.$i,
            'name_raw' => 'ex'.$i,
            'muscle_group' => 'peitoral',
            'equipment' => 'maquina',
            'movement_pattern' => 'press',
            'video_path' => 'ex'.$i.'.mp4',
        ], $attrs));
    }

    public function test_home_page_loads(): void
    {
        $this->get('/')->assertOk();
    }

    public function test_exercise_api_paginates_by_muscle(): void
    {
        foreach (range(1, 20) as $n) {
            $this->makeExercise(['muscle_group' => 'costas']);
        }
        $this->makeExercise(['muscle_group' => 'pernas']);

        $this->getJson('/api/exercicios?muscle=costas&page=1')
            ->assertOk()
            ->assertJsonPath('total', 20)
            ->assertJsonCount(15, 'data');
    }

    public function test_alternatives_returns_only_dumbbell_same_muscle(): void
    {
        $machine = $this->makeExercise(['muscle_group' => 'peitoral', 'equipment' => 'maquina']);
        $this->makeExercise(['muscle_group' => 'peitoral', 'equipment' => 'halter']);
        $this->makeExercise(['muscle_group' => 'peitoral', 'equipment' => 'barra']);
        $this->makeExercise(['muscle_group' => 'costas', 'equipment' => 'halter']);

        $response = $this->getJson("/exercicios/{$machine->id}/alternativas");

        $response->assertOk()->assertJsonCount(1);
        $this->assertSame('halter', $response->json('0.equipment'));
        $this->assertSame('peitoral', $response->json('0.muscle_group'));
    }

    public function test_toggle_done_updates_pivot(): void
    {
        $user = User::current();
        $day = WorkoutDay::create(['user_id' => $user->id, 'weekday' => now()->dayOfWeek, 'title' => 'Teste']);
        $ex = $this->makeExercise();
        $day->exercises()->attach($ex->id, ['position' => 1]);
        $pivotId = $day->exercises()->first()->pivot->id;

        $this->postJson("/hoje/{$pivotId}/concluir")
            ->assertOk()
            ->assertJsonPath('is_done', true);
    }

    public function test_swap_toggles_between_exercise_and_predefined_reserve(): void
    {
        $user = User::current();
        $day = WorkoutDay::create(['user_id' => $user->id, 'weekday' => now()->dayOfWeek, 'title' => 'Teste']);
        $primary = $this->makeExercise(['equipment' => 'maquina']);
        $reserve = $this->makeExercise(['equipment' => 'halter']);
        $day->exercises()->attach($primary->id, ['position' => 1, 'reserve_exercise_id' => $reserve->id]);
        $pivotId = $day->exercises()->first()->pivot->id;

        // Primeira troca: alterna para a reserva pré-definida.
        $this->postJson("/hoje/{$pivotId}/trocar")
            ->assertOk()
            ->assertJsonPath('exercise.id', $reserve->id)
            ->assertJsonPath('reserve.id', $primary->id);

        $this->assertDatabaseHas('workout_day_exercise', [
            'id' => $pivotId,
            'exercise_id' => $reserve->id,
            'reserve_exercise_id' => $primary->id,
        ]);

        // Segunda troca: alterna de volta ao original (par fixo, sem opções extras).
        $this->postJson("/hoje/{$pivotId}/trocar")
            ->assertOk()
            ->assertJsonPath('exercise.id', $primary->id)
            ->assertJsonPath('reserve.id', $reserve->id);
    }

    public function test_swap_without_reserve_promotes_chosen_alternative(): void
    {
        $user = User::current();
        $day = WorkoutDay::create(['user_id' => $user->id, 'weekday' => now()->dayOfWeek, 'title' => 'Teste']);
        $primary = $this->makeExercise(['equipment' => 'maquina']);
        $alternative = $this->makeExercise(['equipment' => 'halter']);
        $day->exercises()->attach($primary->id, ['position' => 1]);
        $pivotId = $day->exercises()->first()->pivot->id;

        $this->postJson("/hoje/{$pivotId}/trocar", ['exercise_id' => $alternative->id])
            ->assertOk()
            ->assertJsonPath('exercise.id', $alternative->id)
            ->assertJsonPath('reserve.id', $primary->id);

        $this->assertDatabaseHas('workout_day_exercise', [
            'id' => $pivotId,
            'exercise_id' => $alternative->id,
            'reserve_exercise_id' => $primary->id,
        ]);
    }
}
