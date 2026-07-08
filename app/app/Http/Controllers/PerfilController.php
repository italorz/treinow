<?php

namespace App\Http\Controllers;

use App\Models\Exercise;
use App\Models\User;
use App\Models\WorkoutDay;
use App\Services\GeminiService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PerfilController extends Controller
{
    public function edit()
    {
        $user = User::current();
        $prefs = $user->preference ?? $user->preference()->make();

        return view('perfil', [
            'user' => $user,
            'prefs' => $prefs,
            'muscles' => Exercise::MUSCLES,
            'equipmentOptions' => Exercise::EQUIPMENT,
        ]);
    }

    public function update(Request $request)
    {
        $user = User::current();
        $this->savePreferences($request, $user);

        return redirect()->route('perfil')->with('status', 'Preferências salvas com sucesso.');
    }

    private function savePreferences(Request $request, User $user): void
    {
        $data = $request->validate([
            'objetivo' => ['nullable', 'string'],
            'nivel' => ['nullable', 'string'],
            'dias_por_semana' => ['nullable', 'integer', 'min:1', 'max:7'],
            'duracao_min' => ['nullable', 'string'],
            'sexo' => ['nullable', 'string'],
            'idade' => ['nullable', 'integer', 'min:10', 'max:100'],
            'peso' => ['nullable', 'numeric'],
            'altura' => ['nullable', 'integer'],
            'local' => ['nullable', 'in:academia,casa'],
            'equipamentos' => ['nullable', 'array'],
            'musculos_prioritarios' => ['nullable', 'array', 'max:3'],
            'restricoes' => ['nullable', 'array'],
            'evitar_unilaterais' => ['nullable', 'boolean'],
            'treinos_intensos' => ['nullable', 'boolean'],
        ]);

        $data['evitar_unilaterais'] = $request->boolean('evitar_unilaterais');
        $data['treinos_intensos'] = $request->boolean('treinos_intensos');

        $user->preference()->updateOrCreate([], $data);
    }

    public function generate(Request $request, GeminiService $gemini)
    {
        $user = User::current();

        // Salva os valores atuais do formulário antes de gerar.
        $this->savePreferences($request, $user);
        $prefs = $user->preference()->first();

        if (! $gemini->configured()) {
            return redirect()->route('perfil')->with('error', 'Configure a GEMINI_API_KEY no arquivo .env para gerar o treino.');
        }

        $catalog = Exercise::query()
            ->whereNotNull('muscle_group')
            ->where('is_stretch', false)
            ->when(! empty($prefs->equipamentos), fn ($q) => $q->whereIn('equipment', $prefs->equipamentos))
            ->limit(400)
            ->get(['id', 'slug', 'name', 'muscle_group', 'equipment']);

        try {
            $plan = $gemini->generateWorkout($prefs, $catalog);
        } catch (\Throwable $e) {
            return redirect()->route('perfil')->with('error', 'Falha ao gerar treino: '.$e->getMessage());
        }

        $this->persistPlan($user, $plan);

        return redirect()->route('semana')->with('status', 'Treino customizado gerado com sucesso!');
    }

    private function persistPlan(User $user, array $plan): void
    {
        $slugToId = Exercise::whereNotNull('muscle_group')->pluck('id', 'slug');

        DB::transaction(function () use ($user, $plan, $slugToId) {
            foreach ($plan as $dayData) {
                $weekday = $dayData['weekday'] ?? null;
                if ($weekday === null || $weekday < 0 || $weekday > 6) {
                    continue;
                }

                $day = WorkoutDay::updateOrCreate(
                    ['user_id' => $user->id, 'weekday' => $weekday],
                    [
                        'title' => $dayData['title'] ?? null,
                        'focus_muscles' => $dayData['focus_muscles'] ?? [],
                        'duration_min' => $dayData['duration_min'] ?? null,
                        'is_rest' => $dayData['is_rest'] ?? false,
                        'source' => 'gemini',
                    ]
                );

                $day->exercises()->detach();

                $position = 1;
                foreach ($dayData['exercises'] ?? [] as $ex) {
                    $exerciseId = $slugToId[$ex['slug'] ?? ''] ?? null;
                    if (! $exerciseId) {
                        continue;
                    }
                    $day->exercises()->attach($exerciseId, [
                        'position' => $position++,
                        'sets' => $ex['sets'] ?? 3,
                        'reps' => $ex['reps'] ?? '10-12',
                        'rest_seconds' => $ex['rest_seconds'] ?? 60,
                    ]);
                }
            }
        });
    }
}
