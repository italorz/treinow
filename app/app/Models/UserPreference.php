<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserPreference extends Model
{
    protected $guarded = [];

    protected $casts = [
        'equipamentos' => 'array',
        'musculos_prioritarios' => 'array',
        'restricoes' => 'array',
        'evitar_unilaterais' => 'boolean',
        'treinos_intensos' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
