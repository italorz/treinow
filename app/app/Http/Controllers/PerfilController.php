<?php

namespace App\Http\Controllers;

use App\Models\Exercise;
use App\Models\User;
use App\Models\UserPreference;
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

        // O PHP embutido (php artisan serve) mata o script em 30s por padrão,
        // independente do timeout do client HTTP do Gemini (120s) — sem isso,
        // a chamada é interrompida por dentro do curl antes do próprio Guzzle
        // conseguir estourar o timeout dele e retornar um erro tratável.
        set_time_limit(150);

        $catalog = $this->buildCatalog($prefs);

        try {
            $plan = $gemini->generateWorkout($prefs, $catalog);
        } catch (\Throwable $e) {
            return redirect()->route('perfil')->with('error', 'Falha ao gerar treino: '.$e->getMessage());
        }

        $this->persistPlan($user, $plan);

        return redirect()->route('semana')->with('status', 'Treino customizado gerado com sucesso!');
    }

    /**
     * Monta um catálogo compacto e balanceado por grupo muscular (em vez de um
     * corte cru por id) para caber num prompt rápido e garantir variedade —
     * "pernas" sozinho tem ~240 dos 965 exercícios e dominaria um limit() simples.
     */
    private function buildCatalog(UserPreference $prefs)
    {
        $equipamentos = ! empty($prefs->equipamentos) ? $prefs->equipamentos : array_keys(Exercise::EQUIPMENT);
        $prioritarios = $prefs->musculos_prioritarios ?? [];

        $catalog = collect();

        foreach (array_keys(Exercise::MUSCLES) as $muscle) {
            $take = in_array($muscle, $prioritarios, true) ? 20 : 10;

            $items = Exercise::query()
                ->where('muscle_group', $muscle)
                ->where('is_stretch', false)
                ->whereIn('equipment', $equipamentos)
                ->inRandomOrder()
                ->limit($take)
                ->get(['id', 'slug', 'name', 'muscle_group', 'equipment']);

            $catalog = $catalog->merge($items);
        }

        return $catalog;
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

                // Garante unicidade de exercícios (principal ou reserva) dentro
                // do dia como rede de segurança, caso o Gemini não siga à risca
                // a regra de não repetir slug — mesmo instruído para isso.
                $usedIds = [];
                $position = 1;
                foreach ($dayData['exercises'] ?? [] as $ex) {
                    $exerciseId = $slugToId[$ex['slug'] ?? ''] ?? null;
                    if (! $exerciseId || in_array($exerciseId, $usedIds, true)) {
                        continue;
                    }

                    $reserveId = $slugToId[$ex['reserve_slug'] ?? ''] ?? null;
                    if ($reserveId && ($reserveId === $exerciseId || in_array($reserveId, $usedIds, true))) {
                        $reserveId = null;
                    }

                    $usedIds[] = $exerciseId;
                    if ($reserveId) {
                        $usedIds[] = $reserveId;
                    }

                    $day->exercises()->attach($exerciseId, [
                        'position' => $position++,
                        'sets' => $ex['sets'] ?? 3,
                        'reps' => $ex['reps'] ?? '10-12',
                        'rest_seconds' => $ex['rest_seconds'] ?? 60,
                        'reserve_exercise_id' => $reserveId,
                    ]);
                }
            }
        });
    }
}
