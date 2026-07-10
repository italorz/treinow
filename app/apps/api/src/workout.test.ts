import { describe, expect, it } from "vitest";
import { safePromptProfile } from "./privacy.js";

describe("safePromptProfile", () => {
  it("remove identificadores, foto e vídeo do prompt", () => {
    const result = safePromptProfile({
      name: "Pessoa", email: "secret@example.com", tenantId: "tenant", photo: "bytes", video: "bytes",
      goal: "ganhar_massa", weightKg: 80, injuries: [{ region: "joelho" }]
    });
    expect(result).toEqual({ goal: "ganhar_massa", weightKg: 80, injuries: [{ region: "joelho" }], progressSummary: {} });
    expect(JSON.stringify(result)).not.toMatch(/secret|tenant|photo|video|Pessoa/);
  });
});
