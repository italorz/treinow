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

    /**
     * Reserva específica deste slot (mesmo alvo muscular exato do exercício
     * ativo). "Trocar" alterna exercise_id <-> reserve_exercise_id.
     */
    public function reserveExercise(): BelongsTo
    {
        return $this->belongsTo(Exercise::class, 'reserve_exercise_id');
    }

    public function workoutDay(): BelongsTo
    {
        return $this->belongsTo(WorkoutDay::class);
    }
}
