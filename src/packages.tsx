import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Package as PackageIcon, RefreshCw } from "lucide-react";
import api from "./lib/api";
import type { ZenotiPackage, ZenotiUserData } from "./lib/api";
import type { Id, PackageAssignment } from "./lib/types";
import { ApiError } from "./lib/http";
import { useApi } from "./lib/useApi";
import { Panel, Prog } from "./ui";
import { fmtDate, fmtWhen, idOf } from "./lib/format";
import { fmtZDate } from "./pages/zenoti";

/**
 * One guest's packages, one card each, with the balance counted once.
 *
 * A package bought at the clinic reaches us twice: as a PackageAssignment the
 * mirror writes, and in the raw Zenoti copy. The record page used to read the
 * assignment's `usageTracking` — never filled for mirrored packages, so it said
 * "0 of 0 used" — and then printed the mirror's one-row-per-session list, so a
 * 5-service × 5-session package became 25 near-identical lines under a 0/0 bar
 * (Kiran Kolli, prod 2026-09-10: really 16 of 25 used, 9 left).
 *
 * Where the numbers come from, best first:
 *   1. Zenoti's own per-service total / used / balance for that purchase —
 *      refreshed live from Zenoti when the record opens (see useGuestPackages);
 *   2. for a package sold at the desk, its service list and the sessions
 *      completed against it;
 *   3. the stored counter, when that is all there is.
 * When none of those says what the package holds (Zenoti publishes no session
 * lines for some packages), the card says so instead of drawing 0 of 0.
 */

export type PackageState = "Active" | "Used up" | "Expired" | "Cancelled" | "Frozen" | "Not started" | "Inactive";
export type PackageServiceLine = { name: string; total: number; used: number; left: number };
export type PackageView = {
  key: string;
  name: string;
  state: PackageState;
  active: boolean;
  /** null = nobody recorded what the package holds. */
  total: number | null;
  used: number;
  left: number;
  services: PackageServiceLine[];
  validity: string | null;
  bought: string | null;
  centre: string | null;
  /** Sessions already booked into the diary against this package. */
  booked: { key: string; name: string; when: string | null }[];
  sortAt: number;
};

const n0 = (v: unknown) => Math.max(0, Number(v) || 0);
const lc = (v?: string | null) => String(v ?? "").trim().toLowerCase();
const time = (v?: string | null) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; };
const isPast = (v?: string | null) => { const t = time(v); return t !== null && t < Date.now(); };

/** Same service listed twice on one purchase counts as one line. */
function fold(lines: PackageServiceLine[]): PackageServiceLine[] {
  const by = new Map<string, PackageServiceLine>();
  for (const l of lines) {
    const k = lc(l.name);
    const prev = by.get(k);
    by.set(k, prev ? { name: prev.name, total: prev.total + l.total, used: prev.used + l.used, left: prev.left + l.left } : { ...l });
  }
  return [...by.values()];
}

function zenotiLines(k: ZenotiPackage): PackageServiceLine[] {
  return fold((k.services ?? []).map((s) => {
    const raw = s as { total?: number | null; used?: number | null; balance?: number | null };
    const total = n0(raw.total);
    const left = raw.balance != null ? Math.min(total, n0(raw.balance)) : Math.max(0, total - n0(raw.used));
    const used = raw.used != null ? Math.min(total, n0(raw.used)) : total - left;
    return { name: s.name ?? "Service", total, used, left };
  }).filter((l) => l.total > 0));
}

