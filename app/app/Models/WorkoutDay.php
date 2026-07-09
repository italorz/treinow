<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class WorkoutDay extends Model
{
    protected $guarded = [];

    protected $casts = [
        'focus_muscles' => 'array',
        'is_rest' => 'boolean',
    ];

    public const WEEKDAYS = [
        0 => 'Domingo',
        1 => 'Segunda-feira',
        2 => 'Terça-feira',
        3 => 'Quarta-feira',
        4 => 'Quinta-feira',
        5 => 'Sexta-feira',
        6 => 'Sábado',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function exercises(): BelongsToMany
    {
        return $this->belongsToMany(Exercise::class, 'workout_day_exercise')
            ->withPivot(['id', 'position', 'sets', 'reps', 'rest_seconds', 'note', 'is_done', 'reserve_exercise_id'])
            ->withTimestamps()
            ->orderBy('workout_day_exercise.position');
    }

    public function getWeekdayLabelAttribute(): string
    {
        return self::WEEKDAYS[$this->weekday] ?? '';
    }
}
