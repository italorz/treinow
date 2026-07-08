<!DOCTYPE html>
<html lang="pt-BR" class="h-full">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Treinow')</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="h-full bg-slate-200 text-slate-800 antialiased">
@php
    $avatar = $currentUser?->preference?->avatar_path
        ? asset($currentUser->preference->avatar_path)
        : 'https://ui-avatars.com/api/?name='.urlencode($currentUser?->name ?? 'U').'&background=2563eb&color=fff';
@endphp

<div x-data="{ menu: false }" class="relative mx-auto flex min-h-full w-full max-w-md flex-col bg-slate-50 shadow-xl">

    {{-- Cabeçalho --}}
    <header class="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
        <button @click="menu = true" class="rounded-lg p-1 text-slate-700 hover:bg-slate-100" aria-label="Abrir menu">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
        </button>
        <h1 class="text-base font-semibold text-slate-900">@yield('title', 'Treinow')</h1>
        <div class="w-8">@yield('header-action')</div>
    </header>

    {{-- Drawer / Menu hambúrguer --}}
    <div x-show="menu" x-cloak class="fixed inset-0 z-40" style="display:none">
        <div @click="menu = false" x-show="menu" x-transition.opacity class="absolute inset-0 bg-black/50"></div>
        <aside x-show="menu" x-transition:enter="transition ease-out duration-200"
               x-transition:enter-start="-translate-x-full" x-transition:enter-end="translate-x-0"
               x-transition:leave="transition ease-in duration-150"
               x-transition:leave-start="translate-x-0" x-transition:leave-end="-translate-x-full"
               class="absolute inset-y-0 left-0 flex w-72 flex-col bg-slate-900 p-5 text-white">
            <div class="flex items-center justify-between">
                <span class="text-lg font-bold">Treinow</span>
                <button @click="menu = false" class="rounded-lg p-1 hover:bg-white/10" aria-label="Fechar menu">
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {{-- Perfil "Eu" --}}
            <a href="{{ route('perfil') }}" class="mt-6 flex items-center gap-3 rounded-2xl bg-white/5 p-3 hover:bg-white/10">
                <img src="{{ $avatar }}" alt="Avatar" class="h-12 w-12 rounded-full object-cover">
                <div>
                    <p class="font-semibold">{{ $currentUser?->name ?? 'Usuário' }}</p>
                    <p class="text-xs text-slate-400">Ver perfil</p>
                </div>
            </a>

            <nav class="mt-6 space-y-1">
                @php $nav = [
                    ['perfil', 'Eu', 'user'],
                    ['hoje', 'Hoje', 'today'],
                    ['exercicios', 'Exercícios', 'dumbbell'],
                    ['semana', 'Semana', 'calendar'],
                ]; @endphp
                @foreach ($nav as [$route, $label, $icon])
                    <a href="{{ route($route) }}"
                       class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition
                       {{ request()->routeIs($route.'*') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10' }}">
                        <x-nav-icon :name="$icon" class="h-5 w-5" />
                        {{ $label }}
                    </a>
                @endforeach
            </nav>

            <div class="mt-auto space-y-3">
                <div class="rounded-2xl bg-blue-600/90 p-4">
                    <p class="text-sm font-semibold">✦ Seja Premium</p>
                    <p class="mt-1 text-xs text-blue-100">Desbloqueie recursos exclusivos e evolua mais.</p>
                </div>
                <p class="text-center text-[11px] text-slate-500">v1.0.0</p>
            </div>
        </aside>
    </div>

    {{-- Conteúdo --}}
    <main class="flex-1 overflow-y-auto pb-24">
        @if (session('status'))
            <div class="mx-4 mt-3 rounded-xl bg-green-100 px-4 py-2 text-sm text-green-800">{{ session('status') }}</div>
        @endif
        @if (session('error'))
            <div class="mx-4 mt-3 rounded-xl bg-red-100 px-4 py-2 text-sm text-red-800">{{ session('error') }}</div>
        @endif
        @yield('content')
    </main>

    {{-- Tab bar inferior --}}
    <nav class="fixed bottom-0 z-20 mx-auto flex w-full max-w-md items-center justify-around border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur">
        @php $tabs = [
            ['hoje', 'Hoje', 'today'],
            ['exercicios', 'Exercícios', 'dumbbell'],
            ['semana', 'Semana', 'calendar'],
            ['perfil', 'Eu', 'user'],
        ]; @endphp
        @foreach ($tabs as [$route, $label, $icon])
            <a href="{{ route($route) }}"
               class="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] font-medium
               {{ request()->routeIs($route.'*') ? 'text-blue-600' : 'text-slate-400' }}">
                <x-nav-icon :name="$icon" class="h-6 w-6" />
                {{ $label }}
            </a>
        @endforeach
    </nav>
</div>

<style>[x-cloak]{display:none!important}</style>
</body>
</html>
