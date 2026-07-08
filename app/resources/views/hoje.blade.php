@extends('layouts.app')

@section('title', 'Hoje')

@section('content')
<div x-data="todayWorkout()" class="px-4 py-4">

    @if (! $day || $day->is_rest || $total === 0)
        <div class="rounded-3xl bg-white p-8 text-center shadow-sm">
            <p class="text-4xl">🧘</p>
            <h2 class="mt-3 text-lg font-semibold text-slate-900">
                {{ $day?->title ?? 'Sem treino para hoje' }}
            </h2>
            <p class="mt-1 text-sm text-slate-500">
                Aproveite para descansar ou gere um treino no seu perfil.
            </p>
            <a href="{{ route('perfil') }}" class="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white">
                Ir para o perfil
            </a>
        </div>
    @else
        {{-- Cabeçalho do treino --}}
        <div class="rounded-3xl bg-white p-5 shadow-sm">
            <div class="flex items-start justify-between">
                <div>
                    <h2 class="text-lg font-bold text-slate-900">Treino de hoje</h2>
                    <p class="text-sm text-slate-500">{{ $done }} de {{ $total }} exercícios</p>
                </div>
                <span class="text-sm font-semibold text-blue-600">{{ $progress }}% concluído</span>
            </div>
            <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-blue-600 transition-all" style="width: {{ $progress }}%"></div>
            </div>
            @if ($day->title)
                <p class="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">{{ $day->title }}</p>
            @endif
        </div>

        {{-- Lista de exercícios --}}
        <div class="mt-4 space-y-3">
            @foreach ($items as $index => $item)
                @php $ex = $item->exercise; @endphp
                <div class="flex gap-3 rounded-2xl bg-white p-3 shadow-sm {{ $item->is_done ? 'opacity-60' : '' }}">
                    <button @click="toggleDone({{ $item->id }})" class="mt-1 shrink-0" aria-label="Concluir">
                        @if ($item->is_done)
                            <span class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">✓</span>
                        @else
                            <span class="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-300 text-xs text-slate-400">{{ $index + 1 }}</span>
                        @endif
                    </button>

                    <x-exercise-video :src="$ex->video_url" class="h-20 w-20 shrink-0" />

                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <h3 class="truncate text-sm font-semibold text-slate-900">{{ $ex->name }}</h3>
                            <span class="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{{ $ex->equipment_label }}</span>
                        </div>
                        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                            <span>{{ $item->sets }} séries</span>
                            <span>{{ $item->reps }} repetições</span>
                            <span class="capitalize">{{ $ex->muscle_label }}</span>
                        </div>
                        <button @click="openSwap({{ $item->id }}, {{ $ex->id }}, '{{ addslashes($ex->name) }}')"
                                class="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            ⇄ Trocar
                        </button>
                    </div>
                </div>
            @endforeach
        </div>

        <button class="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30">
            Iniciar treino ▶
        </button>
    @endif

    {{-- Modal de substituição inteligente --}}
    <div x-show="swapOpen" x-cloak class="fixed inset-0 z-50 flex items-end justify-center" style="display:none">
        <div @click="closeSwap()" class="absolute inset-0 bg-black/50"></div>
        <div x-show="swapOpen" x-transition:enter="transition ease-out duration-200"
             x-transition:enter-start="translate-y-full" x-transition:enter-end="translate-y-0"
             class="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 pb-8">
            <div class="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200"></div>
            <div class="flex items-center gap-2">
                <span class="rounded-lg bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">✦ Substituição inteligente</span>
            </div>
            <p class="mt-3 text-sm text-slate-500">Trocando <span class="font-semibold text-slate-800" x-text="swapFor"></span> por uma alternativa com halter:</p>

            <template x-if="loadingAlt">
                <p class="py-6 text-center text-sm text-slate-400">Buscando alternativas…</p>
            </template>

            <template x-if="!loadingAlt && alternatives.length === 0">
                <p class="py-6 text-center text-sm text-slate-400">Nenhuma alternativa com halter encontrada.</p>
            </template>

            <div class="mt-3 max-h-80 space-y-2 overflow-y-auto">
                <template x-for="alt in alternatives" :key="alt.id">
                    <button @click="confirmSwap(alt.id)" class="flex w-full items-center gap-3 rounded-2xl border border-slate-100 p-2.5 text-left hover:border-blue-300 hover:bg-blue-50">
                        <video :data-src="alt.video_url" x-init="$el.src = alt.video_url" muted loop playsinline preload="metadata" class="h-14 w-14 rounded-xl bg-slate-200 object-cover"></video>
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium text-slate-800" x-text="alt.name"></p>
                            <p class="text-[11px] text-slate-500">
                                <span x-text="alt.equipment_label"></span> · <span class="capitalize" x-text="alt.muscle_label"></span>
                            </p>
                        </div>
                        <span class="text-green-600">✓</span>
                    </button>
                </template>
            </div>

            <button @click="closeSwap()" class="mt-4 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-600">Cancelar</button>
        </div>
    </div>
</div>
@endsection
