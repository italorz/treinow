<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Classificador determinístico de exercícios a partir do nome do arquivo de vídeo.
 *
 * Retorna músculo primário, secundários, equipamento, padrão de movimento e flags.
 * Nomes que não casam com nenhuma regra retornam muscle_group = null (candidatos ao
 * fallback via Gemini).
 */
class ExerciseClassifier
{
    /**
     * Prefixos de duas letras (código) → equipamento.
     */
    private const CODE_EQUIPMENT = [
        'BB' => 'barra',
        'DB' => 'halter',
        'CB' => 'cabo',
        'LV' => 'maquina',
        'SM' => 'smith',
        'KB' => 'kettlebell',
        'BW' => 'peso_corporal',
        'WT' => 'peso_corporal',
        'EX' => 'peso_corporal',
        'SB' => 'peso_corporal', // stability ball
    ];

    /**
     * Palavras completas no início do nome → equipamento.
     */
    private const WORD_EQUIPMENT = [
        'barbell' => 'barra',
        'dumbbell' => 'halter',
        'cable' => 'cabo',
        'lever' => 'maquina',
        'machine' => 'maquina',
        'smith' => 'smith',
        'kettlebell' => 'kettlebell',
        'bodyweight' => 'peso_corporal',
        'weighted' => 'peso_corporal',
        'suspension' => 'peso_corporal',
        'band' => 'elastico',
        'resistanceband' => 'elastico',
        'plate' => 'anilha',
        'medicine' => 'outro',
        'sled' => 'maquina',
        'trapbar' => 'barra',
        'ezbar' => 'barra',
        'landmine' => 'barra',
    ];

