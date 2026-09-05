import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, CalendarDays, BookOpenCheck, Users, Stethoscope,
  MessagesSquare, Sparkles, FolderTree, Package, UserCog, ShoppingBag,
  Tags, TicketPercent, Truck, Boxes, Building2, Store, Star, BarChart3, ShieldCheck,
  Smartphone, MessageSquareText, CreditCard, BellRing, ToggleRight,
  ClipboardList, CalendarClock, MapPin, Search, Bell, ChevronDown,
  ScrollText, IdCard, Mic, Pill, Receipt, FlaskConical, LifeBuoy, Loader2, CheckCheck, ArrowRight, PackageSearch,
} from "lucide-react";
import type { ReactNode } from "react";
import { useStore, ROLE_LABEL, panelAccepts, wrongPanelMessage, type Role } from "./store";
import { replayTour } from "./tours";
import { useMyDoctor } from "./lib/useMe";
import { Menu } from "./ui";
import api from "./lib/api";
import { useApi, useDebounced, usePoll } from "./lib/useApi";
import { fmtAgo, initials } from "./lib/format";
import type { Admin } from "./lib/types";
import { ApiError } from "./lib/http";
import logo from "./assets/zennara-logo.png";

type NavItem = { to: string; label: string; icon: ReactNode; badge?: "bookings" | "chat" | "orders" | "lowstock" | "reviews" };
type NavGroup = { g: string; items: NavItem[] };
const ic = "h-[16px] w-[16px]";

const NAV: NavGroup[] = [
  { g: "Clinical", items: [
    { to: "/doctor/my-day", label: "My day", icon: <CalendarDays className={ic} /> },
    { to: "/doctor/consultation", label: "Consultation", icon: <Stethoscope className={ic} /> },
    { to: "/doctor/my-patients", label: "My patients", icon: <Users className={ic} /> },
  ]},
  { g: "Me", items: [
    { to: "/doctor/month", label: "My month", icon: <BarChart3 className={ic} /> },
    { to: "/doctor/schedule", label: "My schedule", icon: <CalendarClock className={ic} /> },
    { to: "/doctor/availability", label: "My centres", icon: <MapPin className={ic} /> },
    { to: "/doctor/stock", label: "Product availability", icon: <PackageSearch className={ic} /> },
    { to: "/doctor/profile", label: "My profile", icon: <IdCard className={ic} /> },
  ]},
];

export const HOME = "/doctor/my-day";

/* ================= live sidebar badges ================= */
function useNavBadges(role: Role, branchId: string) {
  return useApi(async () => {
    if (role !== "admin") return {} as Record<string, number>;

    const settled = await Promise.allSettled([
      api.bookings.list({ status: "Awaiting Confirmation", limit: 1 }),
      api.chat.stats(branchId || undefined),
      api.orders.stats(),
      api.analytics.inventory(),
      api.reviews.products({ isApproved: "false", limit: 1 }),
    ]);

    const val = <T,>(i: number): T | undefined =>
      settled[i].status === "fulfilled" ? ((settled[i] as PromiseFulfilledResult<T>).value) : undefined;

    const pending = val<{ total?: number; count?: number; data?: unknown[] }>(0);
    const chatStats = val<{ overall?: { totalUnread?: number; activeChats?: number }; byBranch?: { branchId: string; totalUnread: number; activeChats: number }[] }>(1);
    const orderStats = val<{ newOrders?: number; processingOrders?: number; confirmedOrders?: number }>(2);
    const inv = val<{ summary?: { lowStockCount?: number } }>(3);
    const rev = val<{ count?: number; pagination?: { total?: number } }>(4);

    const mine = branchId
      ? (chatStats?.byBranch ?? []).find((b) => String(b.branchId) === branchId)
      : { totalUnread: (chatStats?.byBranch ?? []).reduce((a, b) => a + (b.totalUnread || 0), 0), activeChats: (chatStats?.byBranch ?? []).reduce((a, b) => a + (b.activeChats || 0), 0) };

    return {
      bookings: pending?.total ?? pending?.count ?? pending?.data?.length ?? 0,
      // Unread first; fall back to open threads so the badge still signals work.
      chat: mine?.totalUnread || mine?.activeChats || 0,
      orders: (orderStats?.newOrders ?? 0) + (orderStats?.confirmedOrders ?? 0) + (orderStats?.processingOrders ?? 0),
      lowstock: inv?.summary?.lowStockCount ?? 0,
      reviews: rev?.pagination?.total ?? rev?.count ?? 0,
    } as Record<string, number>;
  }, [role, branchId]);
}