function assignmentLines(a: PackageAssignment): PackageServiceLine[] {
  const sessions = (a.sessions ?? []).filter((s) => s.status !== "Cancelled");
  const defs = (a.packageDetails?.services ?? []) as { serviceId?: string | null; serviceName?: string | null; sessions?: number | null }[];
  if (defs.length) {
    return fold(defs.map((d) => {
      const mine = sessions.filter((s) => (d.serviceId && s.serviceId ? String(s.serviceId) === String(d.serviceId) : lc(s.serviceName) === lc(d.serviceName)));
      const total = n0(d.sessions) || mine.length || 1;
      const used = Math.min(total, mine.filter((s) => s.status === "Completed").length);
      return { name: d.serviceName || "Service", total, used, left: total - used };
    }));
  }
  return fold(sessions.map((s) => ({ name: s.serviceName || "Service", total: 1, used: s.status === "Completed" ? 1 : 0, left: s.status === "Completed" ? 0 : 1 })));
}

function stateOf(o: { cancelled: boolean; zStatus: unknown; neverExpires: boolean; until: string | null; total: number | null; left: number; closed: boolean; expired: boolean }): PackageState {
  if (o.cancelled) return "Cancelled";
  const zs = String(o.zStatus ?? "").toLowerCase();
  if (zs === "3") return "Frozen";
  if (zs === "7") return "Not started";
  if (!o.neverExpires && isPast(o.until)) return "Expired";
  if (o.total !== null ? o.left === 0 : o.closed) return "Used up";
  if (o.expired) return "Expired";
  if (zs && zs !== "1" && zs !== "active") return "Inactive";
  return "Active";
}

export function buildPackageViews(assignments: PackageAssignment[], zPkgs: ZenotiPackage[]): PackageView[] {
  const zById = new Map(zPkgs.filter((k) => k.id).map((k) => [String(k.id), k] as const));
  const claimed = new Set<string>();

  const make = (o: {
    key: string; name: string; lines: PackageServiceLine[]; counter?: { total: number; used: number } | null;
    cancelled?: boolean; closed?: boolean; expired?: boolean; zStatus?: unknown;
    neverExpires: boolean; until: string | null; untilLabel: string | null;
    bought: string | null; boughtLabel: string | null; centre: string | null; booked?: PackageView["booked"];
  }): PackageView => {
    const total = o.lines.length ? o.lines.reduce((n, l) => n + l.total, 0) : o.counter ? o.counter.total : null;
    const used = o.lines.length ? o.lines.reduce((n, l) => n + l.used, 0) : Math.min(total ?? 0, o.counter?.used ?? 0);
    const left = o.lines.length ? o.lines.reduce((n, l) => n + l.left, 0) : Math.max(0, (total ?? 0) - used);
    const state = stateOf({ cancelled: !!o.cancelled, zStatus: o.zStatus, neverExpires: o.neverExpires, until: o.until, total, left, closed: !!o.closed, expired: !!o.expired });
    const validity = o.neverExpires ? "Never expires"
      : o.untilLabel ? `${state === "Expired" ? "Expired" : "Valid until"} ${o.untilLabel}` : null;
    return {
      key: o.key, name: o.name, state, active: state === "Active",
      total, used, left, services: o.lines, validity,
      bought: o.boughtLabel, centre: o.centre, booked: o.booked ?? [],
      sortAt: time(o.bought) ?? 0,
    };
  };

  const views = assignments.map((a) => {
    const k = a.zenotiUserPackageId ? zById.get(String(a.zenotiUserPackageId)) : undefined;
    if (k?.id) claimed.add(String(k.id));
    const zl = k ? zenotiLines(k) : [];
    const lines = zl.length ? zl : assignmentLines(a);
    const counter = n0(a.usageTracking?.totalSessions) ? { total: n0(a.usageTracking?.totalSessions), used: n0(a.usageTracking?.usedSessions) } : null;
    const bought = k?.purchaseDate || a.payment?.receivedDate || a.validFrom || a.createdAt || null;
    const until = k ? (k.neverExpires ? null : k.endDate) : a.validUntil ?? null;
    return make({
      key: `pa:${a._id}`,
      name: a.packageDetails?.packageName || k?.name || "Package",
      lines, counter,
      cancelled: a.status === "Cancelled", closed: a.status === "Completed", expired: a.status === "Expired",
      zStatus: k?.status,
      neverExpires: !!k?.neverExpires,
      until, untilLabel: until ? (k ? fmtZDate(until) : fmtDate(until)) : null,
      bought, boughtLabel: bought ? (k?.purchaseDate ? fmtZDate(k.purchaseDate) : fmtDate(bought)) : null,
      centre: k?.centerName || a.preferredLocation || null,
      booked: (a.sessions ?? [])
        .filter((s) => s.bookingId && s.status !== "Completed" && s.status !== "Cancelled")
        .map((s, i) => ({ key: String(s._id ?? i), name: s.serviceName || "Session", when: s.scheduledDate ? fmtDate(s.scheduledDate) : null })),
    });
  });

  for (const k of zPkgs) {
    if (k.id && claimed.has(String(k.id))) continue;
    const until = k.neverExpires ? null : k.endDate;
    const bought = k.purchaseDate || k.startDate || null;
    views.push(make({
      key: `zp:${k.id ?? k.name}`,
      name: k.name ?? "Package",
      lines: zenotiLines(k),
      zStatus: k.status,
      neverExpires: !!k.neverExpires,
      until, untilLabel: until ? fmtZDate(until) : null,
      bought, boughtLabel: bought ? fmtZDate(bought) : null,
      centre: k.centerName ?? null,
    }));
  }

  return views.sort((a, b) => Number(b.active) - Number(a.active) || b.sortAt - a.sortAt);
}