    /**
     * Regras ordenadas (específico → genérico). Primeiro "needle" encontrado no
     * haystack (nome minúsculo, apenas letras, sem espaços) define o músculo.
     *
     * @var array<int, array{needles: array<int,string>, muscle: string, pattern: string, secondary?: array<int,string>}>
     */
    private const RULES = [
        // Antebraço
        ['needles' => ['wristcurl', 'reversewrist', 'wristextension', 'wristflexion', 'wristroller', 'wristcircle', 'forearm', 'radialdeviation', 'ulnardeviation', 'ulnarflexion', 'pronation', 'supination', 'gripper', 'fingerextension', 'extensor', 'praying'], 'muscle' => 'antebraco', 'pattern' => 'curl'],

        // Pernas — posterior de coxa
        ['needles' => ['legcurl', 'lyingleg', 'seatedleg', 'romaniandeadlift', 'stiffleg', 'straightleg', 'goodmorning', 'glutehamraise', 'hamstring'], 'muscle' => 'pernas', 'pattern' => 'hinge', 'secondary' => ['gluteos']],
        // Pernas — quadríceps / extensão
        ['needles' => ['legextension'], 'muscle' => 'pernas', 'pattern' => 'extension'],
        ['needles' => ['legpress', 'hacksquat', 'sissysquat'], 'muscle' => 'pernas', 'pattern' => 'squat'],

        // Panturrilha
        ['needles' => ['calfraise', 'calf', 'gastroc', 'toeraise', 'tibia', 'anklecircle', 'anklejump'], 'muscle' => 'panturrilha', 'pattern' => 'raise'],

        // Peitoral
        ['needles' => ['benchpress', 'chestpress', 'pecdeck', 'peckdeck', 'pecfly', 'chestfly', 'crossover', 'inclinepress', 'declinepress', 'inclinefly', 'chestdip', 'svend', 'chest', 'floorpress'], 'muscle' => 'peitoral', 'pattern' => 'press', 'secondary' => ['triceps', 'ombro']],
        ['needles' => ['pushup', 'pushpress', 'pressup'], 'muscle' => 'peitoral', 'pattern' => 'press', 'secondary' => ['triceps', 'ombro', 'core']],
        ['needles' => ['fly', 'flye'], 'muscle' => 'peitoral', 'pattern' => 'fly'],

        // Ombro
        ['needles' => ['lateralraise', 'frontraise', 'sideraise', 'reardelt', 'rearlateral', 'rearlateralraise', 'deltoid', 'delt', 'shoulderpress', 'overheadpress', 'militarypress', 'arnoldpress', 'uprightrow', 'scaption', 'facepull', 'lraise', 'yraise', 'cubanpress', 'shoulder', 'armcircle', 'armswing', 'externalrotation', 'internalrotation', 'externalrotator', 'internalrotator', 'rotatorcuff', 'handstand', 'isopress', 'protraction', 'retraction', 'shadowbox', 'shoulderraise', 'milpress', 'straightarm', 'crossarm'], 'muscle' => 'ombro', 'pattern' => 'raise', 'secondary' => ['trapezio']],

        // Trapézio / pescoço
        ['needles' => ['shrug', 'neck', 'splenius'], 'muscle' => 'trapezio', 'pattern' => 'shrug'],

        // Costas
        ['needles' => ['pulldown', 'latpull', 'pullup', 'chinup', 'pullover', 'row', 'deadlift', 'backextension', 'hyperexten', 'superman', 'goodmorningpull', 'birddog', 'renegade', 'backstretch', 'backswing'], 'muscle' => 'costas', 'pattern' => 'row', 'secondary' => ['biceps']],

        // Glúteos (antes de tríceps por causa de "glutekickback")
        ['needles' => ['glute', 'hipthrust', 'hipraise', 'bridge', 'hipexten', 'hipabduction', 'donkey', 'frogpump', 'kickbackglute', 'pretzel', 'piriformis', 'clamshell', 'kettlebellswing', 'doubleswing'], 'muscle' => 'gluteos', 'pattern' => 'hinge'],

        // Bíceps (antes de qualquer "curl" residual, mas depois de wrist/leg curl)
        ['needles' => ['bicepscurl', 'hammercurl', 'preachercurl', 'concentrationcurl', 'spidercurl', 'inclinecurl', 'curl', 'biceps'], 'muscle' => 'biceps', 'pattern' => 'curl'],

        // Tríceps
        ['needles' => ['triceps', 'pushdown', 'skullcrusher', 'skull', 'kickback', 'overheadextension', 'frenchpress', 'closegrip', 'dip', 'extension'], 'muscle' => 'triceps', 'pattern' => 'extension'],

        // Pernas — agachamento / avanço / pliometria / levantamentos olímpicos
        ['needles' => ['squat', 'lunge', 'stepup', 'stepdown', 'steptoe', 'toetap', 'splitsquat', 'gobletsquat', 'pistolsquat', 'bulgarian', 'wallsit', 'ironchair', 'thruster', 'jump', 'leap', 'bound', 'highknee', 'buttkick', 'legswing', 'legcircle', 'legcycle', 'leglift', 'quadriceps', 'quad', 'shuffle', 'skater', 'straddle', 'hipadduction', 'adductor', 'adduction', 'groin', 'thigh', 'shin', 'itband', 'assistedquad', 'clean', 'snatch', 'jerk', 'burpee'], 'muscle' => 'pernas', 'pattern' => 'squat', 'secondary' => ['gluteos']],

        // Core / abdômen
        ['needles' => ['crunch', 'situp', 'plank', 'twist', 'sidebend', 'russiantwist', 'legraise', 'kneeraise', 'kneein', 'abwheel', 'abroller', 'mountainclimber', 'hollow', 'vup', 'flutterkick', 'bicycle', 'oblique', 'deadbug', 'windshield', 'toestobar', 'heeltouch', 'toetouch', 'toereach', 'reachtoe', 'wiper', 'pike', 'lsit', 'scissors', 'kneepull', 'hanging', 'windmill', 'woodchopper', 'figure8', 'bearcrawl', 'crabcrawl', 'jackknife', 'scissorkick', 'tablemaker', 'broomstick', 'waist', 'abdominal', 'standingab', 'supineab', 'leanback', 'buttups'], 'muscle' => 'core', 'pattern' => 'core'],

        // Catch-all: "press" e "raise" residuais → ombro (demais já tratados acima).
        ['needles' => ['press', 'raise'], 'muscle' => 'ombro', 'pattern' => 'raise'],
    ];

