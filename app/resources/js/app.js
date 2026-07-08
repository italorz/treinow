import Alpine from 'alpinejs';

window.Alpine = Alpine;

// Helper: token CSRF para requisições fetch (POST).
window.csrf = () =>
    document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';

// Reproduz vídeos (mudos, em loop) apenas quando visíveis, evitando carregar
// centenas de vídeos de uma vez.
const videoObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            const video = entry.target;
            if (entry.isIntersecting) {
                if (!video.src && video.dataset.src) {
                    video.src = video.dataset.src;
                }
                video.play?.().catch(() => {});
            } else {
                video.pause?.();
            }
        });
    },
    { rootMargin: '100px', threshold: 0.25 }
);

window.registerVideo = (el) => {
    if (el && el.tagName === 'VIDEO') {
        videoObserver.observe(el);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document
        .querySelectorAll('video[data-autoplay-video]')
        .forEach((el) => window.registerVideo(el));
});

/**
 * Componente de scroll infinito da tela Exercícios.
 * Carrega exercícios paginados de /api/exercicios?muscle=...&page=...
 */
Alpine.data('exerciseBrowser', (initialMuscle = null) => ({
    muscle: initialMuscle,
    muscleLabel: '',
    items: [],
    page: 0,
    lastPage: 1,
    loading: false,

    init() {
        if (this.muscle) {
            this.select(this.muscle, this.muscleLabel);
        }
        this.$watch('page', () => {});
    },

    async select(muscle, label = '') {
        this.muscle = muscle;
        this.muscleLabel = label || muscle;
        this.items = [];
        this.page = 0;
        this.lastPage = 1;
        await this.loadMore();
    },

    async loadMore() {
        if (this.loading || !this.muscle) return;
        if (this.page >= this.lastPage) return;
        this.loading = true;
        try {
            const next = this.page + 1;
            const res = await fetch(
                `/api/exercicios?muscle=${encodeURIComponent(this.muscle)}&page=${next}`,
                { headers: { Accept: 'application/json' } }
            );
            const json = await res.json();
            this.items.push(...json.data);
            this.page = json.current_page;
            this.lastPage = json.last_page;
        } catch (e) {
            console.error('Falha ao carregar exercícios', e);
        } finally {
            this.loading = false;
        }
    },
}));

/**
 * Componente da tela Hoje: troca inteligente de exercício e concluir.
 */
Alpine.data('todayWorkout', () => ({
    swapOpen: false,
    swapPivotId: null,
    swapFor: null,
    alternatives: [],
    loadingAlt: false,

    async openSwap(pivotId, exerciseId, exerciseName) {
        this.swapOpen = true;
        this.swapPivotId = pivotId;
        this.swapFor = exerciseName;
        this.alternatives = [];
        this.loadingAlt = true;
        try {
            const res = await fetch(`/exercicios/${exerciseId}/alternativas`, {
                headers: { Accept: 'application/json' },
            });
            this.alternatives = await res.json();
        } catch (e) {
            console.error(e);
        } finally {
            this.loadingAlt = false;
        }
    },

    closeSwap() {
        this.swapOpen = false;
        this.swapPivotId = null;
    },

    async confirmSwap(newExerciseId) {
        const res = await fetch(`/hoje/${this.swapPivotId}/trocar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': window.csrf(),
                Accept: 'application/json',
            },
            body: JSON.stringify({ exercise_id: newExerciseId }),
        });
        if (res.ok) {
            window.location.reload();
        }
    },

    async toggleDone(pivotId) {
        await fetch(`/hoje/${pivotId}/concluir`, {
            method: 'POST',
            headers: {
                'X-CSRF-TOKEN': window.csrf(),
                Accept: 'application/json',
            },
        });
        window.location.reload();
    },
}));

Alpine.start();
