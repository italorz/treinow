@extends('layouts.app')

@section('title', 'Exercícios')

@php
    // Hotspots (%) calibrados sobre as imagens reais do Écorché em public/images/.
    // Formato: [músculo, left%, top%, width%, height%]. A proporção do container
    // acompanha a da imagem (ratio) para que as % mapeiem direto sobre o corpo.
    $ecorche = [
        'frente' => [
            'ratio' => 941 / 1672,
            'spots' => [
                ['ombro', 22, 19, 12, 7], ['ombro', 66, 19, 12, 7],
                ['peitoral', 36, 23, 28, 9],
                ['biceps', 18, 27, 12, 9], ['biceps', 70, 27, 12, 9],
                ['antebraco', 13, 38, 12, 11], ['antebraco', 75, 38, 12, 11],
                ['core', 39, 31, 22, 12],
                ['pernas', 33, 47, 34, 19],
                ['panturrilha', 35, 70, 30, 16],
            ],
        ],
        'verso' => [
            'ratio' => 864 / 1821,
            'spots' => [
                ['trapezio', 36, 14, 28, 8],
                ['costas', 30, 24, 40, 16],
                ['triceps', 16, 27, 12, 9], ['triceps', 72, 27, 12, 9],
                ['gluteos', 33, 44, 34, 13],
                ['pernas', 33, 59, 34, 14],
                ['panturrilha', 34, 75, 32, 13],
            ],
        ],
    ];
@endphp

@section('content')
<div x-data="exerciseBrowser()" class="px-4 py-4">

    {{-- Écorché frente e verso --}}
    <div class="grid grid-cols-2 gap-3">
        @foreach ($ecorche as $view => $data)
            <div class="relative overflow-hidden rounded-2xl bg-black"
                 style="aspect-ratio: {{ $data['ratio'] }}">
                <img src="{{ asset('images/ecorche-'.$view.'.png') }}" alt="Écorché {{ $view }}"
                     class="h-full w-full object-contain"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                <div class="absolute inset-0 hidden flex-col items-center justify-center text-center text-xs text-slate-400" style="display:none">
                    <span class="text-3xl">🧍</span>
                    <span class="mt-1 px-2">Écorché {{ $view }}<br>(gerar imagem)</span>
                </div>
                @foreach ($data['spots'] as [$muscle, $left, $top, $w, $h])
                    <button type="button"
                            @click="select('{{ $muscle }}', '{{ $muscles[$muscle] }}')"
                            :class="{ 'is-active': muscle === '{{ $muscle }}' }"
                            class="hotspot"
                            title="{{ $muscles[$muscle] }}"
                            style="left: {{ $left }}%; top: {{ $top }}%; width: {{ $w }}%; height: {{ $h }}%"></button>
                @endforeach
                <span class="absolute bottom-1 left-0 right-0 text-center text-[10px] font-medium uppercase tracking-wide text-white/50">{{ $view }}</span>
            </div>
        @endforeach
    </div>

    {{-- Chips de músculos --}}
    <div class="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
        @foreach ($muscles as $key => $label)
            <button type="button"
                    @click="select('{{ $key }}', '{{ $label }}')"
                    :class="muscle === '{{ $key }}' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'"
                    class="shrink-0 rounded-full border border-slate-200 px-3.5 py-1.5 text-xs font-medium shadow-sm">
                {{ $label }} <span class="opacity-60">({{ $counts[$key] ?? 0 }})</span>
            </button>
        @endforeach
    </div>

    {{-- Instrução / cabeçalho da lista --}}
    <div class="mt-4">
        <template x-if="!muscle">
            <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Clique em um músculo no corpo ou nos filtros acima para ver os exercícios relacionados.
            </div>
        </template>

        <template x-if="muscle">
            <h2 class="mb-3 text-sm font-semibold text-slate-900">
                Exercícios de <span class="capitalize text-blue-600" x-text="muscleLabel"></span>
            </h2>
        </template>
    </div>

    {{-- Lista com scroll infinito --}}
    <div class="space-y-2">
        <template x-for="ex in items" :key="ex.id">
            <div class="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-sm">
                <video :data-src="ex.video_url" x-init="$el.dataset.src = ex.video_url; window.registerVideo($el)"
                       muted loop playsinline preload="none"
                       class="h-16 w-16 shrink-0 rounded-xl bg-slate-200 object-cover"></video>
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-slate-800" x-text="ex.name"></p>
                    <p class="mt-0.5 text-[11px] text-slate-500">
                        <span x-text="ex.equipment_label"></span>
                        <template x-if="ex.is_stretch"><span class="ml-1 rounded bg-amber-100 px-1 text-amber-700">alongamento</span></template>
                    </p>
                </div>
                <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] capitalize text-slate-500" x-text="ex.muscle_label"></span>
            </div>
        </template>
    </div>

    {{-- Sentinela / loader do scroll infinito --}}
    <div x-show="muscle" class="py-6 text-center">
        <template x-if="loading">
            <p class="text-sm text-slate-400">Carregando mais…</p>
        </template>
        <template x-if="!loading && page >= lastPage && items.length > 0">
            <p class="text-xs text-slate-400">Você chegou ao fim.</p>
        </template>
        <div x-init="new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore() }, { rootMargin: '250px' }).observe($el)" class="h-1"></div>
    </div>
</div>
@endsection