    /**
     * @return array{name:string, muscle_group:?string, secondary_muscles:array, equipment:string, movement_pattern:?string, is_unilateral:bool, is_stretch:bool}
     */
    public function classify(string $baseName): array
    {
        $base = $this->stripNumericPrefix($baseName);
        $tokens = $this->tokenize($base);
        $haystack = strtolower(preg_replace('/[^a-zA-Z]/', '', $base));

        $equipment = $this->detectEquipment($tokens, $haystack);
        $isStretch = str_contains($haystack, 'stretch');
        $isUnilateral = $this->detectUnilateral($haystack)
            || strtoupper($tokens[0] ?? '') === 'SL';

        [$muscle, $pattern, $secondary] = $this->detectMuscle($haystack);

        if ($isStretch) {
            $pattern = 'stretch';
        }

        return [
            'name' => $this->displayName($tokens),
            'muscle_group' => $muscle,
            'secondary_muscles' => $secondary,
            'equipment' => $equipment,
            'movement_pattern' => $pattern,
            'is_unilateral' => $isUnilateral,
            'is_stretch' => $isStretch,
        ];
    }

    private function stripNumericPrefix(string $name): string
    {
        return preg_replace('/^\d+/', '', $name) ?: $name;
    }

    /**
     * Divide CamelCase, snake_case e hífens em tokens.
     *
     * @return array<int,string>
     */
    private function tokenize(string $base): array
    {
        $spaced = str_replace(['_', '-'], ' ', $base);
        // Insere espaço nas fronteiras CamelCase.
        $spaced = preg_replace('/(?<=[a-z0-9])(?=[A-Z])/', ' ', $spaced);
        $spaced = preg_replace('/(?<=[A-Z])(?=[A-Z][a-z])/', ' ', $spaced);
        $spaced = preg_replace('/\s+/', ' ', trim($spaced));

        return $spaced === '' ? [] : explode(' ', $spaced);
    }

    private function detectEquipment(array $tokens, string $haystack): string
    {
        $first = $tokens[0] ?? '';

        // 1) Código de duas letras (ex.: DB, CB, LV).
        if (isset(self::CODE_EQUIPMENT[strtoupper($first)]) && strlen($first) === 2 && ctype_upper($first)) {
            return self::CODE_EQUIPMENT[strtoupper($first)];
        }

        // 2) Palavra no início do nome.
        foreach (self::WORD_EQUIPMENT as $word => $equip) {
            if (str_starts_with($haystack, $word)) {
                return $equip;
            }
        }

        // 3) Palavra em qualquer posição.
        foreach (self::WORD_EQUIPMENT as $word => $equip) {
            if (str_contains($haystack, $word)) {
                return $equip;
            }
        }

        // 4) Sem indício de peso externo → peso corporal.
        return 'peso_corporal';
    }

    private function detectUnilateral(string $haystack): bool
    {
        foreach (['singlearm', 'onearm', 'singleleg', 'oneleg', 'alternating', 'alternate', 'unilateral', 'singleside'] as $needle) {
            if (str_contains($haystack, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{0:?string, 1:?string, 2:array}
     */
    private function detectMuscle(string $haystack): array
    {
        foreach (self::RULES as $rule) {
            foreach ($rule['needles'] as $needle) {
                if (str_contains($haystack, $needle)) {
                    return [$rule['muscle'], $rule['pattern'], $rule['secondary'] ?? []];
                }
            }
        }

        return [null, null, []];
    }

    private function displayName(array $tokens): string
    {
        // Remove um eventual token de código de equipamento no início.
        if (isset($tokens[0]) && strlen($tokens[0]) === 2 && ctype_upper($tokens[0]) && isset(self::CODE_EQUIPMENT[$tokens[0]])) {
            array_shift($tokens);
        }

        $name = trim(implode(' ', $tokens));
        $name = Str::of($name)->squish()->title()->toString();

        return $name !== '' ? $name : 'Exercício';
    }
}
