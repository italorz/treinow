<?php

namespace App\Http\Controllers;

use App\Models\Exercise;
use App\Services\ExerciseSwapService;
use Illuminate\Http\Request;

class ExerciciosController extends Controller
{
    public function index()
    {
        $muscles = Exercise::MUSCLES;

        $counts = Exercise::query()
            ->whereNotNull('muscle_group')
            ->selectRaw('muscle_group, count(*) as total')
            ->groupBy('muscle_group')
            ->pluck('total', 'muscle_group');

        return view('exercicios', compact('muscles', 'counts'));
    }

    public function list(Request $request)
    {
        $muscle = $request->query('muscle');

        $query = Exercise::query()->whereNotNull('muscle_group');

        if ($muscle && array_key_exists($muscle, Exercise::MUSCLES)) {
            $query->where('muscle_group', $muscle);
        }

        return $query->orderBy('is_stretch')
            ->orderBy('name')
            ->paginate(15);
    }

    public function alternatives(Exercise $exercise, ExerciseSwapService $swap)
    {
        return response()->json($swap->alternatives($exercise));
    }
}
