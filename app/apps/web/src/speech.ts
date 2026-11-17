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

// One utterance per line; pausing also freezes the silence between lines.
export function browserSpeech(text: string, onLine: (index: number) => void, onEnd: () => void, onError: () => void) {
  const synth = window.speechSynthesis;
  const lines = parseScript(text);
  let index = 0, paused = false, stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = 0, started = 0, waiting = false;
  function schedule(delay: number) {
    remaining = delay; waiting = true; started = Date.now();
    timer = setTimeout(() => { waiting = false; speak(); }, delay);
  }
  function speak() {
    if (stopped) return;
    if (index >= lines.length) { stopped = true; onEnd(); return; }
    const utterance = new SpeechSynthesisUtterance(lines[index].text);
    utterance.lang = "pt-BR";
    utterance.rate = 0.95;
    const voices = synth.getVoices();
    utterance.voice = voices.find(v => v.lang.toLowerCase().replace("_", "-") === "pt-br")
      ?? voices.find(v => v.lang.toLowerCase().startsWith("pt")) ?? null;
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
  synth.cancel();
  synth.resume(); // cancel() preserves the paused state in some browsers.
  speak();
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
    stop() { stopped = true; clearTimeout(timer); synth.cancel(); },
  };
}
