import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest, type KudosItem } from "../api";

type KudosFeedProps = {
  newItem?: KudosItem | null;
};

function relativeTime(value: string): string {
  const date = new Date(value);
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.floor(hours / 24), "day");
}

export function KudosFeed({ newItem }: KudosFeedProps) {
  const [items, setItems] = useState<KudosItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const latestCreated = useRef<KudosItem | null>(null);

  const loadPage = useCallback(async (nextCursor?: string | null) => {
    setError("");
    if (nextCursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const search = new URLSearchParams({ limit: "20" });
      if (nextCursor) search.set("cursor", nextCursor);
      const response = await apiRequest<{ items: KudosItem[]; nextCursor: string | null }>(`/v1/kudos?${search}`);
      setItems((previous) => {
        if (!nextCursor) {
          const created = latestCreated.current;
          return created
            ? [created, ...response.items.filter((item) => item.id !== created.id)]
            : response.items;
        }
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...response.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(response.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The feed could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!newItem) return;
    latestCreated.current = newItem;
    setItems((previous) => [newItem, ...previous.filter((item) => item.id !== newItem.id)]);
  }, [newItem]);

  return (
    <section className="panel feed-panel" aria-labelledby="feed-heading">
      <div className="panel-heading feed-heading">
        <div>
          <span className="eyebrow">GOOD THINGS HAPPEN HERE</span>
          <h2 id="feed-heading">Kudos around you <span className="live-dot" aria-label="Recent updates" /></h2>
        </div>
        <span className="feed-count">{items.length > 0 ? `${items.length}${cursor ? "+" : ""} notes` : "The good stuff"}</span>
      </div>

      {loading && (
        <div className="feed-loading" aria-label="Loading kudos">
          <span className="spinner spinner-dark" /> Finding the good stuff…
        </div>
      )}
      {error && !loading && (
        <div className="feed-state" role="alert">
          <p>{error}</p>
          <button className="button button-secondary" type="button" onClick={() => void loadPage()}>Try again</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="feed-state empty-state">
          <span className="empty-illustration" aria-hidden="true">✦</span>
          <h3>It starts with you</h3>
          <p>No kudos yet. Send the first one and make someone's day.</p>
        </div>
      )}
      {!loading && items.length > 0 && (
        <>
          <div className="feed-list" aria-live="polite">
            {items.map((item) => (
              <article className="kudos-item" key={item.id}>
                <div className="item-avatars" aria-hidden="true">
                  <span className="avatar avatar-sender">{item.sender.name.slice(0, 1).toUpperCase()}</span>
                  <span className="avatar avatar-recipient">{item.recipient.name.slice(0, 1).toUpperCase()}</span>
                </div>
                <div className="item-content">
                  <div className="item-meta">
                    <p><strong>{item.sender.name}</strong><span className="gave-word"> gave kudos to </span><strong>{item.recipient.name}</strong></p>
                    <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{relativeTime(item.createdAt)}</time>
                  </div>
                  <p className="item-message">{item.message}</p>
                </div>
              </article>
            ))}
          </div>
          {cursor && (
            <div className="load-more-row">
              <button className="button button-secondary" type="button" onClick={() => void loadPage(cursor)} disabled={loadingMore}>
                {loadingMore ? <><span className="spinner spinner-dark" /> Loading…</> : "Load older kudos"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
