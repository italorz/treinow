import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSpeech, parseScript, pickVoice, spokenScript } from "./speech";

describe("script pauses", () => {
  it("keeps short line pauses and longer block pauses", () => {
    expect(parseScript("\n Prepare.\r\nRespire.\r\n \r\n\r\nMova.\n")).toEqual([
      { text: "Prepare.", pause: 0 }, { text: "Respire.", pause: 350 }, { text: "Mova.", pause: 800 },
    ]);
    expect(parseScript("\n \n")).toEqual([]);
  });
});

describe("spoken script fallback", () => {
  it("prefers the written narration when it exists", () => {
    expect(spokenScript({ narracao: "  Prepare.\nRespire.  ", execucao: ["Ignore."] })).toBe("Prepare.\nRespire.");
  });
  it("reads execution sections when the new narration is missing", () => {
    expect(spokenScript({
      execucao: ["Mova com controle."],
      evitarLesoes: ["Evite compensações."],
      cargaExcessiva: { normal: "Esforço muscular.", alerta: ["Perda de controle."], pare: "Dor aguda." },
      disclaimer: "Orientação geral, não substitui um profissional.",
    })).toBe([
      "Como executar.", "Mova com controle.",
      "", "Como evitar lesões.", "Evite compensações.",
      "", "Sinais de carga excessiva.", "Normal. Esforço muscular.", "Alerta.", "Perda de controle.", "Quando parar. Dor aguda.",
      "", "Orientação geral, não substitui um profissional.",
    ].join("\n"));
  });
  it("reads generic movement cues when there is no execution guide", () => {
    expect(spokenScript(null, {
      description: "Exercício de puxada.",
      steps: ["Apoie os pés.", "Puxe com controle."],
      commonMistake: "Encolher os ombros.",
      attention: "Pare se sentir dor.",
      targetMuscles: ["costas", "bíceps"],
      sensation: "O esforço pode aparecer nas costas.",
      stop: "Interrompa se houver dor aguda.",
    })).toBe([
      "Exercício de puxada.",
      "", "Como executar.", "Apoie os pés.", "Puxe com controle.",
      "", "Observe. Encolher os ombros.", "Atenção. Pare se sentir dor.",
      "Foco muscular. costas, bíceps.", "O esforço pode aparecer nas costas.", "Interrompa se houver dor aguda.",
    ].join("\n"));
  });
});

describe("female pt-BR voice selection", () => {
  const voice = (lang: string, name: string) => ({ lang, name } as SpeechSynthesisVoice);
  it("prefers a female pt-BR voice over male or other languages", () => {
    expect(pickVoice([
      voice("en-US", "Google US English"),
      voice("pt-BR", "Microsoft Antonio"),
      voice("pt-PT", "Joana"),
      voice("pt-BR", "Microsoft Francisca"),
    ])?.name).toBe("Microsoft Francisca");
  });
  it("treats Google português do Brasil as a female voice", () => {
    expect(pickVoice([
      voice("pt-BR", "Google português do Brasil"),
      voice("pt-BR", "Microsoft Antonio"),
    ])?.name).toBe("Google português do Brasil");
  });
  it("falls back to any pt-BR, then any Portuguese voice", () => {
    expect(pickVoice([voice("pt-PT", "Joana"), voice("pt-BR", "Microsoft Antonio")])?.name).toBe("Microsoft Antonio");
    expect(pickVoice([voice("en-US", "Samantha"), voice("pt-PT", "Joana")])?.name).toBe("Joana");
    expect(pickVoice([voice("en-US", "Samantha")])).toBeNull();
  });
});

describe("browser speech", () => {
  const utterances: SpeechSynthesisUtterance[] = [];
  const francisca = { lang: "pt-BR", name: "Microsoft Francisca" } as SpeechSynthesisVoice;
  const antonio = { lang: "pt-BR", name: "Microsoft Antonio" } as SpeechSynthesisVoice;
  let voices: SpeechSynthesisVoice[] = [antonio, francisca];
  const listeners = new Map<string, Set<() => void>>();
  const synth = {
    cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    getVoices: () => voices,
    addEventListener: vi.fn((event: string, handler: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler); listeners.set(event, set);
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => { listeners.get(event)?.delete(handler); }),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => { utterances.push(utterance); utterance.onstart?.({} as SpeechSynthesisEvent); }),
  };
  beforeEach(() => {
    vi.useFakeTimers(); utterances.length = 0; voices = [antonio, francisca]; listeners.clear(); vi.clearAllMocks();
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const end = () => utterances.at(-1)?.onend?.({} as SpeechSynthesisEvent);
  it("uses a female pt-BR voice, highlights each line and respects both pauses", () => {
    const line = vi.fn(), done = vi.fn();
    browserSpeech("Prepare.\nRespire.\n\nMova.", line, done, vi.fn());
    expect(utterances[0].lang).toBe("pt-BR"); expect(utterances[0].voice).toBe(francisca);
    expect(line).toHaveBeenLastCalledWith(0);
    end(); vi.advanceTimersByTime(349); expect(utterances).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(line).toHaveBeenLastCalledWith(1);
    end(); vi.advanceTimersByTime(799); expect(utterances).toHaveLength(2);
    vi.advanceTimersByTime(1); expect(line).toHaveBeenLastCalledWith(2);
    end(); expect(done).toHaveBeenCalledOnce();
  });
  it("waits for voiceschanged before speaking when voices load late", () => {
    voices = [];
    const line = vi.fn();
    browserSpeech("Prepare.", line, vi.fn(), vi.fn());
    expect(utterances).toHaveLength(0);
    voices = [antonio, francisca];
    listeners.get("voiceschanged")?.forEach(handler => handler());
    expect(utterances[0].voice).toBe(francisca);
    expect(line).toHaveBeenLastCalledWith(0);
  });
  it("pauses and resumes the remaining silence, and stops queued speech", () => {
    const line = vi.fn();
    const controller = browserSpeech("Um.\nDois.\nTrês.", line, vi.fn(), vi.fn());
    end(); vi.advanceTimersByTime(100); controller.pause();
    expect(synth.pause).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000); expect(utterances).toHaveLength(1);
    controller.resume(); vi.advanceTimersByTime(249); expect(utterances).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(utterances).toHaveLength(2);
    end(); controller.stop(); vi.advanceTimersByTime(1000);
    expect(utterances).toHaveLength(2);
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });
  it("resets a paused synthesizer when starting again after stop", () => {
    const first = browserSpeech("Um.", vi.fn(), vi.fn(), vi.fn());
    first.pause(); first.stop();
    browserSpeech("Dois.", vi.fn(), vi.fn(), vi.fn());
    expect(synth.resume).toHaveBeenCalledTimes(2);
    expect(utterances.at(-1)?.text).toBe("Dois.");
  });
  it("ignores events arriving after stop and reports synthesis errors", () => {
    const done = vi.fn(), error = vi.fn();
    const controller = browserSpeech("Um.", vi.fn(), done, error);
    controller.stop(); end(); utterances[0].onerror?.({} as SpeechSynthesisErrorEvent);
    expect(done).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    browserSpeech("Um.", vi.fn(), done, error);
    utterances.at(-1)?.onerror?.({} as SpeechSynthesisErrorEvent);
    expect(error).toHaveBeenCalledOnce();
  });
});
