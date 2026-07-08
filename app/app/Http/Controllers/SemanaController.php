<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\WorkoutDay;

class SemanaController extends Controller
{
    public function index()
    {
        $user = User::current();

        $days = WorkoutDay::withCount('exercises')
            ->where('user_id', $user->id)
            ->get()
            ->keyBy('weekday');

        // Ordena de segunda (1) a domingo (0).
        $order = [1, 2, 3, 4, 5, 6, 0];
        $today = now()->dayOfWeek;

        return view('semana', compact('days', 'order', 'today'));
    }
}
