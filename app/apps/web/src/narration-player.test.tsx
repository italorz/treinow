// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NarrationPlayer } from "./narration";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const request = vi.mocked(api);
let utterances: SpeechSynthesisUtterance[];
beforeEach(() => {
  utterances = [];
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => { utterances.push(utterance); utterance.onstart?.({} as SpeechSynthesisEvent); }),
    cancel: vi.fn(), resume: vi.fn(), pause: vi.fn(),
    getVoices: () => [{ lang: "pt-BR", name: "Google português do Brasil" }],
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); request.mockReset(); });
it("speaks with the browser voice, highlights the line, and never calls the speech API", () => {
  render(<NarrationPlayer text="Respire."/>);
  fireEvent.click(screen.getByText("Ouvir orientação do instrutor"));
  expect(utterances).toHaveLength(1);
  expect(utterances[0].lang).toBe("pt-BR");
  expect(utterances[0].voice).toEqual({ lang: "pt-BR", name: "Google português do Brasil" });
  expect(screen.getByText("Respire.").getAttribute("aria-current")).toBe("true");
  expect(screen.queryByRole("status")).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("pauses and resumes the same browser utterance without fetching audio", () => {
  render(<NarrationPlayer text="Respire."/>);
  fireEvent.click(screen.getByText("Ouvir orientação do instrutor"));
  fireEvent.click(screen.getByText("Pausar"));
  expect(window.speechSynthesis.pause).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Ouvir orientação do instrutor"));
  expect(window.speechSynthesis.resume).toHaveBeenCalled();
  expect(utterances).toHaveLength(1);
  expect(request).not.toHaveBeenCalled();
});
