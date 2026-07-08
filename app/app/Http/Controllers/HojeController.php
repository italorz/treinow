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
            $items = WorkoutExerciseItem::with('exercise')
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
        $data = $request->validate([
            'exercise_id' => ['required', 'exists:exercises,id'],
        ]);

        $item->update(['exercise_id' => $data['exercise_id']]);

        return response()->json([
            'ok' => true,
            'exercise' => $item->fresh()->exercise,
        ]);
    }

    public function toggleDone(WorkoutExerciseItem $item)
    {
        $item->update(['is_done' => ! $item->is_done]);

        return response()->json(['ok' => true, 'is_done' => $item->is_done]);
    }
}
