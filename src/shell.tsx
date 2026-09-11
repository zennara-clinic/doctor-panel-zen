import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  BarChart3, CalendarClock, Camera, ChevronDown, ChevronRight, Loader2, LogOut, MapPin, PackageSearch,
  Pill, PlayCircle, Search, Stethoscope, Sun, UserRound, Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useStore, ROLE_LABEL, panelAccepts, wrongPanelMessage } from "./store";
import { replayTour } from "./tours";
import { useMyDoctor } from "./lib/useMe";
import { Menu } from "./ui";
import api from "./lib/api";
import { useApi, useBookingUpdates, useDebounced, usePoll } from "./lib/useApi";
import { initials, isoDay } from "./lib/format";
import type { Admin } from "./lib/types";
import { API_BASE, ApiError } from "./lib/http";
import logo from "./assets/zennara-logo.png";

type NavItem = { to: string; label: string; icon: ReactNode; tour: string; badge?: "waiting" };

/*
 * Five destinations, nothing nested. A dermatologist opens this between
 * guests with one hand; every extra level is a guest kept waiting.
 */
const NAV: NavItem[] = [
  { to: "/dermatologist/my-day", label: "Today", icon: <Sun />, tour: "nav-my-day", badge: "waiting" },
  { to: "/dermatologist/my-patients", label: "Guests", icon: <Users />, tour: "nav-my-patients" },
  { to: "/dermatologist/schedule", label: "Schedule", icon: <CalendarClock />, tour: "nav-schedule" },
  { to: "/dermatologist/stock", label: "Products", icon: <PackageSearch />, tour: "nav-stock" },
  { to: "/dermatologist/month", label: "Insights", icon: <BarChart3 />, tour: "nav-month" },
];

export const HOME = "/dermatologist/my-day";

/**
 * Three shapes, chosen by width, and one by task:
 *
 *   > 1100px   full sidebar — a tablet in landscape
 *   ≤ 1100px   icon rail — a tablet in portrait
 *   ≤ 720px    bottom tab bar — a phone
 *
 * The consultation workspace always takes the rail, whatever the width, so the
 * guest summary and the note can sit side by side on a landscape tablet.
 */
export type Layout = "full" | "rail" | "phone";
function useLayout(inConsult: boolean): Layout {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (width <= 720) return "phone";
  if (width <= 1100 || inConsult) return "rail";
  return "full";
}

/** Guests checked in and waiting for this dermatologist right now — the one number worth a badge. */
function useWaitingCount(doctorId: string | undefined) {
  const q = useApi(async () => {
    if (!doctorId) return 0;
    const res = await api.bookings.list({ specialistId: doctorId, date: isoDay(), status: "Checked In" });
    return (res.data ?? []).length;
  }, [doctorId]);
  useBookingUpdates(q.reload, !!doctorId);
  usePoll(q.reload, 60000, !!doctorId);
  return q.data ?? 0;
}

