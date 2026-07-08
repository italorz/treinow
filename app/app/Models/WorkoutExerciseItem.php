<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Item de um dia de treino (linha da tabela pivot workout_day_exercise).
 * Existe como model próprio para permitir route-model-binding nas ações
 * de "trocar" e "concluir" da tela Hoje.
 */
class WorkoutExerciseItem extends Model
{
    protected $table = 'workout_day_exercise';

    protected $guarded = [];

    protected $casts = [
        'is_done' => 'boolean',
    ];

    public function exercise(): BelongsTo
    {
        return $this->belongsTo(Exercise::class);
    }

    public function workoutDay(): BelongsTo
    {
        return $this->belongsTo(WorkoutDay::class);
    }
}
