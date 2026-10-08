import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, apiRequest, createIdempotencyKey, type KudosItem, type Person } from "../api";

const MAX_MESSAGE_LENGTH = 500;
const countCodePoints = (value: string) => Array.from(value).length;

type KudosFormProps = {
  csrfToken: string;
  currentUserId: string;
  onCreated: (item: KudosItem) => void;
};

export function KudosForm({ csrfToken, currentUserId, onCreated }: KudosFormProps) {
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<Person | null>(null);
  const [results, setResults] = useState<Person[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);
  const count = countCodePoints(message);

  useEffect(() => {
    const normalized = query.trim();
    if (recipient || normalized.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      void apiRequest<{ items: Person[] }>(
        `/v1/users/search?q=${encodeURIComponent(normalized)}&limit=10`,
        { signal: controller.signal },
      ).then((response) => {
        setResults(response.items);
        setActiveIndex(-1);
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setSearchError(cause instanceof Error ? cause.message : "Could not search colleagues.");
          setResults([]);
        }
      }).finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, recipient]);

  function choosePerson(person: Person) {
    setRecipient(person);
    setQuery(person.name);
    setResults([]);
    setSearchError("");
  }

  function handleRecipientInput(value: string) {
    setQuery(value);
    setRecipient(null);
    setResults([]);
    setSearching(false);
    setError("");
    setSuccess("");
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      choosePerson(results[activeIndex]);
    } else if (event.key === "Escape") {
      setResults([]);
      setActiveIndex(-1);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const normalizedMessage = message.trim();
    if (!recipient) {
      setError("Choose a colleague from the search results.");
      return;
    }
    if (recipient.id === currentUserId) {
      setError("You cannot give kudos to yourself.");
      return;
    }
    if (!normalizedMessage) {
      setError("Write a short message before submitting.");
      return;
    }
    if (countCodePoints(normalizedMessage) > MAX_MESSAGE_LENGTH) {
      setError(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
      return;
    }

    const signature = `${recipient.id}\0${normalizedMessage}`;
    if (idempotency.current?.signature !== signature) {
      idempotency.current = { signature, key: createIdempotencyKey() };
    }
    setSubmitting(true);
    try {
      const response = await apiRequest<{ item: KudosItem }>("/v1/kudos", {
        method: "POST",
        headers: { "Idempotency-Key": idempotency.current.key },
        body: JSON.stringify({ recipientUserId: recipient.id, message: normalizedMessage }),
      }, csrfToken);
      onCreated(response.item);
      setSuccess(`Kudos sent to ${recipient.name}.`);
      setQuery("");
      setRecipient(null);
      setMessage("");
      idempotency.current = null;
    } catch (cause) {
      const requestError = cause instanceof ApiError ? cause : null;
      setError(requestError?.message ?? "Could not submit your kudos. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = MAX_MESSAGE_LENGTH - count;

  return (
    <section className="panel give-panel" aria-labelledby="give-kudos-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">MAKE SOMEONE'S DAY</span>
          <h2 id="give-kudos-heading">Give kudos</h2>
        </div>
        <span className="heading-spark" aria-hidden="true">✦</span>
      </div>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field recipient-field">
          <label htmlFor="recipient-search">Who deserves a shout-out?</label>
          <div className="recipient-input-wrap">
            <span className="field-icon" aria-hidden="true">⌕</span>
            <input
              id="recipient-search"
              type="search"
              autoComplete="off"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="recipient-options"
              aria-activedescendant={activeIndex >= 0 ? `recipient-option-${activeIndex}` : undefined}
              aria-autocomplete="list"
              aria-busy={searching}
              placeholder="Search colleagues by name"
              value={query}
              onChange={(event) => handleRecipientInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              disabled={submitting}
            />
            {recipient && <span className="selected-indicator" aria-label="Recipient selected">✓</span>}
          </div>
          {recipient && (
            <button className="selected-recipient" type="button" onClick={() => handleRecipientInput("")}>
              Selected: {recipient.name} <span aria-hidden="true">×</span>
            </button>
          )}
          <div className="search-feedback" aria-live="polite">
            {searching && <span>Searching colleagues…</span>}
            {searchError && <span className="inline-error">{searchError}</span>}
            {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && !recipient && (
              <span>No colleagues found.</span>
            )}
          </div>
          {results.length > 0 && (
            <ul id="recipient-options" className="recipient-options" role="listbox" aria-label="Colleague search results">
              {results.map((person, index) => (
                <li key={person.id}>
                  <button
                    id={`recipient-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    className={activeIndex === index ? "recipient-option active" : "recipient-option"}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choosePerson(person)}
                  >
                    <span className="avatar avatar-small">{person.name.slice(0, 1).toUpperCase()}</span>
                    <span>{person.name}</span>
                    <span className="option-check" aria-hidden="true">↵</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="field message-field">
          <div className="label-line">
            <label htmlFor="kudos-message">Your message</label>
            <span className={remaining < 0 ? "character-count over-limit" : "character-count"}>
              {count} / {MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <textarea
            id="kudos-message"
            rows={4}
            placeholder="Tell them what you appreciate…"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setError("");
              setSuccess("");
            }}
            disabled={submitting}
          />
          <span className="field-hint">A little recognition goes a long way.</span>
        </div>

        {error && <p className="form-message error-message" role="alert">{error}</p>}
        {success && <p className="form-message success-message" role="status">{success}</p>}
        <button className="button button-primary submit-button" type="submit" disabled={submitting}>
          {submitting ? <><span className="spinner" aria-hidden="true" /> Sending…</> : <>Send kudos <span aria-hidden="true">↗</span></>}
        </button>
      </form>
    </section>
  );
}
