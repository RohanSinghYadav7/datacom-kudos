import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest, type KudosItem, type SessionUser } from "./api";
import { AdminModeration } from "./components/AdminModeration";
import { KudosFeed } from "./components/KudosFeed";
import { KudosForm } from "./components/KudosForm";

type Credentials = { email: string; password: string };

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: SessionUser, csrfToken: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [credentials, setCredentials] = useState<Credentials>({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const body = mode === "login"
        ? credentials
        : { ...credentials, name };
      const response = await apiRequest<{ user: SessionUser; csrfToken: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onAuthenticated(response.user, response.csrfToken);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Sign in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-decoration auth-decoration-one" aria-hidden="true" />
      <div className="auth-decoration auth-decoration-two" aria-hidden="true" />
      <section className="auth-card">
        <div className="brand-mark brand-mark-large" aria-hidden="true">k.</div>
        <span className="eyebrow">A LITTLE RECOGNITION GOES A LONG WAY</span>
        <h1>{mode === "login" ? "Welcome back." : "Join the good stuff."}</h1>
        <p className="auth-copy">
          {mode === "login" ? "Sign in to celebrate the people who make work better." : "Create an account to give and receive kudos."}
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "register" && (
            <div className="field">
              <label htmlFor="auth-name">Your name</label>
              <input id="auth-name" autoComplete="name" required minLength={1} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Work email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={credentials.email}
              onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 12 : 1}
              maxLength={128}
              value={credentials.password}
              onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
            />
            {mode === "register" && <span className="field-hint">Use at least 12 characters.</span>}
          </div>
          {error && <p className="form-message error-message" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            {!busy && <span aria-hidden="true">↗</span>}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => {
            setMode((current) => current === "login" ? "register" : "login");
            setError("");
          }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <p className="auth-footnote">For your team, not the whole internet.</p>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [screen, setScreen] = useState<"feed" | "moderation">("feed");
  const [newItem, setNewItem] = useState<KudosItem | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<{ user: SessionUser; csrfToken: string }>("/auth/me")
      .then((session) => {
        if (active) {
          setUser(session.user);
          setCsrfToken(session.csrfToken);
        }
      })
      .catch((cause: unknown) => {
        if (active && cause instanceof ApiError && cause.status !== 401) {
          setSessionError(cause.message);
        }
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => { active = false; };
  }, []);

  function acceptSession(nextUser: SessionUser, nextCsrfToken: string) {
    setUser(nextUser);
    setCsrfToken(nextCsrfToken);
    setSessionError("");
  }

  async function signOut() {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" }, csrfToken);
      setUser(null);
      setCsrfToken("");
      setNewItem(null);
      setScreen("feed");
      setLogoutError("");
    } catch (cause) {
      setLogoutError(cause instanceof ApiError ? cause.message : "Sign out could not be completed.");
    }
  }

  if (checkingSession) {
    return <main className="initial-loading"><span className="spinner spinner-dark" /> Opening your kudos space…</main>;
  }
  if (!user) {
    return (
      <>
        {sessionError && <div className="session-banner" role="alert">{sessionError}</div>}
        <AuthScreen onAuthenticated={acceptSession} />
      </>
    );
  }

  return (
    <div className="app-background">
      <header className="topbar">
        <a href="#" className="brand" aria-label="Kudos home" onClick={(event) => { event.preventDefault(); setScreen("feed"); }}>
          <span className="brand-mark" aria-hidden="true">k.</span>
          <span className="brand-name">kudos<span>.</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={screen === "feed" ? "nav-link active" : "nav-link"} onClick={() => setScreen("feed")}>Dashboard</button>
          {user.role === "ADMIN" && (
            <button className={screen === "moderation" ? "nav-link active" : "nav-link"} onClick={() => setScreen("moderation")}>
              Moderation
            </button>
          )}
        </nav>
        <div className="account-area">
          <span className="account-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="account-name">{user.name}</span>
          {user.role === "ADMIN" && <span className="admin-pill">ADMIN</span>}
          <button className="sign-out-button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      <main className="page-content">
        {logoutError && <p className="form-message error-message" role="alert">{logoutError}</p>}
        {screen === "feed" ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow hero-eyebrow">KIND WORDS. REAL IMPACT.</span>
                <h1>Good work deserves<br />to be <em>noticed.</em></h1>
                <p>Celebrate the little and big things your teammates do every day.</p>
              </div>
              <div className="hero-art" aria-hidden="true">
                <span className="hero-sun" />
                <span className="hero-star hero-star-one">✳</span>
                <span className="hero-star hero-star-two">✦</span>
                <span className="hero-ring" />
                <span className="hero-card">
                  <span className="mini-avatars"><i>J</i><i>M</i></span>
                  <span className="mini-card-text"><b>Nice work, team!</b><small>the little things add up</small></span>
                  <span className="mini-heart">♥</span>
                </span>
              </div>
            </section>
            <div className="dashboard-grid">
              <KudosForm csrfToken={csrfToken} currentUserId={user.id} onCreated={setNewItem} />
              <KudosFeed newItem={newItem} />
            </div>
          </>
        ) : (
          <AdminModeration csrfToken={csrfToken} />
        )}
        <footer className="page-footer">
          <span>Make room for the good stuff.</span>
          <span>Made for teammates, by teammates <b aria-hidden="true">✦</b></span>
        </footer>
      </main>
    </div>
  );
}
