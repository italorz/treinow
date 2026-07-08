@extends('layouts.app')

@section('title', 'Semana')

@php
    $weekdayLabels = \App\Models\WorkoutDay::WEEKDAYS;
    $shortLabels = [0 => 'Dom', 1 => 'Seg', 2 => 'Ter', 3 => 'Qua', 4 => 'Qui', 5 => 'Sex', 6 => 'Sáb'];
@endphp

@section('content')
<div class="px-4 py-4">

    {{-- Faixa de dias --}}
    <div class="mb-4 flex justify-between rounded-2xl bg-white p-3 shadow-sm">
        @foreach ($order as $wd)
            @php $d = $days[$wd] ?? null; @endphp
            <div class="flex flex-col items-center gap-1">
                <span class="text-[11px] text-slate-400">{{ $shortLabels[$wd] }}</span>
                <span class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold
                    {{ $wd === $today ? 'bg-blue-600 text-white' : 'text-slate-700' }}">
                    {{ $wd === $today ? '•' : '' }}
                </span>
                <span class="h-1.5 w-1.5 rounded-full {{ $d && ! $d->is_rest ? 'bg-green-500' : 'bg-slate-200' }}"></span>
            </div>
        @endforeach
    </div>

    {{-- Cartões dos dias --}}
    <div class="space-y-3">
        @foreach ($order as $wd)
            @php $d = $days[$wd] ?? null; @endphp
            <div class="rounded-2xl bg-white p-4 shadow-sm {{ $wd === $today ? 'ring-2 ring-blue-500' : '' }}">
                <div class="flex items-start justify-between">
                    <div>
                        <p class="text-xs font-medium text-slate-400">
                            {{ $weekdayLabels[$wd] }}{{ $wd === $today ? ' · Hoje' : '' }}
                        </p>
                        <h3 class="mt-0.5 text-base font-semibold text-slate-900">
                            {{ $d?->title ?? 'Descanso' }}
                        </h3>
                        @if ($d && ! $d->is_rest)
                            <p class="mt-1 text-xs text-slate-500">
                                {{ $d->exercises_count }} exercícios
                                @if ($d->duration_min) · {{ $d->duration_min }} min @endif
                            </p>
                            @if (! empty($d->focus_muscles))
                                <div class="mt-2 flex flex-wrap gap-1">
                                    @foreach ($d->focus_muscles as $m)
                                        <span class="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium capitalize text-blue-700">
                                            {{ \App\Models\Exercise::MUSCLES[$m] ?? $m }}
                                        </span>
                                    @endforeach
                                </div>
                            @endif
                        @else
                            <p class="mt-1 text-xs text-slate-400">Recuperação</p>
                        @endif
                    </div>
                    <span class="text-2xl">
                        {{ $d && ! $d->is_rest ? '🏋️' : '😴' }}
                    </span>
                </div>
            </div>
        @endforeach
    </div>
</div>
@endsection