/* ------------------------------------------------------------------ data */

const FRESH_MS = 2 * 60 * 1000;

/**
 * Packages for one guest, kept current: the stored copy renders at once, then —
 * when Zenoti was last read more than two minutes ago — a live pull runs (which
 * also re-mirrors the packages) and the page re-reads. `watch` keeps pulling
 * every few minutes while the Packages tab is open and the tablet is awake.
 */
export function useGuestPackages(userId: Id | "" | null | undefined, { watch = false, onLive }: { watch?: boolean; onLive?: () => void } = {}) {
  const q = useApi(async () => {
    if (!userId) return null;
    const [assignments, clinic] = await Promise.allSettled([
      api.packageAssignments.list({ userId, limit: 100 }).then((r) => (r.data ?? []).filter((a) => idOf(a.userId) === userId)),
      // A guest who never came through Zenoti has no copy; that is not a failure.
      api.zenoti.user(userId).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
    ]);
    if (assignments.status === "rejected" && clinic.status === "rejected") throw assignments.reason;
    return {
      assignments: assignments.status === "fulfilled" ? assignments.value : [],
      clinic: clinic.status === "fulfilled" ? clinic.value : (null as ZenotiUserData | null),
      partial: assignments.status === "rejected" || clinic.status === "rejected",
    };
  }, [userId]);

  const reload = useRef(q.reload);
  reload.current = q.reload;
  const live = useRef(onLive);
  live.current = onLive;

  const [pulling, setPulling] = useState(false);
  const [pullFailed, setPullFailed] = useState(false);
  const pull = useCallback(async () => {
    if (!userId) return;
    setPulling(true);
    setPullFailed(false);
    try {
      await api.zenoti.user(userId, true);
      reload.current();
      live.current?.();
    } catch {
      setPullFailed(true);
    } finally {
      setPulling(false);
    }
  }, [userId]);

  const linked = !!q.data?.clinic?.linked;
  const syncedAt = q.data?.clinic?.details?.syncedAt ?? null;

  const pulledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !q.data || pulledFor.current === userId) return;
    pulledFor.current = userId;
    if (!linked) return;
    const at = time(syncedAt) ?? 0;
    if (Date.now() - at > FRESH_MS) void pull();
  }, [userId, q.data, linked, syncedAt, pull]);

  useEffect(() => {
    if (!watch || !linked) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 3 * FRESH_MS / 2);
    return () => window.clearInterval(t);
  }, [watch, linked, pull]);

  const d = q.data;
  const views = useMemo(() => (d ? buildPackageViews(d.assignments, d.clinic?.details?.packages ?? []) : null), [d]);
  return {
    q, views, linked, syncedAt, pulling, pullFailed, pull,
    memberships: d?.clinic?.details?.memberships ?? [],
    partial: !!d?.partial,
  };
}

