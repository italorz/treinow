@extends('layouts.app')

@section('title', 'Eu')

@php
    $avatar = $prefs->avatar_path
        ? asset($prefs->avatar_path)
        : 'https://ui-avatars.com/api/?name='.urlencode($user->name).'&background=2563eb&color=fff';

    $val = fn ($field, $default = null) => old($field, $prefs->{$field} ?? $default);
    $arr = fn ($field) => old($field, $prefs->{$field} ?? []) ?: [];

    $restricoesOptions = [
        'ombro' => 'Ombro', 'joelho' => 'Joelho', 'lombar' => 'Lombar',
        'punho' => 'Punho', 'cotovelo' => 'Cotovelo', 'quadril' => 'Quadril',
        'tornozelo' => 'Tornozelo', 'pescoco' => 'Pescoço',
    ];
@endphp

@section('content')
<div class="px-4 py-4">

    {{-- Cabeçalho do perfil --}}
    <div class="flex items-center gap-4 rounded-3xl bg-white p-4 shadow-sm">
        <img src="{{ $avatar }}" alt="Avatar" class="h-16 w-16 rounded-full object-cover">
        <div>
            <h2 class="text-lg font-bold text-slate-900">{{ $user->name }}</h2>
            <p class="text-sm text-slate-500">{{ $user->email }}</p>
            <span class="mt-1 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">✦ Membro Pro</span>
        </div>
    </div>

    <h3 class="mt-5 mb-2 text-sm font-semibold text-slate-900">Gerar treino customizado</h3>

    <form method="POST" action="{{ route('perfil.update') }}" class="space-y-4">
        @csrf

        <div class="grid grid-cols-2 gap-3">
            {{-- Objetivo --}}
            <label class="col-span-2 block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Objetivo</span>
                <select name="objetivo" class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm">
                    @foreach (['hipertrofia' => 'Hipertrofia', 'forca' => 'Força', 'emagrecimento' => 'Emagrecimento', 'resistencia' => 'Resistência', 'condicionamento' => 'Condicionamento'] as $k => $v)
                        <option value="{{ $k }}" @selected($val('objetivo') === $k)>{{ $v }}</option>
                    @endforeach
                </select>
            </label>

            {{-- Nível --}}
            <label class="col-span-2 block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Nível</span>
                <select name="nivel" class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm">
                    @foreach (['iniciante' => 'Iniciante', 'intermediario' => 'Intermediário', 'avancado' => 'Avançado'] as $k => $v)
                        <option value="{{ $k }}" @selected($val('nivel') === $k)>{{ $v }}</option>
                    @endforeach
                </select>
            </label>

            {{-- Dias por semana --}}
            <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Dias por semana</span>
                <select name="dias_por_semana" class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm">
                    @for ($i = 1; $i <= 7; $i++)
                        <option value="{{ $i }}" @selected((int) $val('dias_por_semana') === $i)>{{ $i }} dias</option>
                    @endfor
                </select>
            </label>

            {{-- Duração --}}
            <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Duração do treino</span>
                <select name="duracao_min" class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm">
                    @foreach (['30-45' => '30-45 min', '45-60' => '45-60 min', '60-75' => '60-75 min', '75-90' => '75-90 min'] as $k => $v)
                        <option value="{{ $k }}" @selected($val('duracao_min') === $k)>{{ $v }}</option>
                    @endforeach
                </select>
            </label>

            {{-- Sexo --}}
            <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Sexo</span>
                <select name="sexo" class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm">
                    @foreach (['masculino' => 'Masculino', 'feminino' => 'Feminino', 'outro' => 'Outro'] as $k => $v)
                        <option value="{{ $k }}" @selected($val('sexo') === $k)>{{ $v }}</option>
                    @endforeach
                </select>
            </label>

            {{-- Idade --}}
            <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Idade</span>
                <input type="number" name="idade" value="{{ $val('idade') }}" min="10" max="100" class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm">
            </label>

            {{-- Peso --}}
            <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Peso (kg)</span>
                <input type="number" step="0.1" name="peso" value="{{ $val('peso') }}" class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm">
            </label>

            {{-- Altura --}}
            <label class="block">
                <span class="mb-1 block text-xs font-medium text-slate-600">Altura (cm)</span>
                <input type="number" name="altura" value="{{ $val('altura') }}" class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm">
            </label>
        </div>

        {{-- Preferência / Local --}}
        <div>
            <span class="mb-1 block text-xs font-medium text-slate-600">Preferência</span>
            <div class="grid grid-cols-2 gap-2">
                @foreach (['academia' => 'Academia', 'casa' => 'Casa'] as $k => $v)
                    <label class="cursor-pointer">
                        <input type="radio" name="local" value="{{ $k }}" class="peer sr-only" @checked($val('local', 'academia') === $k)>
                        <span class="block rounded-xl border border-slate-200 py-2 text-center text-sm font-medium text-slate-600 peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white">{{ $v }}</span>
                    </label>
                @endforeach
            </div>
        </div>

        {{-- Equipamentos disponíveis --}}
        <div>
            <span class="mb-1 block text-xs font-medium text-slate-600">Equipamentos disponíveis</span>
            <div class="grid grid-cols-2 gap-2">
                @foreach ($equipmentOptions as $k => $v)
                    @continue($k === 'outro')
                    <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <input type="checkbox" name="equipamentos[]" value="{{ $k }}" @checked(in_array($k, $arr('equipamentos'))) class="rounded text-blue-600">
                        {{ $v }}
                    </label>
                @endforeach
            </div>
        </div>

        {{-- Músculos prioritários (até 3) --}}
        <div x-data="{ sel: @js(array_values($arr('musculos_prioritarios'))) }">
            <span class="mb-1 block text-xs font-medium text-slate-600">Músculos prioritários (até 3)</span>
            <div class="flex flex-wrap gap-2">
                @foreach ($muscles as $k => $v)
                    <label>
                        <input type="checkbox" name="musculos_prioritarios[]" value="{{ $k }}" x-model="sel"
                               :disabled="!sel.includes('{{ $k }}') && sel.length >= 3" class="peer sr-only">
                        <span class="block cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-disabled:opacity-40">{{ $v }}</span>
                    </label>
                @endforeach
            </div>
        </div>

        {{-- Restrições / Lesões --}}
        <div>
            <span class="mb-1 block text-xs font-medium text-slate-600">Restrições / Lesões</span>
            <div class="grid grid-cols-2 gap-2">
                @foreach ($restricoesOptions as $k => $v)
                    <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <input type="checkbox" name="restricoes[]" value="{{ $k }}" @checked(in_array($k, $arr('restricoes'))) class="rounded text-blue-600">
                        {{ $v }}
                    </label>
                @endforeach
            </div>
        </div>

        {{-- Outras preferências --}}
        <div class="space-y-2">
            <span class="block text-xs font-medium text-slate-600">Outras preferências</span>
            <label class="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="evitar_unilaterais" value="1" @checked($val('evitar_unilaterais')) class="rounded text-blue-600">
                Evitar exercícios unilaterais
            </label>
            <label class="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="treinos_intensos" value="1" @checked($val('treinos_intensos')) class="rounded text-blue-600">
                Treinos mais intensos
            </label>
        </div>

        {{-- Ações --}}
        <div class="space-y-2 pt-2">
            <button type="submit" class="w-full rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-700">
                Salvar preferências
            </button>
            <button type="submit" formaction="{{ route('perfil.generate') }}"
                    class="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30">
                Gerar treino customizado ✦
            </button>
            <p class="text-center text-[11px] text-slate-400">Dados estruturados para geração com IA (Gemini)</p>
        </div>
    </form>
</div>
@endsection