/* ================= global search ================= */
function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useStore();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const nav = useNavigate();

  useEffect(() => { if (searchOpen) setQ(""); }, [searchOpen]);

  // A dermatologist searches people, nothing else — services, products and
  // bookings are admin territory and their screens don't exist in this panel.
  const results = useApi(async () => {
    const term = debounced.trim();
    if (!searchOpen || term.length < 2) return { patients: [] as { _id: string; fullName: string; phone: string; location?: string }[] };
    const res = await api.patients.list({ search: term, limit: 8 }).catch(() => ({} as { data?: { users?: unknown[] } }));
    const users = (res as { data?: { users?: unknown[] } }).data?.users ?? [];
    return { patients: users.slice(0, 8) as { _id: string; fullName: string; phone: string; location?: string }[] };
  }, [debounced, searchOpen]);

  if (!searchOpen) return null;

  const go = (path: string, state?: object) => { setSearchOpen(false); nav(path, { state }); };
  const r = results.data ?? { patients: [] };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={() => setSearchOpen(false)} />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-(--radius-lg2) bg-surface shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-ink3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your patients…"
            className="flex-1 bg-transparent text-[14px] outline-none" />
          {results.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink3" />}
          <kbd className="rounded border border-border bg-ivory px-1.5 font-mono text-[10px] text-ink3">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-auto p-2">
          {q.trim().length < 2 && (
            <div className="px-3 py-6 text-center text-[12.5px] text-ink3">Type at least two characters to search patients by name or phone.</div>
          )}
          {q.trim().length >= 2 && !r.patients.length && !results.loading && (
            <div className="px-3 py-6 text-center text-[12.5px] text-ink3">Nothing matched “{q}”.</div>
          )}
          {r.patients.length > 0 && <div className="px-3 pt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Patients</div>}
          {r.patients.map((p) => (
            <button key={p._id} onClick={() => go("/doctor/patient", { id: p._id })}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-ivory">
              <b className="font-semibold">{p.fullName}</b> <span className="text-ink3">· {p.phone}{p.location ? ` · ${p.location}` : ""}</span>
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
    role, admin, adminRole, branch, branchId, branches, branchesLoading, setBranchById,
    toast, setSearchOpen, loggedIn, booting, signIn, logout,
  } = useStore();
  const loc = useLocation();
  const nav = useNavigate();
  const badges = useNavBadges(role, branchId);

  // A dermatologist's world is their assigned centres, not the whole clinic.
  // The header offers only those; a stored branch outside them is dropped so
  // no screen quietly filters to a centre they don't work at.
  const myDoctor = useMyDoctor();
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
      <div className="grid min-h-screen place-items-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt="Zennara" className="h-16 w-auto object-contain opacity-80" />
          <Loader2 className="h-5 w-5 animate-spin text-gold-dark" />
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginPage onSignedIn={(token, me, exp) => { signIn(token, me, exp); nav(HOME); }} />;
  }

  const who = {
    init: initials(admin?.name || admin?.email),
    name: admin?.name || admin?.email || "Signed in",
    role: adminRole ? ROLE_LABEL[adminRole] : "",
  };
  const badgeCounts = badges.data ?? {};

  return (
    <div className="flex min-h-screen items-start">
      <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col bg-side pb-2 pt-3 text-side-ink">
        <div data-tour="logo" className="shrink-0 flex justify-center border-b border-side-2 px-4 pb-2.5 pt-1">
          <img src={logo} alt="Zennara" className="h-16 w-auto object-contain" />
        </div>

        <div data-tour="nav" className="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-color:var(--color-gold-dark)_transparent] [scrollbar-width:thin]">
          {NAV.map((grp) => (
            <div key={grp.g}>
              <div className="px-4 pb-0.5 pt-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-side-mut">{grp.g}</div>
              {grp.items.map((it) => {
                const n = it.badge ? badgeCounts[it.badge] : undefined;
                return (
                  <NavLink key={it.to} to={it.to} data-tour={"nav-" + it.to.split("/").filter(Boolean).pop()}
                    className={({ isActive }) =>
                      `mx-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-[5px] text-[12.3px] font-medium transition-colors ${
                        isActive || loc.pathname === it.to
                          ? "bg-side-2 text-white shadow-[inset_2px_0_0_var(--color-gold)]"
                          : "hover:bg-side-2/50 hover:text-white"}`}>
                    <span className="flex items-center gap-2.5">{it.icon}{it.label}</span>
                    {!!n && n > 0 && (
                      <span className="rounded-full bg-gold px-1.5 font-mono text-[10px] font-bold text-primary">{n > 99 ? "99+" : n}</span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-side-2 px-4 pb-0.5 pt-2 text-[11px] leading-tight text-side-mut">
          <div className="mb-0.5 font-bold text-white">{who.name}</div>
          <div>{who.role}{branchLabel ? ` · ${branchLabel}` : ""}</div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-2.5">
          {myBranches.length <= 1 ? (
            /* One centre (or none): nothing to switch, so state it instead of
               offering a dead menu. */
            <div data-tour="branch" className="flex items-center gap-1.5 px-2 py-1 text-[13.5px] font-bold">
              <MapPin className="h-3.5 w-3.5 text-gold-dark" />
              {myBranches[0]?.name ?? (myDoctor.loading || branchesLoading ? "…" : "No centre assigned yet")}
            </div>
          ) : (
            <Menu
              button={
                <button data-tour="branch" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13.5px] font-bold hover:bg-ivory">
                  <MapPin className="h-3.5 w-3.5 text-gold-dark" />
                  {branchLabel} <ChevronDown className="h-3.5 w-3.5 text-ink3" />
                </button>
              }
              items={[
                { label: <span className={!branchId ? "font-bold text-primary" : ""}>All my centres</span>,
                  onClick: () => { setBranchById(""); toast("Showing all your centres"); } },
                ...myBranches.map((b) => ({
                  label: <span className={b._id === branchId ? "font-bold text-primary" : ""}>{b.name}</span>,
                  onClick: () => { setBranchById(b._id); toast(`Switched to ${b.name}`); },
                })),
              ]}
            />
          )}
          <button data-tour="search" onClick={() => setSearchOpen(true)}
            className="mx-auto flex w-full min-w-[160px] max-w-[440px] flex-1 items-center justify-between rounded-(--radius-btn) border border-border bg-ivory px-3 py-1.5 text-[12.5px] text-ink3 hover:border-gold-dark">
            <span className="flex items-center gap-2"><Search className="h-3.5 w-3.5" /> Search your patients…</span>
            <kbd className="rounded border border-border bg-surface px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <div className="flex items-center gap-3">
            <Menu align="right"
              button={
                <button className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-secondary text-[10.5px] font-bold text-white">
                  {admin?.photo ? <img src={admin.photo} alt="" className="h-full w-full object-cover" /> : who.init}
                </button>
              }
              items={[
                { label: <span><b>{who.name}</b><br /><span className="text-[11px] text-ink3">{who.role}{branchLabel ? ` · ${branchLabel}` : ""}</span></span> },
                { label: "My profile", onClick: () => nav("/doctor/profile") },
                { label: "View tutorial again", onClick: () => { replayTour(); toast("Starting the walkthrough"); } },
                { label: "Sign out", onClick: () => { logout(); toast("Signed out"); } },
              ]}
            />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden bg-bg p-5">{children}</main>
      </div>
      <SearchOverlay />
    </div>
  );
}

/* ================= login ================= */
function LoginPage({ onSignedIn }: { onSignedIn: (token: string, admin: Admin, expiresAt?: string) => void }) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
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
      if (!panelAccepts(res.admin.role)) { setError(wrongPanelMessage(res.admin.role)); setOtp(""); return; }
      onSignedIn(res.token, res.admin, res.expiresAt);
    } catch (err) { fail(err); setOtp(""); } finally { setBusy(false); }
  };

  // One quiet column on the clinic green: the white logo above a plain card.
  // No carousel, no notice bubbles, no footer copy — the field and the button.
  const field = "w-full rounded-xl border border-border bg-ivory px-4 py-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink3/60 focus:border-primary focus:bg-surface";
  const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[14px] font-bold text-white transition-colors hover:bg-primary-hover disabled:bg-dis-bg disabled:text-dis";

  return (
    <div className="flex min-h-screen items-center justify-center bg-side px-6 py-12">
      <div className="w-full max-w-[380px]">
        <img src={logo} alt="Zennara" className="mx-auto h-20 w-auto object-contain" />
        <div className="mt-8 rounded-3xl bg-surface p-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink3">Dermatologist panel</div>
          <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight text-ink">
            {step === "email" ? "Sign in" : "Enter your code"}
          </h1>
          <p className="mt-1 text-[13px] text-ink3">
            {step === "email" ? "We’ll email you a one-time code." : <>Sent to <span className="font-semibold text-ink2">{addr}</span></>}
          </p>

          <div className="mt-6 grid gap-3">
            {step === "email" ? (
              <>
                <input id="login-email" autoFocus value={email} type="email" autoComplete="email" aria-label="Email"
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && !busy && sendOtp()}
                  placeholder="you@zennara.in" className={field} />
                <button onClick={sendOtp} disabled={busy} className={primary}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continue
                </button>
              </>
            ) : (
              <>
                <input id="login-otp" autoFocus value={otp} inputMode="numeric" maxLength={6} autoComplete="one-time-code" aria-label="6-digit code"
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && !busy && verify()}
                  placeholder="······"
                  className={`${field} text-center font-mono text-[24px] font-bold tracking-[0.45em]`} />
                <button onClick={verify} disabled={busy || otp.length !== 6} className={primary}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
                </button>
                <div className="flex items-center justify-between pt-1 text-[12.5px]">
                  <button className="font-semibold text-ink3 transition-colors hover:text-ink"
                    onClick={() => { setStep("email"); setOtp(""); setError(null); }}>
                    Use another email
                  </button>
                  <button className="font-semibold text-primary disabled:text-dis" disabled={busy || cooldown > 0} onClick={resend}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}
            {error && <p role="alert" className="text-[12.5px] font-semibold text-err">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
