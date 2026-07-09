<?php

namespace App\Http\Controllers;

use App\Models\Exercise;
use App\Models\User;
use App\Models\WorkoutDay;
use App\Models\WorkoutExerciseItem;
use Illuminate\Http\Request;

class HojeController extends Controller
{
    public function index()
    {
        $user = User::current();
        $weekday = now()->dayOfWeek; // 0 = domingo ... 6 = sábado

        $day = WorkoutDay::where('user_id', $user->id)
            ->where('weekday', $weekday)
            ->first();

        $items = collect();
        if ($day) {
            $items = WorkoutExerciseItem::with(['exercise', 'reserveExercise'])
                ->where('workout_day_id', $day->id)
                ->orderBy('position')
                ->get();
        }

        $total = $items->count();
        $done = $items->where('is_done', true)->count();
        $progress = $total > 0 ? (int) round($done / $total * 100) : 0;

        return view('hoje', compact('day', 'items', 'total', 'done', 'progress', 'weekday'));
    }

    public function swap(Request $request, WorkoutExerciseItem $item)
    {
        if ($item->reserve_exercise_id) {
            // Já existe uma reserva definida (pela IA, ou promovida por uma
            // troca anterior): apenas alterna os dois — o exercício que sai
            // vira a nova reserva, permitindo trocar de volta depois.
            [$item->exercise_id, $item->reserve_exercise_id] = [$item->reserve_exercise_id, $item->exercise_id];
            $item->save();
        } else {
            // Sem reserva pré-definida (dia antigo/manual): usa a alternativa
            // escolhida na hora e a promove a reserva, habilitando alternar.
            $data = $request->validate([
                'exercise_id' => ['required', 'exists:exercises,id'],
            ]);

            $item->reserve_exercise_id = $item->exercise_id;
            $item->exercise_id = $data['exercise_id'];
            $item->save();
        }

        $item->refresh();

        return response()->json([
            'ok' => true,
            'exercise' => $item->exercise,
            'reserve' => $item->reserveExercise,
        ]);
    }

    public function toggleDone(WorkoutExerciseItem $item)
    {
        $item->update(['is_done' => ! $item->is_done]);

        return response()->json(['ok' => true, 'is_done' => $item->is_done]);
    }
}
