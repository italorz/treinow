@props(['src', 'class' => 'h-20 w-20'])

{{-- Vídeo mudo em loop, carregado/reproduzido só quando visível (lazy). --}}
<video
    data-autoplay-video
    x-init="window.registerVideo($el)"
    data-src="{{ $src }}"
    muted loop playsinline preload="none"
    {{ $attributes->merge(['class' => 'rounded-xl bg-slate-200 object-cover '.$class]) }}
></video>
