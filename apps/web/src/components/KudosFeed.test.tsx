import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KudosFeed } from "./KudosFeed";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("KudosFeed", () => {
  it("renders message content as text and shows the empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: "item-1",
          sender: { id: "s1", name: "Sam" },
          recipient: { id: "r1", name: "Rae" },
          message: "<script>alert(1)</script>",
          createdAt: "2026-10-08T09:00:00.000Z",
        }],
        nextCursor: null,
      }),
    } as Response)));

    render(<KudosFeed />);
    expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();

    cleanup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);
    render(<KudosFeed newItem={null} />);
    expect(await screen.findByText("It starts with you")).toBeInTheDocument();
  });
});
