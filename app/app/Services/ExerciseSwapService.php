<?php

namespace App\Services;

use App\Models\Exercise;
use Illuminate\Support\Collection;

/**
 * Substituição inteligente: troca um exercício de máquina por uma alternativa
 * com halter (idealmente do mesmo padrão de movimento e mesmo grupo muscular).
 */
class ExerciseSwapService
{
    /**
     * @return Collection<int, Exercise>
     */
    public function alternatives(Exercise $exercise, int $limit = 6): Collection
    {
        if (! $exercise->muscle_group) {
            return collect();
        }

        return Exercise::query()
            ->where('id', '<>', $exercise->id)
            ->where('muscle_group', $exercise->muscle_group)
            ->where('equipment', 'halter')
            ->where('is_stretch', false)
            ->orderByRaw('CASE WHEN movement_pattern = ? THEN 0 ELSE 1 END', [$exercise->movement_pattern])
            ->orderBy('is_unilateral')
            ->orderBy('name')
            ->limit($limit)
            ->get();
    }
}
