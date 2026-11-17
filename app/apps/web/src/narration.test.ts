import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSpeech, parseScript } from "./speech";

describe("script pauses", () => {
  it("keeps short line pauses and longer block pauses", () => {
    expect(parseScript("\n Prepare.\r\nRespire.\r\n \r\n\r\nMova.\n")).toEqual([
      { text: "Prepare.", pause: 0 }, { text: "Respire.", pause: 350 }, { text: "Mova.", pause: 800 },
    ]);
    expect(parseScript("\n \n")).toEqual([]);
  });
});

describe("browser speech fallback", () => {
  const utterances: SpeechSynthesisUtterance[] = [];
  const pt = { lang: "pt-BR", name: "Instrutor" } as SpeechSynthesisVoice;
  const synth = { cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), getVoices: () => [{ lang: "en-US" }, pt],
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => { utterances.push(utterance); utterance.onstart?.({} as SpeechSynthesisEvent); }) };
  beforeEach(() => {
    vi.useFakeTimers(); utterances.length = 0; vi.clearAllMocks();
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const end = () => utterances.at(-1)?.onend?.({} as SpeechSynthesisEvent);
  it("uses pt-BR, highlights each line and respects both pauses", () => {
    const line = vi.fn(), done = vi.fn();
    browserSpeech("Prepare.\nRespire.\n\nMova.", line, done, vi.fn());
    expect(utterances[0].lang).toBe("pt-BR"); expect(utterances[0].voice).toBe(pt);
    expect(line).toHaveBeenLastCalledWith(0);
    end(); vi.advanceTimersByTime(349); expect(utterances).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(line).toHaveBeenLastCalledWith(1);
    end(); vi.advanceTimersByTime(799); expect(utterances).toHaveLength(2);
    vi.advanceTimersByTime(1); expect(line).toHaveBeenLastCalledWith(2);
    end(); expect(done).toHaveBeenCalledOnce();
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
