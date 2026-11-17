export type ScriptLine = { text: string; pause: number };

export function parseScript(text: string): ScriptLine[] {
  const result: ScriptLine[] = [];
  let pause = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line) {
      result.push({ text: line, pause: result.length ? pause : 0 });
      pause = 350;
    } else if (result.length) pause = 800;
  }
  return result;
}

const FEMALE_HINTS = [
  "female", "feminina", "woman",
  "google portugues do brasil",
  "francisca", "maria", "thalita", "luciana", "joana", "fernanda",
  "vitoria", "helena", "leticia", "gabriela", "camila", "daniela",
];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[_-]+/g, " ");
}

function language(voice: SpeechSynthesisVoice) {
  return voice.lang.toLowerCase().replaceAll("_", "-");
}

function isFemaleVoice(voice: SpeechSynthesisVoice) {
  return FEMALE_HINTS.some(hint => normalize(voice.name).includes(hint));
}

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const ptBr = voices.filter(voice => language(voice) === "pt-br");
  const pt = voices.filter(voice => language(voice).startsWith("pt"));
  return ptBr.find(isFemaleVoice) ?? ptBr[0] ?? pt.find(isFemaleVoice) ?? pt[0] ?? null;
}

function applyVoice(utterance: SpeechSynthesisUtterance, voices: SpeechSynthesisVoice[]) {
  utterance.lang = "pt-BR";
  utterance.rate = 0.95;
  utterance.voice = pickVoice(voices);
}

function whenVoicesReady(synth: SpeechSynthesis, onReady: (voices: SpeechSynthesisVoice[]) => void) {
  const existing = synth.getVoices();
  if (existing.length || typeof synth.addEventListener !== "function") {
    onReady(existing);
    return () => {};
  }
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    synth.removeEventListener("voiceschanged", finish);
    clearTimeout(timer);
    onReady(synth.getVoices());
  };
  synth.addEventListener("voiceschanged", finish);
  const timer = setTimeout(finish, 750);
  return () => { settled = true; synth.removeEventListener("voiceschanged", finish); clearTimeout(timer); };
}

// One utterance per line; pausing also freezes the silence between lines.
export function browserSpeech(text: string, onLine: (index: number) => void, onEnd: () => void, onError: () => void) {
  const synth = window.speechSynthesis;
  const lines = parseScript(text);
  let index = 0, paused = false, stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = 0, started = 0, waiting = false;
  const cancelVoices = whenVoicesReady(synth, voices => {
    if (stopped) return;
    synth.cancel();
    synth.resume(); // cancel() preserves the paused state in some browsers.
    speak(voices);
  });
  function schedule(delay: number) {
    remaining = delay; waiting = true; started = Date.now();
    timer = setTimeout(() => { waiting = false; speak(synth.getVoices()); }, delay);
  }
  function speak(voices: SpeechSynthesisVoice[]) {
    if (stopped) return;
    if (index >= lines.length) { stopped = true; onEnd(); return; }
    const utterance = new SpeechSynthesisUtterance(lines[index].text);
    applyVoice(utterance, voices);
    utterance.onstart = () => { if (!stopped) onLine(index); };
    utterance.onend = () => {
      if (stopped) return;
      index++;
      if (index >= lines.length) { stopped = true; onEnd(); }
      else { remaining = lines[index].pause; waiting = true; if (!paused) schedule(remaining); }
    };
    utterance.onerror = () => { if (!stopped) { stopped = true; onError(); } };
    synth.speak(utterance);
  }
  return {
    pause() {
      if (stopped || paused) return;
      paused = true;
      if (waiting) { clearTimeout(timer); remaining = Math.max(0, remaining - (Date.now() - started)); }
      synth.pause();
    },
    resume() {
      if (stopped || !paused) return;
      paused = false; synth.resume();
      if (waiting) schedule(remaining);
    },
    stop() { stopped = true; cancelVoices(); clearTimeout(timer); synth.cancel(); },
  };
}

export type ExecutionGuideScript = {
  execucao?: string[];
  evitarLesoes?: string[];
  cargaExcessiva?: { normal?: string; alerta?: string[]; pare?: string };
  narracao?: string;
  disclaimer?: string;
};

export type GuidanceScript = {
  description?: string;
  steps?: string[];
  commonMistake?: string;
  attention?: string;
  sensation?: string;
  stop?: string;
  targetMuscles?: string[];
};

export function spokenScript(executionGuide?: ExecutionGuideScript | null, guidance?: GuidanceScript | null): string {
  if (executionGuide?.narracao?.trim()) return executionGuide.narracao.trim();
  const blocks: string[][] = [];
  const add = (title: string, lines: string[]) => {
    const parts = [title, ...lines.map(line => line.trim()).filter(Boolean)].filter(Boolean);
    if (parts.length) blocks.push(parts);
  };
  if (executionGuide) {
    add("Como executar.", executionGuide.execucao ?? []);
    add("Como evitar lesões.", executionGuide.evitarLesoes ?? []);
    const load = executionGuide.cargaExcessiva;
    if (load) {
      const lines: string[] = [];
      if (load.normal) lines.push(`Normal. ${load.normal}`);
      if (load.alerta?.length) { lines.push("Alerta."); lines.push(...load.alerta); }
      if (load.pare) lines.push(`Quando parar. ${load.pare}`);
      add("Sinais de carga excessiva.", lines);
    }
    if (executionGuide.disclaimer) add("", [executionGuide.disclaimer]);
  } else if (guidance) {
    if (guidance.description) add("", [guidance.description]);
    add("Como executar.", guidance.steps ?? []);
    const extra: string[] = [];
    if (guidance.commonMistake) extra.push(`Observe. ${guidance.commonMistake}`);
    if (guidance.attention) extra.push(`Atenção. ${guidance.attention}`);
    if (guidance.targetMuscles?.length) extra.push(`Foco muscular. ${guidance.targetMuscles.join(", ")}.`);
    if (guidance.sensation) extra.push(guidance.sensation);
    if (guidance.stop) extra.push(guidance.stop);
    if (extra.length) add("", extra);
  }
  return blocks.map(block => block.join("\n")).join("\n\n").trim();
}
