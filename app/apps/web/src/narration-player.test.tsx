// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    speak: vi.fn(u => { utterances.push(u); u.onstart?.({}); }), cancel: vi.fn(), resume: vi.fn(), pause: vi.fn(), getVoices: () => [],
  } });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); request.mockReset(); });
it("speaks immediately on preparing, highlights the line, and uses ready audio on the next click without polling", async () => {
  request.mockResolvedValueOnce({ status: "preparing", text: "Respire.", lines: [{ text: "Respire.", pause: 0 }] })
    .mockResolvedValueOnce({ status: "ready", text: "Respire.", audioUrl: "/audio.mp3", cues: [], durationSeconds: 1 });
  render(<NarrationPlayer id="one" text="Respire."/>);
  fireEvent.click(screen.getByText("Ouvir orientação do instrutor"));
  await waitFor(() => expect(utterances).toHaveLength(1));
  expect(utterances[0].lang).toBe("pt-BR");
  expect(screen.getByText("Respire.").getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("status").textContent).toContain("Usando a voz do navegador");
  act(() => utterances[0].onend?.({} as SpeechSynthesisEvent));
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Ouvir orientação do instrutor"));
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce());
  expect(screen.queryByRole("status")).toBeNull();
  expect(utterances).toHaveLength(1);
});
it("falls back to browser speech when the endpoint fails", async () => {
  request.mockRejectedValueOnce(new Error("unavailable"));
  render(<NarrationPlayer id="one" text="Respire."/>);
  fireEvent.click(screen.getByText("Ouvir orientação do instrutor"));
  await waitFor(() => expect(utterances).toHaveLength(1));
  expect(screen.getByRole("status").textContent).toContain("Usando a voz do navegador");
});
