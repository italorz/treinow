<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Exercise extends Model
{
    protected $guarded = [];

    protected $casts = [
        'secondary_muscles' => 'array',
        'is_unilateral' => 'boolean',
        'is_stretch' => 'boolean',
    ];

    protected $appends = ['video_url', 'video_loop_url', 'equipment_label', 'muscle_label'];

    public const MUSCLES = [
        'peitoral' => 'Peitoral',
        'costas' => 'Costas',
        'ombro' => 'Ombro',
        'biceps' => 'Bíceps',
        'triceps' => 'Tríceps',
        'pernas' => 'Pernas',
        'panturrilha' => 'Panturrilha',
        'gluteos' => 'Glúteos',
        'core' => 'Core',
        'antebraco' => 'Antebraço',
        'trapezio' => 'Trapézio',
    ];

    public const EQUIPMENT = [
        'maquina' => 'Máquina',
        'halter' => 'Halter',
        'barra' => 'Barra',
        'cabo' => 'Cabo',
        'smith' => 'Smith',
        'kettlebell' => 'Kettlebell',
        'peso_corporal' => 'Peso corporal',
        'anilha' => 'Anilha',
        'elastico' => 'Elástico',
        'outro' => 'Outro',
    ];

    public function getVideoUrlAttribute(): string
    {
        return asset('videos/'.$this->video_path);
    }

    public function getVideoLoopUrlAttribute(): ?string
    {
        return $this->video_loop_path ? asset('videos/'.$this->video_loop_path) : null;
    }

    public function getEquipmentLabelAttribute(): string
    {
        return self::EQUIPMENT[$this->equipment] ?? Str::title($this->equipment);
    }

    public function getMuscleLabelAttribute(): string
    {
        return self::MUSCLES[$this->muscle_group] ?? Str::title($this->muscle_group);
    }
}
