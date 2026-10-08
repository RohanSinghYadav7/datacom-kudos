import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest, type AdminKudosItem } from "../api";

type AdminModerationProps = { csrfToken: string };

export function AdminModeration({ csrfToken }: AdminModerationProps) {
  const [items, setItems] = useState<AdminKudosItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadItems = useCallback(async (nextCursor?: string | null) => {
    setError("");
    setLoading(true);
    try {
      const search = new URLSearchParams({ limit: "20" });
      if (nextCursor) search.set("cursor", nextCursor);
      const response = await apiRequest<{ items: AdminKudosItem[]; nextCursor: string | null }>(`/v1/admin/kudos?${search}`);
      setItems((previous) => nextCursor ? [...previous, ...response.items.filter((item) => !previous.some((old) => old.id === item.id))] : response.items);
      setCursor(response.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Moderation records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function moderate(item: AdminKudosItem, action: "hide" | "restore" | "delete") {
    const reason = reasons[item.id]?.trim() ?? "";
    if (!reason) {
      setError("Enter a reason for this moderation action.");
      return;
    }
    if (action === "delete" && !window.confirm("Permanently delete this kudos? This cannot be undone.")) return;
    setError("");
    setNotice("");
    setBusyId(item.id);
    try {
      if (action === "delete") {
        await apiRequest<void>(`/v1/admin/kudos/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
          body: JSON.stringify({ reason }),
        }, csrfToken);
        setItems((previous) => previous.filter((row) => row.id !== item.id));
        setNotice("Kudos permanently deleted.");
      } else {
        const response = await apiRequest<{ id: string; isVisible: boolean }>(
          `/v1/admin/kudos/${encodeURIComponent(item.id)}/moderation`,
          { method: "POST", body: JSON.stringify({ action, reason }) },
          csrfToken,
        );
        setItems((previous) => previous.map((row) => row.id === item.id ? {
          ...row,
          isVisible: response.isVisible,
          moderation: response.isVisible ? null : {
            moderator: null,
            moderatedAt: new Date().toISOString(),
            reason,
          },
        } : row));
        setNotice(action === "hide" ? "Kudos hidden from the public feed." : "Kudos restored to the public feed.");
      }
      setReasons((previous) => ({ ...previous, [item.id]: "" }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The moderation action could not be completed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="panel moderation-panel" aria-labelledby="moderation-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ADMIN TOOLS</span>
          <h2 id="moderation-heading">Kudos moderation</h2>
        </div>
        <span className="admin-pill">ADMIN</span>
      </div>
      <p className="moderation-intro">Hide inappropriate kudos from the feed or permanently delete them. Every action requires a reason and is audited.</p>
      {error && <p className="form-message error-message" role="alert">{error}</p>}
      {notice && <p className="form-message success-message" role="status">{notice}</p>}
      {loading && <div className="feed-loading"><span className="spinner spinner-dark" /> Loading moderation records…</div>}
      {!loading && !error && items.length === 0 && <div className="feed-state"><p>No kudos to moderate.</p></div>}
      {!loading && items.length > 0 && (
        <div className="moderation-list">
          {items.map((item) => (
            <article className="moderation-item" key={item.id}>
              <div className="moderation-item-head">
                <div>
                  <p className="moderation-byline"><strong>{item.sender.name}</strong> → <strong>{item.recipient.name}</strong></p>
                  <p className="moderation-message">{item.message}</p>
                </div>
                <span className={item.isVisible ? "visibility-pill visible-pill" : "visibility-pill hidden-pill"}>
                  {item.isVisible ? "Visible" : "Hidden"}
                </span>
              </div>
              {!item.isVisible && item.moderation && (
                <p className="moderation-last-action">Last reason: {item.moderation.reason}</p>
              )}
              <label className="moderation-reason-label" htmlFor={`reason-${item.id}`}>Reason for action</label>
              <textarea
                id={`reason-${item.id}`}
                rows={2}
                maxLength={500}
                value={reasons[item.id] ?? ""}
                onChange={(event) => setReasons((previous) => ({ ...previous, [item.id]: event.target.value }))}
                placeholder="Describe why this action is needed"
                disabled={busyId === item.id}
              />
              <div className="moderation-actions">
                {item.isVisible ? (
                  <button type="button" className="button button-secondary" onClick={() => void moderate(item, "hide")} disabled={busyId === item.id}>
                    {busyId === item.id ? "Working…" : "Hide from feed"}
                  </button>
                ) : (
                  <button type="button" className="button button-secondary" onClick={() => void moderate(item, "restore")} disabled={busyId === item.id}>
                    {busyId === item.id ? "Working…" : "Restore to feed"}
                  </button>
                )}
                <button type="button" className="button button-danger" onClick={() => void moderate(item, "delete")} disabled={busyId === item.id}>
                  Permanently delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!loading && cursor && (
        <div className="load-more-row">
          <button className="button button-secondary" type="button" onClick={() => void loadItems(cursor)}>Load more</button>
        </div>
      )}
    </section>
  );
}
