import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { clearVideoCache, getVideoUrl } from "./video-source";

vi.mock("./api", () => ({ api: vi.fn() }));
const mockedApi = vi.mocked(api);
beforeEach(() => { clearVideoCache(); mockedApi.mockReset(); });

it("shares a pending request between preview and expanded video", async () => {
  mockedApi.mockResolvedValue({ url: "/video" });
  expect(await Promise.all([getVideoUrl("exercise"), getVideoUrl("exercise"), getVideoUrl("exercise")])).toEqual(["/video", "/video", "/video"]);
  expect(mockedApi).toHaveBeenCalledTimes(1);
  await getVideoUrl("exercise");
  expect(mockedApi).toHaveBeenCalledTimes(1);
});

it("does not mix gender variants", async () => {
  mockedApi.mockResolvedValueOnce({ url: "/female" }).mockResolvedValueOnce({ url: "/male" });
  expect(await getVideoUrl("exercise", "feminino")).toBe("/female");
  expect(await getVideoUrl("exercise", "masculino")).toBe("/male");
  expect(mockedApi).toHaveBeenCalledTimes(2);
});

it("retries a failed request instead of retaining a rejected promise", async () => {
  mockedApi.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ url: "/recovered" });
  await expect(getVideoUrl("exercise")).rejects.toThrow("offline");
  expect(await getVideoUrl("exercise")).toBe("/recovered");
});

it("refreshes cached URLs before the signed link expires", async () => {
  const clock = vi.spyOn(Date, "now");
  try {
    clock.mockReturnValue(1000);
    mockedApi.mockResolvedValueOnce({ url: "/first" }).mockResolvedValueOnce({ url: "/refreshed" });
    expect(await getVideoUrl("exercise")).toBe("/first");
    clock.mockReturnValue(1000 + 4 * 60_000 + 1);
    expect(await getVideoUrl("exercise")).toBe("/refreshed");
    expect(mockedApi).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});

it("does not restore old account data after clearing the cache", async () => {
  let finishOld!: (data: { url: string }) => void;
  mockedApi.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve as typeof finishOld; }));
  const oldRequest = getVideoUrl("exercise");
  clearVideoCache();
  mockedApi.mockResolvedValueOnce({ url: "/new-session" });
  expect(await getVideoUrl("exercise")).toBe("/new-session");
  finishOld({ url: "/old-session" });
  await oldRequest;
  expect(await getVideoUrl("exercise")).toBe("/new-session");
});