/* ================= patient search ================= */
function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useStore();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const nav = useNavigate();

  useEffect(() => { if (searchOpen) setQ(""); }, [searchOpen]);

  const results = useApi(async () => {
    const term = debounced.trim();
    if (!searchOpen || term.length < 2) return [] as { _id: string; fullName: string; phone: string; patientId?: string; location?: string }[];
    const res = await api.patients.list({ search: term, limit: 8 }).catch(() => ({} as { data?: { users?: unknown[] } }));
    const users = (res as { data?: { users?: unknown[] } }).data?.users ?? [];
    return users.slice(0, 8) as { _id: string; fullName: string; phone: string; patientId?: string; location?: string }[];
  }, [debounced, searchOpen]);

  if (!searchOpen) return null;
  const rows = results.data ?? [];
  const go = (id: string) => { setSearchOpen(false); nav(`/dermatologist/patient?id=${id}`, { state: { id } }); };

  return (
    <div className="dz-scrim dz-scrim--top" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
      <div className="dz-spotlight" role="dialog" aria-label="Search guests">
        <div className="dz-spotlight__bar">
          <Search />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guests booked with you — name or ID" />
          {results.loading && q.trim().length >= 2 && <Loader2 className="h-5 w-5 animate-spin text-ink3" />}
          <button type="button" className="dz-btn dz-btn--ghost dz-btn--sm" onClick={() => setSearchOpen(false)}>Close</button>
        </div>
        <div className="dz-spotlight__list">
          {q.trim().length < 2 && <div className="px-3 py-8 text-center text-[14px] text-ink3">Type at least two letters. Only guests booked with you are searched.</div>}
          {q.trim().length >= 2 && !rows.length && !results.loading && (
            <div className="px-3 py-8 text-center text-[14px] text-ink3">No guest booked with you matches “{q}”.</div>
          )}
          {rows.map((p) => (
            <button key={p._id} type="button" className="dz-prow" style={{ gridTemplateColumns: "44px minmax(0,1fr) 20px", minHeight: 64 }} onClick={() => go(p._id)}>
              <span className="dz-avatar dz-avatar--sage">{initials(p.fullName)}</span>
              <span className="min-w-0">
                <span className="dz-prow__name">{p.fullName}</span>
                <span className="dz-prow__sub">{[p.patientId, p.location].filter(Boolean).join(" · ")}</span>
              </span>
              <ChevronRight />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= shell ================= */
export function Shell({ children }: { children: ReactNode }) {
  const {
    admin, adminRole, branch, branchId, branches, branchesLoading, setBranchById,
    toast, setSearchOpen, loggedIn, booting, signIn, logout,
  } = useStore();
  const loc = useLocation();
  const nav = useNavigate();
  const layout = useLayout(loc.pathname.startsWith("/dermatologist/consultation"));

  // A dermatologist's world is their assigned centres, not the whole clinic.
  const myDoctor = useMyDoctor();
  const waiting = useWaitingCount(loggedIn ? myDoctor.data?.doctorId : undefined);
  const myCentreNames = myDoctor.data?.availableCentres ?? [];
  const myBranches = branches.filter((b) => myCentreNames.includes(b.name));
  const branchLabel = branchId
    ? branch
    : myBranches.length > 1 ? "All my centres" : myBranches[0]?.name ?? "";
  useEffect(() => {
    if (!myDoctor.data || branchesLoading) return;
    const allowed = branches.filter((b) => (myDoctor.data?.availableCentres ?? []).includes(b.name));
    if (allowed.length === 1) {
      if (branchId !== allowed[0]._id) setBranchById(allowed[0]._id);
    } else if (branchId && !allowed.some((b) => b._id === branchId)) {
      setBranchById("");
    }
  }, [myDoctor.data, branches, branchesLoading, branchId, setBranchById]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setSearchOpen]);

  if (booting) {
    return (
      <div className="dz-boot">
        <div className="grid justify-items-center gap-4">
          <img src={logo} alt="Zennara" />
          <Loader2 className="h-6 w-6 animate-spin text-secondary" />
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginPage onSignedIn={(token, me, exp) => { signIn(token, me, exp); nav(HOME); }} />;
  }

  if (admin?.mustChangePassword) {
    return <ChoosePasswordPage onDone={(token, me, exp) => signIn(token, me, exp)} />;
  }

  const name = myDoctor.data?.name || admin?.name || admin?.email || "Signed in";
  const role = adminRole ? ROLE_LABEL[adminRole] : "Dermatologist";
  const photo = admin?.photo || myDoctor.data?.photo || null;
  const avatar = (cls = "") => (
    <span className={`dz-avatar ${cls}`}>{photo ? <img src={photo} alt="" /> : initials(name)}</span>
  );

  const centre = myBranches.length <= 1 ? (
    <span data-tour="branch" className="dz-centre" title="Your centre">
      <MapPin /><span>{myBranches[0]?.name ?? (myDoctor.loading || branchesLoading ? "…" : "No centre assigned")}</span>
    </span>
  ) : (
    <Menu
      button={<button type="button" data-tour="branch" className="dz-centre"><MapPin /><span>{branchLabel}</span><ChevronDown /></button>}
      items={[
        { label: "All my centres", icon: <MapPin />, onClick: () => { setBranchById(""); toast("Showing all your centres"); } },
        ...myBranches.map((b) => ({
          label: <span className={b._id === branchId ? "font-extrabold text-primary" : ""}>{b.name}</span>,
          icon: <MapPin />,
          onClick: () => { setBranchById(b._id); toast(`Switched to ${b.name}`); },
        })),
      ]}
    />
  );

  return (
    <div className={`dz-app ${layout === "full" ? "" : `dz-app--${layout}`}`}>
      <aside className="dz-side">
        <div data-tour="logo" className="dz-brand">
          <img src={logo} alt="Zennara" />
          <span>Dermatologist</span>
        </div>

        <nav data-tour="nav" className="dz-nav" aria-label="Main">
          {NAV.map((it) => {
            const n = it.badge === "waiting" ? waiting : 0;
            return (
              <NavLink key={it.to} to={it.to} title={it.label} data-tour={it.tour}
                className={({ isActive }) => (isActive ? "active" : "")}>
                {it.icon}
                <span>{it.label}</span>
                {n > 0 && <span className="dz-nav__badge" aria-label={`${n} waiting`}>{n > 9 ? "9+" : n}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="dz-side__spacer" />
        <button type="button" data-tour="nav-profile" className="dz-me" onClick={() => nav("/dermatologist/profile")} title="My profile">
          {avatar()}
          <span className="dz-me__txt">
            <b>{name}</b>
            <span>{role}{branchLabel ? ` · ${branchLabel}` : ""}</span>
          </span>
        </button>
      </aside>

      <div className="dz-main">
        <header className="dz-top">
          <img src={logo} alt="Zennara" className="dz-top__logo" />
          {centre}
          <button type="button" data-tour="search" className="dz-search" onClick={() => setSearchOpen(true)}>
            <Search /> Search your guests
            <kbd>⌘K</kbd>
          </button>
          <div className="dz-top__right">
            {layout !== "full" && (
              <button type="button" className="dz-iconbtn" onClick={() => setSearchOpen(true)} aria-label="Search your guests"><Search /></button>
            )}
            <Menu align="right"
              button={<button type="button" className="dz-avatar" aria-label="Account" style={{ padding: 0, border: 0, cursor: "pointer" }}>{photo ? <img src={photo} alt="" /> : initials(name)}</button>}
              items={[
                { label: <><b>{name}</b>{role}{branchLabel ? ` · ${branchLabel}` : ""}</> },
                { label: "My profile", icon: <UserRound />, onClick: () => nav("/dermatologist/profile") },
                { label: "Show the walkthrough", icon: <PlayCircle />, onClick: () => { replayTour(); toast("Starting the walkthrough"); } },
                { divider: true, label: "" },
                { label: "Sign out", icon: <LogOut />, danger: true, onClick: () => { logout(); toast("Signed out"); } },
              ]}
            />
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <SearchOverlay />
    </div>
  );
}

/* ================= login ================= */
/**
 * A sign-in that belongs to another panel is refused here — and the session the
 * server has just opened for it is ended too, rather than left live and unused.
 */
function endRefusedSession(token: string) {
  return fetch(`${API_BASE}/admin/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
}

function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <div className="dz-login">
      <div className="dz-login__brand">
        <img src={logo} alt="Zennara" />
        <div>
          <h1>Your day, your guests, one screen.</h1>
          <p>Built for the tablet in the consult room — see who is waiting, write the note, prescribe and photograph without leaving the guest.</p>
          <ul className="dz-login__points">
            <li><span><Stethoscope /></span>Today’s guests, in the order they arrive</li>
            <li><span><Pill /></span>Prescriptions in a few taps</li>
            <li><span><Camera /></span>Before and after photos, side by side</li>
          </ul>
        </div>
        <div className="dz-login__foot">Dermatologist panel</div>
      </div>
      <div className="dz-login__form">
        <div className="dz-login__box">{children}</div>
      </div>
    </div>
  );
}

function LoginPage({ onSignedIn }: { onSignedIn: (token: string, admin: Admin, expiresAt?: string) => void }) {
  const [step, setStep] = useState<"email" | "password" | "otp">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong");
  const addr = email.trim().toLowerCase();

  const sendOtp = async () => {
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setError("Enter a valid email address"); return; }
    setBusy(true); setError(null);
    try { await api.auth.requestOtp(addr); setStep("otp"); setCooldown(30); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  // Accounts with a password get the password box; everyone else goes
  // straight to the emailed code (both stay available either way).
  const continueFromEmail = async () => {
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setError("Enter a valid email address"); return; }
    setBusy(true); setError(null);
    const info = await api.auth.checkEmail(addr).catch(() => null);
    if (info && info.hasPassword) { setStep("password"); setBusy(false); return; }
    setBusy(false);
    await sendOtp();
  };

  const signInWithPassword = async () => {
    if (!password) { setError("Enter your password"); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.auth.loginPassword(addr, password);
      if (!panelAccepts(res.admin.role)) { void endRefusedSession(res.token); setError(wrongPanelMessage(res.admin.role)); setPassword(""); return; }
      onSignedIn(res.token, res.admin, res.expiresAt);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(null);
    try { await api.auth.resendOtp(addr); setCooldown(30); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const verify = async () => {
    if (otp.length !== 6) { setError("The code is 6 digits"); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.auth.verifyOtp(addr, otp);
      if (!panelAccepts(res.admin.role)) { void endRefusedSession(res.token); setError(wrongPanelMessage(res.admin.role)); setOtp(""); return; }
      onSignedIn(res.token, res.admin, res.expiresAt);
    } catch (err) { fail(err); setOtp(""); } finally { setBusy(false); }
  };

  return (
    <LoginFrame>
      <div className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-ink3">Dermatologist panel</div>
      <h2>{step === "email" ? "Sign in" : step === "password" ? "Your password" : "Enter your code"}</h2>
      <p className="mb-6 text-[14.5px] text-ink2">
        {step === "email" ? "Use your work email. You’ll get a password box or a one-time code." : <>Signing in as <b className="text-ink">{addr}</b></>}
      </p>

      <div className="grid gap-3">
        {step === "email" ? (
          <>
            <input autoFocus value={email} type="email" autoComplete="email" aria-label="Email"
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && !busy && continueFromEmail()}
              placeholder="you@zennara.in" className="dz-input" style={{ minHeight: 54 }} />
            <button type="button" onClick={continueFromEmail} disabled={busy} className="dz-btn dz-btn--primary dz-btn--lg dz-btn--block">
              {busy && <Loader2 className="animate-spin" />} Continue
            </button>
          </>
        ) : step === "password" ? (
          <>
            <input autoFocus value={password} type="password" autoComplete="current-password" aria-label="Password"
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && !busy && signInWithPassword()}
              placeholder="Password" className="dz-input" style={{ minHeight: 54 }} />
            <button type="button" onClick={signInWithPassword} disabled={busy || !password} className="dz-btn dz-btn--primary dz-btn--lg dz-btn--block">
              {busy && <Loader2 className="animate-spin" />} Sign in
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" className="dz-link" style={{ color: "var(--color-ink3)" }} onClick={() => { setStep("email"); setPassword(""); setError(null); }}>Use another email</button>
              <button type="button" className="dz-link" disabled={busy} onClick={sendOtp}>Email me a code instead</button>
            </div>
          </>
        ) : (
          <>
            <input autoFocus value={otp} inputMode="numeric" maxLength={6} autoComplete="one-time-code" aria-label="6-digit code"
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && !busy && verify()}
              placeholder="••••••" className="dz-input dz-otp" />
            <button type="button" onClick={verify} disabled={busy || otp.length !== 6} className="dz-btn dz-btn--primary dz-btn--lg dz-btn--block">
              {busy && <Loader2 className="animate-spin" />} Sign in
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" className="dz-link" style={{ color: "var(--color-ink3)" }} onClick={() => { setStep("email"); setOtp(""); setError(null); }}>Use another email</button>
              <button type="button" className="dz-link" disabled={busy || cooldown > 0} onClick={resend}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert" className="dz-error">{error}</p>}
      </div>
    </LoginFrame>
  );
}

/* ================= choose my own password (after a temporary one) ================= */
function ChoosePasswordPage({ onDone }: { onDone: (token: string, admin: Admin, expiresAt?: string) => void }) {
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (next.length < 8) { setError("Use at least 8 characters."); return; }
    if (next !== again) { setError("The two passwords do not match."); return; }
    setBusy(true); setError(null);
    try { const res = await api.auth.changePassword({ newPassword: next }); onDone(res.token, res.admin, res.expiresAt); }
    catch (err) { setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong"); }
    finally { setBusy(false); }
  };
  return (
    <LoginFrame>
      <div className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-ink3">Dermatologist panel</div>
      <h2>Choose your password</h2>
      <p className="mb-6 text-[14.5px] text-ink2">You signed in with a temporary password. Pick your own to continue.</p>
      <div className="grid gap-3">
        <input autoFocus value={next} type="password" autoComplete="new-password" aria-label="New password" placeholder="New password (8+ characters)"
          onChange={(e) => { setNext(e.target.value); setError(null); }} className="dz-input" style={{ minHeight: 54 }} />
        <input value={again} type="password" autoComplete="new-password" aria-label="New password again" placeholder="New password again"
          onChange={(e) => { setAgain(e.target.value); setError(null); }} onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
          className="dz-input" style={{ minHeight: 54 }} />
        <button type="button" onClick={submit} disabled={busy || !next || !again} className="dz-btn dz-btn--primary dz-btn--lg dz-btn--block">
          {busy && <Loader2 className="animate-spin" />} Save password
        </button>
        {error && <p role="alert" className="dz-error">{error}</p>}
      </div>
    </LoginFrame>
  );
}
