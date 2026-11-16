import { describe, expect, it } from "vitest";
import { parseVtt } from "./narration";

describe("narration subtitles", () => {
  it("parses identifiers, hour/minute timestamps, multiline cues and settings", () => {
    expect(parseVtt("WEBVTT\r\n\r\n1\r\n00:00:01.250 --> 00:00:03.500\r\nAtenção\r\nRespire\r\n\r\n00:04.000 --> 00:06.000 align:center\r\nControle <b>o movimento</b>\r\n")).toEqual([
      { start: 1.25, end: 3.5, text: "Atenção\nRespire" },
      { start: 4, end: 6, text: "Controle o movimento" },
    ]);
  });
  it("ignores metadata and invalid timings", () => {
    expect(parseVtt("WEBVTT\n\nNOTE orientação geral\n\ninvalid --> 00:03.000\nInválida\n\n00:04.000 --> 00:02.000\nInvertida")).toEqual([]);
  });
});
