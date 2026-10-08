import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KudosForm } from "./KudosForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("KudosForm", () => {
  it("requires a selected colleague and a non-empty message", async () => {
    const onCreated = vi.fn();
    render(<KudosForm csrfToken="csrf-token" currentUserId="self" onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a colleague");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("selects a directory result and submits with CSRF and idempotency headers", async () => {
    const onCreated = vi.fn();
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      requests.push({ url, options });
      const payload = url.includes("/users/search")
        ? { items: [{ id: "colleague-1", name: "Alex Colleague" }] }
        : {
          item: {
            id: "kudos-1",
            sender: { id: "self", name: "Taylor" },
            recipient: { id: "colleague-1", name: "Alex Colleague" },
            message: "Thanks for being a great teammate.",
            createdAt: "2026-10-08T09:00:00.000Z",
          },
        };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    }));

    render(<KudosForm csrfToken="csrf-token" currentUserId="self" onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: /who deserves/i }), "Alex");
    await user.click(await screen.findByRole("option", { name: /alex colleague/i }));
    await user.type(screen.getByLabelText("Your message"), "Thanks for being a great teammate.");
    await user.click(screen.getByRole("button", { name: /send kudos/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Kudos sent to Alex Colleague.");
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "kudos-1" }));
    const submit = requests.find((entry) => entry.url.endsWith("/kudos"));
    expect(submit).toBeDefined();
    const headers = new Headers(submit?.options?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(String(submit?.options?.body))).toEqual({
      recipientUserId: "colleague-1",
      message: "Thanks for being a great teammate.",
    });
  });

  it("displays the Unicode code-point count and rejects an over-limit message", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => String(input).includes("/users/search")
        ? { items: [{ id: "colleague-1", name: "Alex Colleague" }] }
        : {},
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    render(<KudosForm csrfToken="csrf-token" currentUserId="self" onCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: /who deserves/i }), "Alex");
    await user.click(await screen.findByRole("option", { name: /alex colleague/i }));
    const text = "😀".repeat(501);
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: text } });
    expect(screen.getByText("501 / 500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send kudos/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("500 characters or fewer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/users/search");
  });
});
