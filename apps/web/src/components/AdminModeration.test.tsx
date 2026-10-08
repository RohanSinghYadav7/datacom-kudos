import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminModeration } from "./AdminModeration";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdminModeration", () => {
  it("requires a reason, hides a kudos item, and confirms permanent deletion", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      requests.push({ url, options });
      if (options?.method === "DELETE") return { ok: true, status: 204 } as Response;
      if (options?.method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "kudos-1", isVisible: false }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            id: "kudos-1",
            sender: { id: "sender-1", name: "Sam" },
            recipient: { id: "recipient-1", name: "Rae" },
            message: "Thanks for helping.",
            createdAt: "2026-10-08T09:00:00.000Z",
            isVisible: true,
            moderation: null,
          }],
          nextCursor: null,
        }),
      } as Response;
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<AdminModeration csrfToken="csrf-token" />);
    const user = userEvent.setup();
    expect(await screen.findByText("Thanks for helping.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide from feed" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a reason");

    const reason = screen.getByLabelText("Reason for action");
    await user.type(reason, "Reported as inappropriate.");
    await user.click(screen.getByRole("button", { name: "Hide from feed" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Kudos hidden from the public feed.");
    expect(screen.getByText("Hidden")).toBeInTheDocument();

    await user.clear(reason);
    await user.type(reason, "Requested removal.");
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("Kudos permanently deleted.");
    expect(screen.queryByText("Thanks for helping.")).not.toBeInTheDocument();

    const hideRequest = requests.find((entry) => entry.options?.method === "POST");
    expect(JSON.parse(String(hideRequest?.options?.body))).toEqual({
      action: "hide",
      reason: "Reported as inappropriate.",
    });
    expect(new Headers(hideRequest?.options?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(requests.some((entry) => entry.options?.method === "DELETE")).toBe(true);
  });
});
