@props(['name'])

@php
    $paths = [
        'user' => '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0v.75H4.5v-.75Z" />',
        'today' => '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
        'dumbbell' => '<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 6.5l11 11M4 9l-1.5 1.5a2 2 0 0 0 0 2.8L4 15M9 4L7.5 5.5M20 9l1.5 1.5a2 2 0 0 1 0 2.8L20 15M15 20l-1.5-1.5M6.5 8.5l-2 2M17.5 13.5l-2 2" />',
        'calendar' => '<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 8.25h18M4.5 5.25h15A1.5 1.5 0 0 1 21 6.75v12A1.5 1.5 0 0 1 19.5 20.25h-15A1.5 1.5 0 0 1 3 18.75v-12a1.5 1.5 0 0 1 1.5-1.5Z" />',
    ];
@endphp

<svg {{ $attributes->merge(['class' => 'h-5 w-5']) }} fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
    {!! $paths[$name] ?? $paths['today'] !!}
</svg>