/* ------------------------------------------------------------------ views */

const TONE: Record<PackageState, string> = {
  Active: "dz-pill--ok", "Used up": "dz-pill--off", Expired: "dz-pill--err", Cancelled: "dz-pill--err",
  Frozen: "dz-pill--warn", "Not started": "dz-pill--info", Inactive: "dz-pill--off",
};

export function PackageCard({ v }: { v: PackageView }) {
  const sub = [v.validity, v.bought ? `Bought ${v.bought}` : null, v.centre].filter(Boolean).join(" · ");
  return (
    <Panel icon={<PackageIcon />} title={v.name} sub={sub || undefined}
      right={<span className={`dz-pill dz-pill--sm ${TONE[v.state]}`}>{v.state}</span>}>
      <div className="dz-stack--sm">
        {v.total === null ? (
          <div className="dz-hint">Zenoti doesn’t list the sessions in this package, so there is no count to show.</div>
        ) : (
          <>
            <div className="dz-row" style={{ gap: 10 }}>
              <Prog pct={v.total ? (v.used / v.total) * 100 : 0} w="flex-1" />
              <b className="shrink-0 text-[14px]">{v.used} of {v.total} used · {v.left} left</b>
            </div>
            {v.services.length > 1 && (
              <div>
                {v.services.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-3 border-b border-border py-2 text-[14px] last:border-0">
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="shrink-0 text-ink2">{s.used} of {s.total} used · <b className={s.left ? "text-ink" : "text-ink3"}>{s.left} left</b></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {v.booked.map((b) => (
          <div key={b.key} className="flex items-center gap-2 text-[13.5px] text-ink2">
            <CalendarClock className="h-4 w-4 shrink-0" />
            <span>Booked: {b.name}{b.when ? ` · ${b.when}` : ""}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Compact line for the overview and the consult room. */
export function PackageLine({ v }: { v: PackageView }) {
  return (
    <div className="grid gap-1.5 border-b border-border py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3 text-[14px]">
        <b className="min-w-0 truncate">{v.name}</b>
        <span className="shrink-0 text-[13px] text-ink2">{v.total === null ? "Sessions not listed" : `${v.left} of ${v.total} left`}</span>
      </div>
      {v.total !== null && <Prog pct={v.total ? (v.used / v.total) * 100 : 0} w="w-full" />}
      {v.validity && <span className="text-[12.5px] text-ink3">{v.validity}</span>}
    </div>
  );
}

function ago(v: string | null) {
  const t = time(v);
  if (t === null) return null;
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return fmtWhen(v!);
}

/** Where the balances came from, and a way to pull them again. */
export function PackagesFreshness({ linked, syncedAt, pulling, pullFailed, onPull }: {
  linked: boolean; syncedAt: string | null; pulling: boolean; pullFailed: boolean; onPull: () => void;
}) {
  if (!linked) return null;
  const when = ago(syncedAt);
  const text = pulling ? "Checking Zenoti for the latest balances…"
    : pullFailed ? `Couldn’t reach Zenoti — showing the copy from ${when ?? "the last sync"}`
    : when ? `Balances from Zenoti · updated ${when}` : "Not read from Zenoti yet";
  return (
    <div className="dz-row" style={{ gap: 8 }}>
      <span className={`flex-1 text-[13px] ${pullFailed ? "text-ink2" : "text-ink3"}`}>{text}</span>
      <button type="button" className="dz-link" onClick={onPull} disabled={pulling}><RefreshCw />{pulling ? "Refreshing…" : "Refresh"}</button>
    </div>
  );
}
