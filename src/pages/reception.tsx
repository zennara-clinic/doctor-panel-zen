import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Page, Btn, Tag, STATUS, Stats, Card, DataTable, B, Tabs, Note, Hint, Async, Empty,
  AreaChart, GBars, HBars, ChartCard, SecH, Prog, Modal, Drawer, Menu, In, Sel, Area, Otp,
  exportCsv, StaleBanner, Spinner, Loading, FilterDrawer, FSection, Chips, MultiSelect, DateRange, NumRange, ActiveFilters, ExportModal,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { ZenotiMembershipCard, ZenotiPackageCard, appointmentState, fmtZDate, fmtZWhen, membershipActive, money, pkgActive } from "./zenoti";
import { getSocket, type ChatUpdate, type DeletedEvent, type PresenceEvent, type TypingEvent } from "../lib/socket";
import { useApi, useDebounced, useMutation, usePoll } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import { CLINIC_TZ,
  ageFrom, bookingProvider, bookingServiceName, bookingSlotDate, bookingSlotLabel, bookingSource, fmtAgo, fmtCompactINR,
  fmtDate, fmtDateFull, fmtINR, fmtWhen, idOf, initials, isoDay, isVip, nameOf, patientFlags, pct,
  statusKey, mapToRows, isConsultationBooking, clinicHM, addClinicDays, clinicMonthEnd,
  clinicMonthStart, clinicWeekday, dayKeyDate, fmtDayKey,
} from "../lib/format";
import type { ConsultationStage, Booking, Branch, Chat as ChatThread, ChatMessage, Consultation, Doctor, ProductOrder, User } from "../lib/types";

/* ================= OVERVIEW ================= */
const RANGE_PRESETS: [string, () => { startDate: string; endDate: string }][] = [
  ["Today", () => { const e = isoDay(); return { startDate: e, endDate: e }; }],
  ["Last 7 days", () => { const e = isoDay(); return { startDate: addClinicDays(e, -6), endDate: e }; }],
  ["Last 30 days", () => { const e = isoDay(); return { startDate: addClinicDays(e, -29), endDate: e }; }],
  ["This month", () => { const e = isoDay(); return { startDate: clinicMonthStart(e), endDate: e }; }],
  ["Last month", () => { const e = addClinicDays(clinicMonthStart(isoDay()), -1); return { startDate: clinicMonthStart(e), endDate: clinicMonthEnd(e) }; }],
  ["Last 90 days", () => { const e = isoDay(); return { startDate: addClinicDays(e, -89), endDate: e }; }],
  ["This year", () => { const e = isoDay(); return { startDate: `${e.slice(0, 4)}-01-01`, endDate: e }; }],
];

export function Overview() {
  const nav = useNavigate();
  const { branchId, branch } = useStore();
  const [range, setRange] = useState("Last 30 days");
  const [custom, setCustom] = useState<{ startDate: string; endDate: string } | null>(null);
  const window = useMemo(() => custom ?? (RANGE_PRESETS.find(([l]) => l === range)?.[1]() ?? RANGE_PRESETS[2][1]()), [range, custom]);

  const q = useApi(() => api.analytics.dashboard({ ...window, branchId: branchId || undefined }), [window.startDate, window.endDate, branchId]);
  usePoll(q.reload, 120000, true);
  const d = q.data;

  const streamRows = (d?.revenue.streams ?? []).map((s) => [s.label, s.revenue, `${s.count} · app ${fmtCompactINR(s.app)}${s.clinic ? ` · clinic ${fmtCompactINR(s.clinic)}` : ""}`] as [string, number, string]);
  const dailyPts = d?.daily.map((x) => x.total) ?? [];
  const dailyLabels = d?.daily.map((x) => fmtDayKey(String(x.date).slice(0, 10), { day: "numeric", month: "short" })) ?? [];
  const byKind = d ? [
    { n: "Consultations", v: d.daily.map((x) => x.consultations) },
    { n: "Treatments", v: d.daily.map((x) => x.treatments) },
    { n: "Products", v: d.daily.map((x) => x.products) },
    { n: "Packages", v: d.daily.map((x) => x.packages) },
  ] : [];
  // Group the daily series into ≤ 8 buckets so the grouped bars stay legible.
  const bucket = (arr: number[]) => { const size = Math.max(1, Math.ceil(arr.length / 8)); const out: number[] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size).reduce((a, b) => a + b, 0)); return out; };
  const bucketLabels = (() => { const size = Math.max(1, Math.ceil(dailyLabels.length / 8)); const out: string[] = []; for (let i = 0; i < dailyLabels.length; i += size) out.push(dailyLabels[i]); return out; })();

  const attention = d ? [
    d.counts.awaitingConfirmation ? [`${d.counts.awaitingConfirmation} booking${d.counts.awaitingConfirmation === 1 ? "" : "s"} awaiting confirmation`, "/bookings?tab=1"] : null,
    d.counts.openOrders ? [`${d.counts.openOrders} product order${d.counts.openOrders === 1 ? "" : "s"} still open`, "/orders"] : null,
    d.counts.packagesUnpaid ? [`${d.counts.packagesUnpaid} package${d.counts.packagesUnpaid === 1 ? "" : "s"} assigned but unpaid`, "/packages"] : null,
    d.counts.outstanding ? [`${fmtINR(d.counts.outstanding)} outstanding on bookings & packages`, "/bookings"] : null,
    d.counts.zenExpiring ? [`${d.counts.zenExpiring} Zen membership${d.counts.zenExpiring === 1 ? "" : "s"} expiring within 30 days`, "/patients"] : null,
  ].filter(Boolean) as [string, string][] : [];

  const growth = d?.revenue.growthPercent;

  return (
    <Page title="Overview" sub={`${branch && branch !== "All branches" ? branch : "All centres"} · ${custom ? `${custom.startDate} → ${custom.endDate}` : range}`}
      actions={<>
        <Menu button={<Btn kind="ghost">{custom ? "Custom range" : range} ▾</Btn>}
          items={[...RANGE_PRESETS.map(([l]) => ({ label: l, onClick: () => { setCustom(null); setRange(l); } })), { label: "Custom…", onClick: () => setCustom(window) }]} />
        {custom && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={custom.startDate} max={custom.endDate} onChange={(e) => setCustom({ ...custom, startDate: e.target.value })} className="rounded-lg border border-border bg-ivory px-2 py-1.5 text-[12px]" />
            <span className="text-ink3">→</span>
            <input type="date" value={custom.endDate} min={custom.startDate} onChange={(e) => setCustom({ ...custom, endDate: e.target.value })} className="rounded-lg border border-border bg-ivory px-2 py-1.5 text-[12px]" />
          </div>
        )}
        <Btn kind="ghost" disabled={!d} onClick={() => d && exportCsv("zennara-overview",
          ["Metric", "Value"],
          [
            ["Period", `${d.period.startDate} → ${d.period.endDate}`], ["Centre", d.period.branch],
            ["Total revenue", d.revenue.total], ["Previous period", d.revenue.previous],
            ...d.revenue.streams.map((s) => [`${s.label} revenue`, s.revenue] as [string, number]),
            ...d.revenue.streams.map((s) => [`${s.label} count`, s.count] as [string, number]),
            ["Bookings", d.counts.bookings], ["Completed", d.counts.completed], ["No-shows", d.counts.noShow], ["Cancelled", d.counts.cancelled],
            ["Product orders", d.counts.orders], ["Packages assigned", d.counts.packagesAssigned], ["Memberships sold", d.counts.membershipsSold],
            ["New patients", d.counts.newPatients], ["Active Zen members", d.counts.activeZen], ["Outstanding", d.counts.outstanding], ["Average ticket", d.counts.averageTicket],
            ...d.dermatologists.map((x) => [`${x.name} (${x.level})`, `${x.bookings} bookings · ${x.completed} completed · ₹${x.revenue}`] as [string, string]),
          ])}>Export CSV</Btn>
      </>}>
      <Hint id="overview-live">Everything the clinic did in the period — revenue per stream (app and clinic/Zenoti together), counts, and how each dermatologist is performing. Change the centre from the top-left switch; tiles open the detailed page.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Building the dashboard…" rows={8}>
        {() => d && (
          <>
            <Stats items={[
              { k: "Total revenue", v: fmtCompactINR(d.revenue.total), hot: true,
                d: growth === null || growth === undefined
                  ? (d.revenue.previousHasData === false ? "no comparable earlier period" : `prev ${fmtCompactINR(d.revenue.previous)}`)
                  : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth)}% vs previous ${d.period.days}d`,
                tone: growth === null || growth === undefined ? undefined : growth >= 0 ? "up" : "dn", onClick: () => nav("/analytics") },
              ...d.revenue.streams.map((s) => ({
                k: s.label,
                // A membership with no recorded price would otherwise read as ₹0 of sales.
                v: s.key === "memberships" && s.revenue === 0 && s.count > 0 ? `${s.count} sold` : fmtCompactINR(s.revenue),
                d: s.unpriced
                  ? `${s.count.toLocaleString("en-IN")} sold · ${s.unpriced} without a recorded price`
                  : `${s.count.toLocaleString("en-IN")} ${s.key === "products" ? "orders" : s.key === "memberships" ? "sold" : s.key === "packages" ? "assigned" : "booked"}`,
                onClick: () => nav(s.key === "products" ? "/orders" : s.key === "packages" ? "/packages" : s.key === "memberships" ? "/patients" : "/bookings"),
              })),
            ]} />
            <Stats items={[
              { k: "Consultations", v: d.counts.consultations, d: `${d.counts.bookings} bookings in total`, onClick: () => nav("/bookings") },
              { k: "Treatments", v: d.counts.treatments, d: `${d.counts.completed} completed`, onClick: () => nav("/bookings") },
              { k: "Product orders", v: d.counts.orders, d: `${d.counts.openOrders} open · ${d.counts.paidOrders} paid`, onClick: () => nav("/orders") },
              { k: "New patients", v: d.counts.newPatients.toLocaleString("en-IN"), d: `${d.counts.totalPatients.toLocaleString("en-IN")} on file`, onClick: () => nav("/patients") },
              { k: "Zen members", v: d.counts.activeZen, d: `${d.counts.membershipsSold} sold · ${d.counts.zenExpiring} expiring`, tone: d.counts.zenExpiring ? "dn" : undefined, onClick: () => nav("/patients") },
              { k: "No-show rate", v: `${d.counts.noShowRate}%`, d: `${d.counts.noShow} no-shows · ${d.counts.cancellationRate}% cancelled`, tone: d.counts.noShowRate > 10 ? "dn" : undefined, onClick: () => nav("/bookings?tab=7") },
            ]} />

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <ChartCard title="Revenue by day" sub="Everything paid, all streams" hero={fmtINR(d.revenue.total)}>
                {dailyPts.length > 1 ? <AreaChart pts={dailyPts} label="Revenue" labels={dailyLabels} format={fmtCompactINR} /> : <Empty title="Pick a longer range to see a trend" />}
              </ChartCard>
              <ChartCard title="Revenue by stream" sub="App and clinic (Zenoti) combined">
                {streamRows.length ? <HBars rows={streamRows} /> : <Empty title="No revenue in this period" />}
              </ChartCard>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <ChartCard title="Dermatologists" sub="Performance in the period — all centres' visits attributed by practitioner">
                {d.dermatologists.length === 0 ? <Empty title="No dermatologists on the roster" /> : (
                  <>
                    <div className="mb-3 rounded-xl border border-border bg-ivory/50 px-3 py-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.07em] text-ink3">
                        <span>Revenue contribution</span><span>Hover for exact values</span>
                      </div>
                      <HBars rows={[...d.dermatologists].sort((a, b) => b.revenue - a.revenue).slice(0, 6)
                        .map((x) => [x.name, x.revenue, fmtCompactINR(x.revenue)] as [string, number, string])} />
                    </div>
                    <DataTable cols={["Dermatologist", "Level", "Bookings", "Consults", "Treatments", "Completed", "No-show", "Patients", "Rating", "Revenue"]}
                      onRow={(i) => nav(`/bookings?scope=all`, { state: { specialistId: d.dermatologists[i].doctorId } })}
                      rows={d.dermatologists.map((x, i) => [
                        <span key={x.doctorId} className="flex items-center gap-2">
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${i === 0 && x.revenue > 0 ? "bg-gold text-primary" : "bg-sage text-ink2"}`}>{i + 1}</span>
                          <B>{x.name}</B>{!x.onboarded && <Tag kind="info">Zenoti</Tag>}
                        </span>,
                        <Tag key={`${x.doctorId}l`} kind={!x.onboarded ? "info" : x.level === "Senior Dermatologist" ? "gold" : "mute"}>{x.level}</Tag>,
                        x.bookings, x.consultations, x.treatments,
                        <span key={`${x.doctorId}c`}>{x.completed} <span className="text-[10.5px] text-ink3">({x.completionRate}%)</span></span>,
                        x.noShow, x.patients,
                        x.avgRating ? `★ ${x.avgRating}` : "—",
                        <B key={`${x.doctorId}r`}>{fmtINR(x.revenue)}</B>,
                      ])} />
                  </>
                )}
              </ChartCard>
              <div className="grid gap-3">
                <ChartCard title="Top services" sub="By revenue, then volume">
                  {d.topServices.length ? <HBars rows={d.topServices.slice(0, 8).map((s) => [s.name, s.revenue, `${s.bookings} · ${s.kind}`] as [string, number, string])} color="var(--color-c2)" /> : <Empty title="No services booked" />}
                </ChartCard>
                <ChartCard title="Needs attention">
                  {attention.length === 0 ? <div className="text-[12.5px] text-ink3">Nothing outstanding. 🎉</div> : attention.map(([label, to]) => (
                    <button key={label} onClick={() => nav(to)} className="flex w-full items-center justify-between border-b border-border py-2 text-left text-[12.5px] last:border-0 hover:text-gold-dark">
                      <span>{label}</span><span className="text-ink3">→</span>
                    </button>
                  ))}
                </ChartCard>
              </div>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              <ChartCard title="Revenue by stream over time">
                {bucketLabels.length > 1 ? <GBars cats={bucketLabels} series={byKind.map((s) => ({ n: s.n, v: bucket(s.v) }))} /> : <Empty title="Pick a longer range" />}
              </ChartCard>
              <ChartCard title="Revenue by centre" sub="Bookings only — orders have no centre">
                {d.revenueByCentre.length ? <HBars rows={d.revenueByCentre.map((r) => [r.centre, r.revenue, `${r.bookings} bookings`] as [string, number, string])} color="var(--color-c3)" /> : <Empty title="No bookings" />}
              </ChartCard>
              <ChartCard title="Payment mix" sub="How the money came in">
                {d.paymentMix.length ? <HBars rows={d.paymentMix.map((p) => [p.method, p.amount] as [string, number])} color="var(--color-c4)" /> : <Empty title="No payments" />}
                <div className="mt-3 border-t border-border pt-2 text-[11.5px] text-ink3">
                  Bookings by source: {Object.entries(d.counts.bookingsBySource).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"} · Avg ticket {fmtINR(d.counts.averageTicket)}
                </div>
              </ChartCard>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}


function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between border-b border-border py-1.5 text-[12.5px] last:border-0"><span className="text-ink3">{k}</span><B>{v}</B></div>;
}

/* ---- pick the dermatologist before a session starts ---- */
type DermChoice = { mode: "keep" | "roster" | "custom"; id: string; name: string };
const dermReady = (bk: Booking | undefined, d: DermChoice) =>
  !!bk && (d.mode === "keep" ? !!(bk.specialistName || bk.therapistName) : d.mode === "roster" ? !!d.id : d.name.trim().length >= 2);
const dermBody = (d: DermChoice) => (d.mode === "roster" ? { specialistId: d.id } : d.mode === "custom" ? { specialistName: d.name.trim() } : undefined);

function DermPicker({ booking, value, onChange }: { booking: Booking; value: DermChoice; onChange: (v: DermChoice) => void }) {
  const docs = useApi(() => api.doctors.list().catch(() => ({ success: true, data: [] as Doctor[] })), []);
  const list = (docs.data?.data ?? []).filter((d) => !booking.preferredLocation || !d.availableCentres?.length || d.availableCentres.includes(booking.preferredLocation));
  const current = booking.specialistName || booking.therapistName || "";
  return (
    <div className="mt-3 rounded-xl border border-border bg-ivory p-3">
      <div className="mb-1.5 text-[11px] font-bold text-ink2">Dermatologist for this session {current ? "" : <span className="text-err">· required</span>}</div>
      <div className="flex flex-wrap gap-1.5">
        {current && <button type="button" onClick={() => onChange({ ...value, mode: "keep" })} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${value.mode === "keep" ? "border-primary bg-primary text-white" : "border-border bg-surface"}`}>Keep {current}</button>}
        <button type="button" onClick={() => onChange({ ...value, mode: "roster" })} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${value.mode === "roster" ? "border-primary bg-primary text-white" : "border-border bg-surface"}`}>From the roster</button>
        <button type="button" onClick={() => onChange({ ...value, mode: "custom" })} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${value.mode === "custom" ? "border-primary bg-primary text-white" : "border-border bg-surface"}`}>Other name</button>
      </div>
      {value.mode === "roster" && (
        <select value={value.id} onChange={(e) => onChange({ ...value, id: e.target.value })} className="mt-2 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px] outline-none">
          <option value="">Choose a dermatologist…</option>
          {list.map((d) => <option key={d._id} value={d.doctorId}>{d.name} · {d.tier === "senior-consultant" ? "Senior Dermatologist" : "Dermatologist"}</option>)}
        </select>
      )}
      {value.mode === "custom" && (
        <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="e.g. Dr Varsha (visiting)" className="mt-2 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px] outline-none" />
      )}
    </div>
  );
}


const STAGE_LABEL: Record<string, string> = {
  booked: "Booked", confirmed: "Confirmed", checked_in: "Checked in", waiting: "Waiting",
  consultation_started: "Consultation started", consultation_completed: "Consultation completed",
  prescription_created: "Prescription created", treatment_recommended: "Treatment recommended",
  follow_up_required: "Follow-up required", no_follow_up: "No follow-up needed",
};

/** "Pre-consultation form: Completed" — one cheap call per opened booking. */
function FormStatusLine({ bk }: { bk: Booking }) {
  const st = useApi(() => api.preConsult.statusForBooking(bk._id).catch(() => null), [bk._id]);
  if (!st.data) return null;
  const kind = st.data.state === "completed" ? "ok" : st.data.state === "draft" ? "warn" : "mute";
  return (
    <div className="mt-2 rounded-lg bg-ivory px-2.5 py-2 text-[11.5px] text-ink2">
      <span className="mr-2">Pre-consultation form:</span>
      <Tag kind={kind}>{st.data.label}</Tag>
      <span className="ml-2 text-ink3">Open the consultation to read it in full.</span>
    </div>
  );
}

/** Where the consultation is; the desk's two moves are waiting / with dermatologist. */
function StageLine({ bk, onChanged }: { bk: Booking; onChanged: () => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (["Cancelled", "No Show"].includes(bk.status)) return null;
  const move = async (stage: ConsultationStage) => {
    setBusy(true);
    try { await api.bookings.setStage(bk._id, { stage }); toast(STAGE_LABEL[stage]); onChanged(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-ivory px-2.5 py-2 text-[11.5px] text-ink2">
      <span>Consultation:</span>
      <Tag kind={bk.consultationStage ? "info" : "mute"}>{bk.consultationStage ? STAGE_LABEL[bk.consultationStage] : "Not started"}</Tag>
      {bk.followUp?.required && <Tag kind="gold">Follow-up{bk.followUp.dueDate ? ` · ${fmtDate(bk.followUp.dueDate)}` : ""}</Tag>}
      {["In Progress", "Confirmed", "Rescheduled"].includes(bk.status) && (
        <>
          <button className="underline-offset-2 hover:underline" disabled={busy} onClick={() => move("waiting")}>Mark waiting</button>
          <button className="underline-offset-2 hover:underline" disabled={busy} onClick={() => move("consultation_started")}>With dermatologist</button>
        </>
      )}
    </div>
  );
}

function BookingDrawer({ id, onClose, onChanged }: {
  id: string | null; onClose: () => void; onChanged: () => void;
}) {
  const { toast, audit, admin } = useStore();
  const nav = useNavigate();
  const route = useLocation();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [resOpen, setResOpen] = useState(false);
  const [resDate, setResDate] = useState(isoDay());
  const [resTime, setResTime] = useState("");
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [code, setCode] = useState("");
  const [manualOpen, setManualOpen] = useState<"checkin" | "checkout" | null>(null);
  const [derm, setDerm] = useState<DermChoice>({ mode: "keep", id: "", name: "" });
  const [revealed, setRevealed] = useState<{ kind: "checkin" | "checkout"; code: string; sentAt?: string | null } | null>(null);
  useEffect(() => { setDerm({ mode: "keep", id: "", name: "" }); setRevealed(null); setDermOpen(false); }, [id]);
  const [dermOpen, setDermOpen] = useState(false);
  const [manualReason, setManualReason] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [resReason, setResReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState("Cash");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [noteText, setNoteText] = useState("");

  const q = useApi(() => (id ? api.bookings.get(id) : Promise.resolve(undefined as unknown as Booking)), [id]);
  const bk = q.data;

  const act = useMutation(async (fn: () => Promise<unknown>, message: string) => {
    await fn();
    toast(message);
    q.reload();
    onChanged();
  });

  useEffect(() => {
    if (!bk) return;
    setResDate(isoDay(new Date(bk.confirmedDate || bk.preferredDate)));
    setResTime(bk.confirmedTime || bk.preferredTimeSlots?.[0] || "");
    setPayAmount(String(bk.amount ?? 0));
    setPayMethod(bk.paymentMethod && bk.paymentMethod !== "Razorpay" ? bk.paymentMethod : "Cash");
  }, [bk?._id]);

  if (!id) return null;

  return (
    <>
      <Drawer open onClose={onClose} title={bk?.fullName ?? "Booking"}>
        {!bk ? <Loading label="Loading booking…" rows={4} /> : (
          <>
            <Card className="p-4">
              <div className="text-[15px] font-bold">{bookingServiceName(bk, "Service")}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink2">
                <span>{bk.specialistName || bk.therapistName ? <>Dermatologist <B>{bookingProvider(bk)}</B></> : <span className="text-err">No dermatologist assigned</span>} · {bk.preferredLocation}</span>
                {!["Cancelled", "Completed", "No Show"].includes(bk.status) && (
                  <button className="text-[11px] text-ink3 underline-offset-2 hover:underline" onClick={() => { setDerm({ mode: "roster", id: "", name: "" }); setDermOpen(true); }}>
                    {bk.specialistName || bk.therapistName ? "change" : "assign"}
                  </button>
                )}
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink2"><B>{fmtDateFull(bk.confirmedDate || bk.preferredDate)}</B> · {bk.confirmedTime || bk.preferredTimeSlots?.[0] || "time TBC"} <span className="text-ink3">({bookingSlotLabel(bk).split(" ")[0]})</span> · via {bookingSource(bk)}</div>
              <div className="mt-0.5 font-mono text-[11px] text-ink3">{bk.referenceNumber}</div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {STATUS[statusKey(bk)]}
                {bk.paymentStatus === "paid"
                  ? <Tag kind="ok">Paid {fmtINR(bk.amount)}{bk.paymentMethod ? ` · ${bk.paymentMethod}` : ""}</Tag>
                  : bk.paymentStatus === "refunded" ? <Tag kind="mute">Refunded</Tag>
                  : <Tag kind="warn">{fmtINR(bk.amount)} due</Tag>}
                {bk.therapistName && <Tag kind="info">with {bk.therapistName}</Tag>}
              </div>
              {bk.session && (bk.session.total ?? 0) > 0 && (
                <div className="mt-2 rounded-lg bg-ivory px-2.5 py-2 text-[12px]">
                  <B>Session bill from the floor:</B> {fmtINR(bk.session.total)}
                  {(bk.session.items ?? []).filter((i) => i.billable).length > 0 && (
                    <span className="text-ink3"> · {(bk.session.items ?? []).filter((i) => i.billable).map((i) => `${i.name} ×${i.qty}`).join(", ")}</span>
                  )}
                </div>
              )}
              <div className="mt-2 text-[12px] text-ink2">{bk.mobileNumber}{!bk.email || /@zennara\.local$|@guest\.zennara\.in$/i.test(bk.email) ? " · no email on file" : ` · ${bk.email}`}</div>
              {(bk.manualCheckIn?.at || bk.manualCheckOut?.at || (bk.visitCodeLog?.length ?? 0) > 0) && (
                <div className="mt-2 rounded-lg bg-ivory px-2.5 py-2 text-[11.5px] text-ink2">
                  {bk.manualCheckIn?.at && <div>Checked in <B>without a code</B> by {bk.manualCheckIn.byName ?? "staff"} {fmtAgo(bk.manualCheckIn.at)} — “{bk.manualCheckIn.reason}”</div>}
                  {bk.manualCheckOut?.at && <div>Checked out <B>without a code</B> by {bk.manualCheckOut.byName ?? "staff"} {fmtAgo(bk.manualCheckOut.at)} — “{bk.manualCheckOut.reason}”</div>}
                  {(bk.visitCodeLog ?? []).slice(-3).reverse().map((l, i) => (
                    <div key={i}>{l.kind === "checkin" ? "Check-in" : "Check-out"} code sent by {l.channels.join(" + ") || "—"}{l.failed?.length ? ` (failed: ${l.failed.join(", ")})` : ""} · {l.byName ?? "staff"} · {fmtAgo(l.at)}</div>
                  ))}
                </div>
              )}
              <FormStatusLine bk={bk} />
              <StageLine bk={bk} onChanged={() => { q.reload(); onChanged(); }} />
              {bk.notes && <Note className="mb-0">{bk.notes}</Note>}
            </Card>

            {act.error && <Note kind="crit">{act.error}</Note>}

            <div className="mt-3 grid gap-2">
              {bk.status === "Rescheduled" && (
                <Note>The guest requested new times: <B>{bk.preferredTimeSlots?.join(" · ") || "—"}</B>. Accept to confirm one, or decline to keep the original slot.</Note>
              )}
              {(bk.status === "Awaiting Confirmation" || bk.status === "Rescheduled") && (
                <Btn disabled={act.busy} onClick={() => act.mutate(
                  () => api.bookings.confirm(bk._id, {
                    confirmedDate: bk.confirmedDate || bk.preferredDate,
                    confirmedTime: bk.confirmedTime || bk.preferredTimeSlots?.[0] || "",
                  }).then(() => audit("BOOKING_CONFIRMED", `${bk.fullName} · ${bookingServiceName(bk)}`, { bookingId: bk._id })),
                  bk.status === "Rescheduled" ? "Reschedule accepted — the guest has been notified" : "Booking confirmed — the guest has been notified",
                )}>{bk.status === "Rescheduled" ? "Accept new time" : "Confirm booking"}</Btn>
              )}
              {bk.status === "Rescheduled" && (
                <Btn kind="danger" disabled={act.busy} onClick={() => act.mutate(
                  () => api.bookings.rejectReschedule(bk._id).then(() => audit("BOOKING_RESCHEDULED", `${bk.fullName} · reschedule declined`, { bookingId: bk._id })),
                  "Reschedule declined — original time kept",
                )}>Decline reschedule</Btn>
              )}
              {(bk.status === "Confirmed" || bk.status === "No Show") && (
                <Btn disabled={act.busy} onClick={() => { setCode(""); act.clearError?.(); setCheckInOpen(true); }}>
                  Check in — enter guest code
                </Btn>
              )}
              {bk.status === "In Progress" && (
                <Btn kind="gold" disabled={act.busy} onClick={() => { setCode(""); act.clearError?.(); setCheckOutOpen(true); }}>
                  Check out — enter guest code
                </Btn>
              )}
              {(bk.status === "Confirmed" || bk.status === "No Show" || bk.status === "Rescheduled" || bk.status === "In Progress") && (() => {
                const kind: "checkin" | "checkout" = bk.status === "In Progress" ? "checkout" : "checkin";
                const label = kind === "checkin" ? "check-in" : "check-out";
                const hasEmail = !!bk.email && !/@guest\.zennara\.in$/i.test(bk.email);
                const sentAt = kind === "checkin" ? bk.checkInCodeSentAt : bk.checkOutCodeSentAt;
                const send = async (channel: "email" | "whatsapp" | "both") => {
                  setSending(channel);
                  try {
                    const r = await api.bookings.sendVisitCode(bk._id, { kind, channel });
                    toast(`${kind === "checkin" ? "Check-in" : "Check-out"} code sent by ${r.delivered.join(" and ")}`);
                    audit("BOOKING_UPDATED", `${bk.fullName} · ${label} code sent by ${r.delivered.join("+")}`, { bookingId: bk._id });
                    q.reload();
                  } catch (e) { toast((e as Error).message); } finally { setSending(null); }
                };
                return (
                  <>
                    <Menu button={<Btn kind="ghost" disabled={!!sending}>{sending ? "Sending…" : `Send ${label} code ▾`}</Btn>}
                      items={[
                        { label: hasEmail ? `Email (${bk.email})` : "Email — no address on file", onClick: hasEmail ? () => send("email") : undefined },
                        { label: `WhatsApp (${bk.mobileNumber})`, onClick: () => send("whatsapp") },
                        { label: "Both", onClick: () => send("both") },
                      ]} />
                    <Btn kind="ghost" disabled={act.busy} onClick={() => { setManualReason(""); act.clearError?.(); setManualOpen(kind); }}>
                      {kind === "checkin" ? "Check in without code" : "Check out without code"}
                    </Btn>
                    {sentAt && <span className="self-center text-[11px] text-ink3">Code last sent {fmtAgo(sentAt)}</span>}
                  </>
                );
              })()}
              {(bk.status === "Confirmed" || bk.status === "Awaiting Confirmation" || bk.status === "Rescheduled") && (
                <Btn kind="ghost" disabled={act.busy} onClick={() => act.mutate(
                  () => api.bookings.noShow(bk._id).then(() => audit("BOOKING_NO_SHOW", bk.fullName, { bookingId: bk._id })),
                  "Marked as no-show",
                )}>Mark no-show</Btn>
              )}
              {bk.paymentStatus !== "paid" && !["Cancelled", "No Show"].includes(bk.status) && (
                <Btn kind="gold" disabled={act.busy} onClick={() => { act.clearError?.(); setPayOpen(true); }}>Record payment</Btn>
              )}
              <Btn kind="ghost" onClick={() => nav("/patient", {
                state: { id: idOf(bk.userId), returnTo: `${route.pathname}${route.search}` },
              })}>Open patient record</Btn>
              {!["Cancelled", "Completed", "No Show"].includes(bk.status) && (
                <Btn kind="ghost" onClick={() => setResOpen(true)}>Reschedule</Btn>
              )}
              {!["Cancelled", "Completed", "No Show"].includes(bk.status) && (
                <Btn kind="danger" onClick={() => { act.clearError?.(); setCancelOpen(true); }}>Cancel booking</Btn>
              )}
            </div>

            <div className="mt-4">
              <div className="mb-1 text-[11px] font-bold text-ink2">Desk notes</div>
              {bk.adminNotes
                ? <pre className="mb-2 whitespace-pre-wrap rounded-lg bg-ivory px-2.5 py-2 font-sans text-[12px] text-ink2">{bk.adminNotes}</pre>
                : <div className="mb-2 text-[12px] text-ink3">No notes yet.</div>}
              <div className="flex gap-2">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note for the desk…"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
                <Btn kind="ghost" disabled={act.busy || noteText.trim().length < 2} onClick={async () => {
                  const ok = await act.run(
                    () => api.bookings.addNote(bk._id, noteText.trim()).then(() => audit("BOOKING_UPDATED", `${bk.fullName} · note`, { bookingId: bk._id })),
                    "Note added",
                  );
                  if (ok) setNoteText("");
                }}>Add</Btn>
              </div>
            </div>
          </>
        )}
      </Drawer>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel booking">
        <Area label="Reason (required — stored on the booking and the audit log)" value={reason} onChange={setReason}
          placeholder="e.g. guest requested / dermatologist on leave" />
        {act.error && <Note kind="crit" className="mt-3">{act.error}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setCancelOpen(false)}>Back</Btn>
          <Btn kind="danger" disabled={reason.trim().length < 4 || act.busy} onClick={async () => {
            if (!bk) return;
            const ok = await act.run(
              () => api.bookings.cancel(bk._id, reason.trim())
                .then(() => audit("BOOKING_CANCELLED", `${bk.fullName} · ${reason.trim()}`, { bookingId: bk._id })),
              "Booking cancelled",
            );
            if (ok) { setCancelOpen(false); setReason(""); }
          }}>Cancel booking</Btn>
        </div>
      </Modal>

      <Modal open={checkInOpen} onClose={() => setCheckInOpen(false)} title="Check in — enter the guest's code">
        <Note>Ask the guest for the 6-digit check-in code on their Zennara appointment screen (it's also on their email / WhatsApp).</Note>
        {bk && <DermPicker booking={bk} value={derm} onChange={setDerm} />}
        <div className="mt-3"><Otp value={code} onChange={setCode} length={6} /></div>
        {revealed && <div className="mt-2 text-[12px] text-ink3">Current {revealed.kind === "checkout" ? "check-out" : "check-in"} code: <B>{revealed.code}</B>{revealed.sentAt ? ` · sent ${fmtAgo(revealed.sentAt)}` : " · not sent yet"}</div>}
        {act.error && <Note kind="crit" className="mt-3">{act.error}</Note>}
        <div className="mt-4 flex items-center justify-between gap-2">
          {admin?.role === "super_admin" ? (
            <button className="text-[11.5px] text-ink3 underline-offset-2 hover:underline" onClick={async () => {
              if (!bk) return;
              try { setRevealed(await api.bookings.revealVisitCode(bk._id)); audit("BOOKING_UPDATED", `${bk.fullName} · code revealed`, { bookingId: bk._id }); }
              catch (e) { toast((e as Error).message); }
            }}>Guest can't find the code? Reveal it (logged)</button>
          ) : <span />}
          <div className="flex gap-2">
            <Btn kind="ghost" onClick={() => setCheckInOpen(false)}>Back</Btn>
            <Btn disabled={code.length < 6 || act.busy || !dermReady(bk, derm)} onClick={async () => {
              if (!bk) return;
              const ok = await act.run(
                () => api.bookings.verifyCheckIn(bk._id, code, dermBody(derm))
                  .then(() => audit("BOOKING_CHECKED_IN", `${bk.fullName}${derm.name ? ` · with ${derm.name}` : ""}`, { bookingId: bk._id })),
                `${bk.fullName} checked in — check-out code sent to the guest`,
              );
              if (ok) { setCheckInOpen(false); setCode(""); setRevealed(null); }
            }}>Check in</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={checkOutOpen} onClose={() => setCheckOutOpen(false)} title="Check out — enter the guest's code">
        <Note>Ask the guest for the 6-digit check-out code shown on their appointment screen once the session is done.</Note>
        <div className="mt-3"><Otp value={code} onChange={setCode} length={6} /></div>
        {act.error && <Note kind="crit" className="mt-3">{act.error}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setCheckOutOpen(false)}>Back</Btn>
          <Btn kind="gold" disabled={code.length < 6 || act.busy} onClick={async () => {
            if (!bk) return;
            const ok = await act.run(
              () => api.bookings.verifyCheckOut(bk._id, code)
                .then(() => audit("BOOKING_CHECKED_OUT", bk.fullName, { bookingId: bk._id })),
              "Session completed — guest checked out",
            );
            if (ok) { setCheckOutOpen(false); setCode(""); }
          }}>Check out</Btn>
        </div>
      </Modal>

      <Modal open={dermOpen} onClose={() => setDermOpen(false)} title="Dermatologist for this booking">
        {bk && <DermPicker booking={bk} value={derm} onChange={setDerm} />}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setDermOpen(false)}>Cancel</Btn>
          <Btn disabled={!bk || derm.mode === "keep" || !dermReady(bk, derm) || act.busy} onClick={async () => {
            if (!bk) return;
            const body = dermBody(derm);
            if (!body) return;
            const ok = await act.run(() => api.bookings.setDermatologist(bk._id, body).then(() => audit("BOOKING_UPDATED", `${bk.fullName} · dermatologist set`, { bookingId: bk._id })), "Dermatologist updated");
            if (ok) setDermOpen(false);
          }}>Save</Btn>
        </div>
      </Modal>

      <Modal open={manualOpen !== null} onClose={() => setManualOpen(null)} title={manualOpen === "checkout" ? "Check out without a code" : "Check in without a code"}>
        <Note kind="crit">Use this only when the guest cannot receive a code (no app, no email, no WhatsApp). It is recorded against your name on the booking and in the audit log.</Note>
        {bk && manualOpen === "checkin" && <DermPicker booking={bk} value={derm} onChange={setDerm} />}
        <div className="mt-3">
          <Area label="Reason" value={manualReason} onChange={setManualReason} placeholder="e.g. Walk-in guest, no phone with them" rows={2} />
        </div>
        {act.error && <Note kind="crit" className="mt-3">{act.error}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setManualOpen(null)}>Back</Btn>
          <Btn kind={manualOpen === "checkout" ? "gold" : "primary"} disabled={manualReason.trim().length < 3 || act.busy || (manualOpen === "checkin" && !dermReady(bk, derm))} onClick={async () => {
            if (!bk || !manualOpen) return;
            const isOut = manualOpen === "checkout";
            const ok = await act.run(
              () => (isOut ? api.bookings.manualCheckOut(bk._id, manualReason.trim()) : api.bookings.manualCheckIn(bk._id, manualReason.trim(), dermBody(derm)))
                .then(() => audit(isOut ? "BOOKING_CHECKED_OUT" : "BOOKING_CHECKED_IN", `${bk.fullName} · manual (${manualReason.trim()})`, { bookingId: bk._id })),
              isOut ? "Session completed — guest checked out (manual)" : `${bk.fullName} checked in (manual)`,
            );
            if (ok) setManualOpen(null);
          }}>{manualOpen === "checkout" ? "Check out" : "Check in"}</Btn>
        </div>
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment at the desk">
        <div className="grid gap-3 md:grid-cols-2">
          <Sel label="Method" value={payMethod} onChange={setPayMethod} options={["Cash", "Card", "UPI", "Package", "Membership", "Other"]} />
          <In label="Amount (₹)" type="number" value={payAmount} onChange={setPayAmount} />
        </div>
        <div className="mt-3"><Area label="Note (optional)" value={payNote} onChange={setPayNote} rows={2} placeholder="Receipt no., who took it…" /></div>
        {act.error && <Note kind="crit">{act.error}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setPayOpen(false)}>Back</Btn>
          <Btn kind="gold" disabled={act.busy || !(Number(payAmount) >= 0)} onClick={async () => {
            if (!bk) return;
            const ok = await act.run(
              () => api.bookings.setPayment(bk._id, { paymentStatus: "paid", paymentMethod: payMethod, amount: Number(payAmount), note: payNote.trim() || undefined })
                .then(() => audit("BOOKING_UPDATED", `${bk.fullName} · paid ${fmtINR(Number(payAmount))} by ${payMethod}`, { bookingId: bk._id })),
              "Payment recorded",
            );
            if (ok) { setPayOpen(false); setPayNote(""); }
          }}>Mark paid</Btn>
        </div>
      </Modal>

      <Modal open={resOpen} onClose={() => setResOpen(false)} title="Reschedule booking">
        <div className="grid gap-3 md:grid-cols-2">
          <In label="New date" type="date" value={resDate} onChange={setResDate} />
          <In label="New time" value={resTime} onChange={setResTime} placeholder="e.g. 15:30" />
        </div>
        <div className="mt-3">
          <Area label="Reason (goes into the desk notes)" value={resReason} onChange={setResReason} rows={2} placeholder="e.g. dermatologist on leave / guest asked" />
        </div>
        <Note>Leaving the time blank moves the booking back to “Rescheduled” so the guest can pick a slot.</Note>
        {act.error && <Note kind="crit">{act.error}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setResOpen(false)}>Back</Btn>
          <Btn disabled={!resDate || act.busy} onClick={async () => {
            if (!bk) return;
            const ok = await act.run(
              () => api.bookings.reschedule(bk._id, {
                preferredDate: resDate,
                confirmedTime: resTime || undefined,
                preferredTimeSlots: resTime ? [resTime] : undefined,
                reason: resReason.trim() || undefined,
              }).then(() => audit("BOOKING_RESCHEDULED", `${bk.fullName} → ${resDate} ${resTime}`, { bookingId: bk._id })),
              "Booking rescheduled",
            );
            if (ok) { setResOpen(false); setResReason(""); }
          }}>Save new slot</Btn>
        </div>
      </Modal>
    </>
  );
}

/* ================= new booking / walk-in ================= */
export function NewBookingModal({ open, onClose, onBooked, presetUser }: {
  open: boolean; onClose: () => void; onBooked: () => void;
  presetUser?: Pick<User, "_id" | "fullName" | "phone" | "email"> | null;
}) {
  const { toast, audit, branch, branches, branchId } = useStore();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(isoDay());
  const [time, setTime] = useState("");
  const [confirmNow, setConfirmNow] = useState(true);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refs = useApi(async () => {
    const [svc, docs] = await Promise.all([
      api.services.list({ isActive: "true", limit: 500 }),
      api.doctors.list(),
    ]);
    return { services: (svc.data ?? []) as Consultation[], doctors: (docs.data ?? []) as Doctor[] };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setName(presetUser?.fullName ?? "");
    setPhone(presetUser?.phone ?? "");
    setEmail(presetUser?.email?.endsWith("@zennara.local") ? "" : presetUser?.email ?? "");
    setLocation(branch && branch !== "All branches" ? branch : branches[0]?.name ?? "");
    setDate(isoDay()); setTime(""); setNotes(""); setErr(null); setConfirmNow(true);
  }, [open, presetUser?._id, branch, branches.length]);

  useEffect(() => {
    if (!serviceId && refs.data?.services.length) setServiceId(refs.data.services[0]._id);
  }, [refs.data?.services.length]);

  // Real bookable slots for the chosen centre and date.
  const slots = useApi(async () => {
    const b = branches.find((x) => x.name === location);
    if (!b || !date) return [] as string[];
    const res = await api.branches.slots(b._id, date).catch(() => undefined);
    const raw = (res as { slots?: string[]; availableSlots?: string[] } | undefined);
    return raw?.slots ?? raw?.availableSlots ?? [];
  }, [location, date, branches.length]);

  const service = refs.data?.services.find((s) => s._id === serviceId);
  const doctor = refs.data?.doctors.find((d) => d._id === doctorId);
  const eligibleDoctors = (refs.data?.doctors ?? []).filter(
    (d) => !location || !d.availableCentres?.length || d.availableCentres.includes(location),
  );

  const submit = async () => {
    setErr(null);
    if (name.trim().length < 2) return setErr("Enter the guest's full name");
    if (phone.replace(/\D/g, "").length < 10) return setErr("Enter a valid mobile number");
    if (!serviceId) return setErr("Pick a service");
    if (!location) return setErr("Pick a centre");
    if (!time) return setErr("Pick a time slot");

    setBusy(true);
    try {
      await api.bookings.create({
        consultationId: serviceId,
        fullName: name.trim(),
        mobileNumber: phone.trim(),
        email: email.trim() || undefined,
        preferredLocation: location,
        preferredDate: date,
        preferredTimeSlots: [time],
        specialistId: doctor?.doctorId,
        specialistName: doctor?.name,
        specialistTier: doctor?.tier,
        amount: service?.price,
        notes: notes.trim() || undefined,
        confirmNow,
        userId: presetUser?._id,
      });
      audit("BOOKING_CREATED", `${name.trim()} · ${service?.name ?? ""} · ${date} ${time}`);
      toast(`${name.trim()} is booked — confirmation sent`);
      onBooked();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={presetUser ? `Book for ${presetUser.fullName}` : "New booking"} wide>
      {refs.initial && !refs.data ? <Loading label="Loading services and dermatologists…" /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <In label="Guest name" value={name} onChange={setName} placeholder="Full name" />
            <In label="Mobile" value={phone} onChange={setPhone} placeholder="+91 …" />
            <In label="Email (optional)" value={email} onChange={setEmail} placeholder="name@email.com" />
            <Sel label="Centre" value={location} onChange={setLocation}
              options={branches.map((b) => b.name)} />
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-ink2">Service</label>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}
                className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark">
                {(refs.data?.services ?? []).map((s) => (
                  <option key={s._id} value={s._id}>{s.name} — {fmtINR(s.price)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-ink2">Dermatologist</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
                className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark">
                <option value="">Any available</option>
                {eligibleDoctors.map((d) => (
                  <option key={d._id} value={d._id}>{d.name}{d.designation ? ` — ${d.designation}` : ""}</option>
                ))}
              </select>
            </div>
            <In label="Date" type="date" value={date} onChange={setDate} />
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-ink2">
                Time slot {slots.loading && <Spinner className="ml-1 inline h-3 w-3" />}
              </label>
              {(slots.data ?? []).length > 0 ? (
                <select value={time} onChange={(e) => setTime(e.target.value)}
                  className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark">
                  <option value="">Choose a slot…</option>
                  {(slots.data ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 15:30"
                  className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
              )}
              {!slots.loading && (slots.data ?? []).length === 0 && (
                <div className="text-[10.5px] text-ink3">No published slots for this centre and date — type the time instead.</div>
              )}
            </div>
          </div>

          <div className="mt-3"><Area label="Desk notes (optional)" value={notes} onChange={setNotes} rows={2} /></div>

          <label className="mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-ivory px-3 py-2.5 text-[12.5px]">
            <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]" />
            <span>Confirm immediately (a walk-in standing at the desk). Leave off to send it for confirmation.</span>
          </label>

          <Note className="mb-0">
            If this mobile number is already on file we book against that record. A new number opens a patient record
            automatically, and the guest gets the booking on WhatsApp.
          </Note>

          {err && <Note kind="crit">{err}</Note>}

          <div className="mt-4 flex justify-end gap-2">
            <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
            <Btn disabled={busy} onClick={submit}>{busy ? "Booking…" : "Create booking"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ================= TODAY ================= */
/** One-hour rows whose complete session fits inside the centre's hours. */
function slotTimesFor(hours: Branch["operatingHours"] | undefined, day: string): string[] {
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][clinicWeekday(day)];
  const h = hours?.[weekday] as { open?: string; openTime?: string; close?: string; closeTime?: string; isOpen?: boolean } | undefined;
  const open = h?.open ?? h?.openTime ?? "09:00";
  const close = h?.close ?? h?.closeTime ?? "19:00";
  const toMin = (t: string) => { const [a, b] = t.split(":").map(Number); return a * 60 + (b || 0); };
  const out: string[] = [];
  for (let m = toMin(open); m + 60 <= toMin(close); m += 60) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out.length ? out : ["09:00"];
}

export function Today() {
  const { branch, branchId, branches } = useStore();
  const [day, setDay] = useState(isoDay());
  const liveDay = useRef(isoDay());
  const [view, setView] = useState<"day" | "list">("day");
  const [newOpen, setNewOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [provF, setProvF] = useState("All dermatologists");
  const [stF, setStF] = useState("All statuses");
  const [kind, setKind] = useQueryString("kind", "");

  // Follow the clinic calendar across midnight unless staff deliberately
  // selected another day in the date control.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = isoDay();
      setDay((selected) => selected === liveDay.current ? current : selected);
      liveDay.current = current;
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  const bookingsQ = useApi(
    () => api.bookings.list({ date: day, location: branch && branch !== "All branches" ? branch : undefined }),
    [day, branch],
  );
  usePoll(bookingsQ.reload, 30000);

  const doctorsQ = useApi(() => api.doctors.list({ branch: branch !== "All branches" ? branch : undefined }), [branch]);

  const allRows = bookingsQ.data?.data ?? [];
  const rows = kind === "consultation" ? allRows.filter(isConsultationBooking) : kind === "treatment" ? allRows.filter((b) => !isConsultationBooking(b)) : allRows;
  const SLOT_TIMES = useMemo(() => slotTimesFor(branches.find((b) => b._id === branchId)?.operatingHours, day), [branches, branchId, day]);
  const providers = useMemo(() => {
    const fromDoctors = (doctorsQ.data?.data ?? []).map((d) => d.name);
    const fromBookings = rows.map((b) => bookingProvider(b)).filter((p) => p !== "Not assigned");
    return [...new Set([...fromDoctors, ...fromBookings])];
  }, [doctorsQ.data, rows]);

  const list = rows.filter((b) =>
    (!q || b.fullName.toLowerCase().includes(q.toLowerCase()) || bookingServiceName(b, "").toLowerCase().includes(q.toLowerCase())) &&
    (provF === "All dermatologists" || bookingProvider(b) === provF) &&
    (stF === "All statuses" || statusKey(b) === stF.toLowerCase().replace(/[\s-]/g, "")));

  const cellFor = (prov: string, t: string) =>
    rows.find((b) => {
      if (bookingProvider(b) !== prov) return false;
      const d = bookingSlotDate(b);
      if (!d) return false;
      const hm = clinicHM(d);
      const bucket = `${hm.slice(0, 2)}:${Number(hm.slice(3)) < 30 ? "00" : "30"}`;
      return bucket === t;
    });

  const APK: Record<string, string> = {
    confirmed: "bg-ok-bg text-ok shadow-[inset_3px_0_0_var(--color-ok)]",
    pending: "bg-warn-bg text-warn shadow-[inset_3px_0_0_var(--color-warn)]",
    inprogress: "bg-info-bg text-info shadow-[inset_3px_0_0_var(--color-info)]",
    late: "bg-err-bg text-err shadow-[inset_3px_0_0_var(--color-err)]",
    completed: "bg-sage text-ink2 shadow-[inset_3px_0_0_var(--color-border)]",
    cancelled: "bg-dis-bg text-dis line-through",
    noshow: "bg-err-bg text-err",
  };

  const count = (k: string) => rows.filter((b) => statusKey(b) === k).length;

  return (
    <Page title="Today" sub={`${fmtDateFull(day)} · ${branch || "All branches"}`}
      actions={<>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
          className="rounded-(--radius-btn) border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
        <div className="flex overflow-hidden rounded-(--radius-btn) border border-border">
          {(["day", "list"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3.5 py-2 text-[12.5px] font-bold capitalize ${view === v ? "bg-primary text-white" : "bg-surface text-ink2"}`}>{v}</button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-(--radius-btn) border border-border">
          {([["", "All"], ["consultation", "Consultations"], ["treatment", "Treatments"]] as [string, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setKind(v)}
              className={`px-3 py-2 text-[12.5px] font-bold ${kind === v ? "bg-primary text-white" : "bg-surface text-ink2"}`}>{l}</button>
          ))}
        </div>
        <Btn kind="ghost" onClick={() => window.print()}>Print list</Btn>
        <Btn kind="gold" onClick={() => setNewOpen(true)}>+ Walk-in</Btn>
      </>}>
      <Hint id="today-live" steps={[
        "This is the live appointment book for the selected centre and date — one column per dermatologist. Switch between dermatologist consultations and treatments with the toggle.",
        "Click any appointment to open it. Confirm, check in, complete, reschedule or cancel from the panel on the right.",
        "Use + Walk-in for a guest at the desk. A new mobile number opens a patient record automatically.",
        "Filter the list below by dermatologist or status during rush hour; Print list gives the floor a paper copy.",
      ]} />
      <StaleBanner error={bookingsQ.data ? bookingsQ.error : null} onRetry={bookingsQ.reload} />

      <Async q={bookingsQ} label="Loading the day book…" rows={6}>
        {() => (
          <>
            <Stats items={[
              { k: "Expected", v: count("confirmed") + count("late"), d: "confirmed, not yet in", hot: count("late") > 0 },
              { k: "In chair", v: count("inprogress"), d: "on the floor" },
              { k: "Unconfirmed", v: count("pending"), d: "needs a call", hot: count("pending") > 0 },
              { k: "Running late", v: count("late"), d: "past their slot" },
              { k: "Day total", v: rows.length, d: `${count("completed")} completed` },
              { k: "Consultations", v: allRows.filter(isConsultationBooking).length, d: `${allRows.length - allRows.filter(isConsultationBooking).length} treatments`, onClick: () => setKind(kind === "consultation" ? "" : "consultation") },
            ]} />

            {view === "day" ? (
              providers.length === 0 ? (
                <Empty title="No dermatologists to show" hint="Add dermatologists under Care → Dermatologists, or switch to the list view." />
              ) : (
                <Card className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(760, 56 + providers.length * 170) }}>
                    <div className="grid border-b border-border bg-ivory" style={{ gridTemplateColumns: `56px repeat(${providers.length},1fr)` }}>
                      <div className="p-2 text-[11.5px] font-bold">Time</div>
                      {providers.map((p) => {
                        const doc = (doctorsQ.data?.data ?? []).find((d) => d.name === p);
                        return (
                          <div key={p} className="border-l border-border p-2 text-[11.5px] font-bold">
                            {p}
                            <span className="block font-mono text-[9px] font-medium text-ink3">
                              {doc?.designation ?? (doc?.tier === "senior-consultant" ? "Senior Dermatologist" : "Dermatologist")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {SLOT_TIMES.map((t) => (
                      <div key={t} className="grid min-h-[34px] border-b border-border last:border-0" style={{ gridTemplateColumns: `56px repeat(${providers.length},1fr)` }}>
                        <div className="border-r border-border p-1.5 font-mono text-[10px] text-ink3">{t}</div>
                        {providers.map((p) => {
                          const bk = cellFor(p, t);
                          return (
                            <div key={p} className="border-l border-border p-0.5">
                              {bk && (
                                <button onClick={() => setSel(bk._id)}
                                  className={`block h-full w-full rounded px-2 py-1 text-left text-[10.5px] ${APK[statusKey(bk)] ?? "bg-dis-bg text-dis"}`}>
                                  <b className="block text-[11px] font-bold">{bk.fullName}</b>
                                  <span className="opacity-85">{bookingServiceName(bk, "").split("—")[0]}</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </Card>
              )
            ) : null}

            <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 ${view === "list" ? "print-only-list" : ""}`}>
              <SecH t="Appointments" em={`· ${list.length} on ${fmtDate(day)}`} />
              <div className="flex flex-wrap items-center gap-2">
                <Menu button={<Btn kind="ghost" className="!py-1.5 !text-[12px]">{provF} ▾</Btn>}
                  items={["All dermatologists", ...providers].map((p) => ({ label: p, onClick: () => setProvF(p) }))} />
                <Menu button={<Btn kind="ghost" className="!py-1.5 !text-[12px]">{stF} ▾</Btn>}
                  items={["All statuses", "Pending", "Confirmed", "In progress", "Late", "Completed", "Cancelled", "No show"]
                    .map((p) => ({ label: p, onClick: () => setStF(p) }))} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or service…"
                  className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
              </div>
            </div>
            {(kind
              ? ([[kind === "consultation" ? "Dermatologist consultations" : "Treatments", list]] as [string, Booking[]][])
              : ([["Dermatologist consultations", list.filter(isConsultationBooking)], ["Treatments", list.filter((b) => !isConsultationBooking(b))]] as [string, Booking[]][]))
              .map(([title, group]) => (
                <div key={title} className="mt-3">
                  {!kind && <div className="mb-1.5 flex items-baseline gap-2"><span className="text-[13px] font-extrabold">{title}</span><span className="text-[11.5px] text-ink3">{group.length}</span></div>}
                  {group.length === 0 ? <div className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-ink3">None on {fmtDate(day)}.</div> : (
                    <DataTable
                      cols={["Guest", "Service", "Dermatologist", "When", "Payment", "Status"]}
                      onRow={(i) => setSel(group[i]._id)}
                      rows={group.map((b) => [
                        <B key={b._id}>{b.fullName}</B>,
                        bookingServiceName(b),
                        b.specialistName || b.therapistName ? bookingProvider(b) : <span className="text-err">Not assigned</span>,
                        bookingSlotLabel(b),
                        b.paymentStatus === "paid" ? <Tag kind="ok">Paid</Tag> : <Tag kind="warn">{fmtINR(b.amount)}</Tag>,
                        STATUS[statusKey(b)],
                      ])}
                    />
                  )}
                </div>
              ))}
          </>
        )}
      </Async>

      <NewBookingModal open={newOpen} onClose={() => setNewOpen(false)} onBooked={bookingsQ.reload} />
      <BookingDrawer id={sel} onClose={() => setSel(null)} onChanged={bookingsQ.reload} />
    </Page>
  );
}

/* ================= BOOKINGS ================= */
const TABS: { label: string; status?: string }[] = [
  { label: "All" },
  { label: "Awaiting", status: "Awaiting Confirmation" },
  { label: "Confirmed", status: "Confirmed" },
  { label: "Reschedule requests", status: "Rescheduled" },
  { label: "In progress", status: "In Progress" },
  { label: "Completed", status: "Completed" },
  { label: "Cancelled", status: "Cancelled" },
  { label: "No-show", status: "No Show" },
];

/* ---- booking filters ---- */
type BookingFilters = {
  kind: string; startDate: string; endDate: string; createdFrom: string; createdTo: string;
  specialistId: string[]; therapistId: string[]; location: string[]; source: string[]; paymentStatus: string[]; paymentMethod: string[];
  category: string[]; type: string[]; consultationId: string[]; memberType: string; packageIncluded: string; hasRating: string;
  amountMin: string; amountMax: string; sortBy: string; sortOrder: string;
};
const EMPTY_BF: BookingFilters = {
  kind: "", startDate: "", endDate: "", createdFrom: "", createdTo: "", specialistId: [], therapistId: [], location: [], source: [],
  paymentStatus: [], paymentMethod: [], category: [], type: [], consultationId: [], memberType: "", packageIncluded: "", hasRating: "",
  amountMin: "", amountMax: "", sortBy: "date", sortOrder: "desc",
};
const BOOKING_SORTS: [string, string][] = [["date", "Appointment date"], ["createdAt", "Booked on"], ["amount", "Amount"], ["name", "Guest name"], ["status", "Status"], ["checkIn", "Check-in time"]];
const BOOKING_EXPORT_COLS = ["Reference", "Guest", "Patient ID", "Phone", "Email", "Membership", "Service", "Category", "Kind", "Centre", "Date", "Time", "Status", "Dermatologist", "Therapist", "Room",
  "Source", "Package", "Amount", "Payment Status", "Payment Method", "Paid At", "Checked In", "Checked Out", "Session Minutes", "Rating", "Cancellation Reason", "Booked On", "Notes"];

function bookingQuery(f: BookingFilters): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  (Object.keys(f) as (keyof BookingFilters)[]).forEach((k) => {
    const v = f[k];
    if (Array.isArray(v)) { if (v.length) q[k] = v.join(","); }
    else if (v !== "" && v !== undefined) q[k] = v;
  });
  return q;
}

const isoOf = (d: Date) => isoDay(d);
const startOfWeek = (d: Date) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; }; // Monday
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

export function Bookings() {
  const { branch, branches } = useStore();
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: TABS.length - 1 });
  const [sel, setSel] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useQueryString("q");
  const [scopeParam, setScope] = useQueryString("scope", "branch");
  const [viewParam, setView] = useQueryString("view", "list");
  const view: "list" | "week" | "month" = viewParam === "week" ? "week" : viewParam === "month" ? "month" : "list";
  const [anchorParam, setAnchor] = useQueryString("at", "");
  const anchor = useMemo(() => dayKeyDate(/^\d{4}-\d{2}-\d{2}$/.test(anchorParam) ? anchorParam : isoDay()), [anchorParam]);
  const scope: "branch" | "all" = scopeParam === "all" ? "all" : "branch";
  const debounced = useDebounced(search);
  const [kindParam, setKindParam] = useQueryString("kind", "");
  const [applied, setApplied] = useState<BookingFilters>({ ...EMPTY_BF, kind: kindParam });
  const [draft, setDraft] = useState<BookingFilters>({ ...EMPTY_BF, kind: kindParam });
  const set = <K extends keyof BookingFilters>(k: K, v: BookingFilters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const clear = (patch: Partial<BookingFilters>) => { const next = { ...applied, ...patch }; setApplied(next); setDraft(next); if (patch.kind !== undefined) setKindParam(patch.kind); };
  useEffect(() => { if (kindParam !== applied.kind) { setApplied((a) => ({ ...a, kind: kindParam })); setDraft((d) => ({ ...d, kind: kindParam })); } }, [kindParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const location = scope === "branch" && branch && branch !== "All branches" && !applied.location.length ? branch : undefined;
  const [page, setPage] = useQueryPage();
  const loc2 = useLocation();
  const [sp2] = useSearchParams();
  useEffect(() => {
    const st = loc2.state as { open?: string; specialistId?: string } | null;
    const open = st?.open ?? sp2.get("booking");
    if (open) setSel(open);
    // Opened from the dashboard leaderboard: pre-filter to that dermatologist.
    if (st?.specialistId) { const next = { ...EMPTY_BF, specialistId: [st.specialistId] }; setApplied(next); setDraft(next); }
  }, [loc2.state, sp2]);
  const PAGE = 15;
  useEffect(() => { setPage(1); }, [tab, location, debounced, applied, view, anchorParam]);

  // Option lists for the drawer.
  const svc = useApi(() => api.services.list({ includeInactive: "true", limit: 500 }).catch(() => ({ success: true, data: [] as Consultation[] })), []);
  const docs = useApi(() => api.doctors.list().catch(() => ({ success: true, data: [] as Doctor[] })), []);
  const practitionersQ = useApi(() => api.zenoti.practitioners().catch(() => []), []);
  const staffQ = useApi(() => api.staff.list({ limit: 200 }).catch(() => ({ success: true, data: [] })), []);
  const services = svc.data?.data ?? [];
  const categoryOpts = useMemo(() => Array.from(new Set(services.map((c) => c.category).filter(Boolean))).sort() as string[], [services]);
  const typeOpts = useMemo(() => Array.from(new Set(services.map((c) => c.type).filter(Boolean))).sort() as string[], [services]);
  const therapists = (staffQ.data?.data ?? []).filter((a) => a.role === "therapist" && a.isActive);
  const practitionerOptions = useMemo(() => {
    if (practitionersQ.data?.length) return practitionersQ.data.map((p) => [p.filterValue, `${p.name}${p.onboarded ? "" : " · Zenoti"}`] as [string, string]);
    return (docs.data?.data ?? []).map((d) => [d.doctorId, d.name] as [string, string]);
  }, [practitionersQ.data, docs.data]);

  // Calendar views pin the date range to the visible week/month.
  const calRange = useMemo(() => {
    if (view === "week") { const s = startOfWeek(anchor); return { from: isoOf(s), to: isoOf(addDays(s, 6)) }; }
    if (view === "month") { const key = isoOf(anchor); return { from: clinicMonthStart(key), to: clinicMonthEnd(key) }; }
    return null;
  }, [view, anchor]);

  const query = useMemo(() => {
    const base: Record<string, string | number | undefined> = {
      status: TABS[tab].status, location, search: debounced || undefined, ...bookingQuery(applied),
    };
    if (calRange) { base.startDate = calRange.from; base.endDate = calRange.to; base.sortBy = "date"; base.sortOrder = "asc"; base.limit = 500; base.page = 1; }
    else { base.page = page; base.limit = PAGE; }
    return base;
  }, [tab, location, debounced, applied, page, calRange]);

  const q = useApi(() => api.bookings.list(query), [JSON.stringify(query)]);

  const rows = q.data?.data ?? [];
  const counts = q.data?.statusCounts ?? {};
  const total = q.data?.total ?? rows.length;
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  const countFor = (status?: string) => (status ? counts[status] ?? 0 : totalAll);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  // Active-filter chips.
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  const docName = (id: string) => practitionerOptions.find(([value]) => value === id)?.[1]?.replace(/ · Zenoti$/, "") ?? "doctor";
  const thName = (id: string) => therapists.find((t) => String(t._id) === id)?.name ?? "therapist";
  const svcName = (id: string) => services.find((c) => c._id === id)?.name ?? "service";
  if (applied.startDate || applied.endDate) chips.push({ key: "date", label: `Appointments ${applied.startDate || "…"} → ${applied.endDate || "…"}`, onRemove: () => clear({ startDate: "", endDate: "" }) });
  if (applied.createdFrom || applied.createdTo) chips.push({ key: "created", label: `Booked ${applied.createdFrom || "…"} → ${applied.createdTo || "…"}`, onRemove: () => clear({ createdFrom: "", createdTo: "" }) });
  if (applied.location.length) chips.push({ key: "loc", label: applied.location.join(", "), onRemove: () => clear({ location: [] }) });
  if (applied.specialistId.length) chips.push({ key: "doc", label: applied.specialistId.map(docName).join(", "), onRemove: () => clear({ specialistId: [] }) });
  if (applied.therapistId.length) chips.push({ key: "th", label: applied.therapistId.map(thName).join(", "), onRemove: () => clear({ therapistId: [] }) });
  if (applied.source.length) chips.push({ key: "src", label: `Source: ${applied.source.join(", ")}`, onRemove: () => clear({ source: [] }) });
  if (applied.paymentStatus.length) chips.push({ key: "ps", label: `Payment: ${applied.paymentStatus.join(", ")}`, onRemove: () => clear({ paymentStatus: [] }) });
  if (applied.paymentMethod.length) chips.push({ key: "pm", label: applied.paymentMethod.join(", "), onRemove: () => clear({ paymentMethod: [] }) });
  if (applied.type.length) chips.push({ key: "type", label: applied.type.join(", "), onRemove: () => clear({ type: [] }) });
  if (applied.category.length) chips.push({ key: "cat", label: applied.category.join(", "), onRemove: () => clear({ category: [] }) });
  if (applied.consultationId.length) chips.push({ key: "svc", label: applied.consultationId.map(svcName).join(", "), onRemove: () => clear({ consultationId: [] }) });
  if (applied.memberType) chips.push({ key: "mt", label: applied.memberType, onRemove: () => clear({ memberType: "" }) });
  if (applied.packageIncluded) chips.push({ key: "pkg", label: applied.packageIncluded === "true" ? "Package sessions" : "Not from a package", onRemove: () => clear({ packageIncluded: "" }) });
  if (applied.hasRating) chips.push({ key: "rate", label: "Rated", onRemove: () => clear({ hasRating: "" }) });
  if (applied.amountMin || applied.amountMax) chips.push({ key: "amt", label: `₹${applied.amountMin || "0"}–${applied.amountMax || "∞"}`, onRemove: () => clear({ amountMin: "", amountMax: "" }) });

  const kindLabel = applied.kind === "consultation" ? "Dermatologist consultations" : applied.kind === "treatment" ? "Treatments" : "All services";
  const sortLabel = BOOKING_SORTS.find(([v]) => v === applied.sortBy)?.[1] ?? "Appointment date";
  const fmtAnchor = view === "week"
    ? `${fmtDayKey(isoOf(startOfWeek(anchor)), { day: "numeric", month: "short" })} – ${fmtDayKey(isoOf(addDays(startOfWeek(anchor), 6)), { day: "numeric", month: "short", year: "numeric" })}`
    : fmtDayKey(isoOf(anchor), { month: "long", year: "numeric" });
  const shift = (n: number) => {
    const d = new Date(anchor);
    if (view === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
    else d.setUTCMonth(d.getUTCMonth() + n, 1);
    setAnchor(isoOf(d));
  };

  // Group rows by day for the calendar views.
  const byDay = useMemo(() => {
    const m = new Map<string, Booking[]>();
    rows.forEach((b) => { const d = bookingSlotDate(b); if (!d) return; const k = isoOf(d); m.set(k, [...(m.get(k) ?? []), b]); });
    m.forEach((list) => list.sort((a, b) => (bookingSlotDate(a)?.getTime() ?? 0) - (bookingSlotDate(b)?.getTime() ?? 0)));
    return m;
  }, [rows]);
  const todayIso = isoOf(new Date());
  const statusTone = (b: Booking) => {
    const k = statusKey(b);
    return k === "completed" ? "border-l-ok" : k === "cancelled" || k === "noshow" ? "border-l-err" : k === "inprogress" ? "border-l-gold-dark" : k === "late" ? "border-l-err" : k === "pending" ? "border-l-ink3" : "border-l-primary";
  };

  const calendarCell = (b: Booking) => (
    <button key={b._id} onClick={() => setSel(b._id)}
      className={`w-full rounded-md border border-border border-l-[3px] bg-surface px-1.5 py-1 text-left text-[11px] leading-tight hover:shadow-md ${statusTone(b)}`}>
      <div className="flex justify-between gap-1"><span className="font-mono text-[10px] text-ink3">{(b.confirmedTime || b.preferredTimeSlots?.[0] || "").replace(/\s*-\s*.*$/, "")}</span>
        {b.isPackageIncluded && <span className="text-[9px] font-bold text-gold-dark">PKG</span>}</div>
      <div className="truncate font-semibold">{b.fullName}</div>
      <div className="truncate text-ink3">{bookingServiceName(b, "Service")}{b.specialistName ? ` · ${b.specialistName.split(" ")[0]}` : ""}</div>
    </button>
  );

  return (
    <Page title="Bookings" sub={`${location ?? "All centres"} · ${kindLabel}${calRange ? ` · ${fmtAnchor}` : ""}`}
      actions={<>
        <Menu button={<Btn kind="ghost">{scope === "branch" ? "This centre" : "All centres"} ▾</Btn>}
          items={[
            { label: "This centre", onClick: () => setScope("branch") },
            { label: "All centres", onClick: () => setScope("all") },
          ]} />
        <Menu align="right" button={<Btn kind="ghost">Sort: {sortLabel} {applied.sortOrder === "asc" ? "↑" : "↓"}</Btn>}
          items={[
            ...BOOKING_SORTS.map(([v, l]) => ({ label: `${l}${applied.sortBy === v ? " ✓" : ""}`, onClick: () => clear({ sortBy: v }) })),
            { label: applied.sortOrder === "asc" ? "Descending ↓" : "Ascending ↑", onClick: () => clear({ sortOrder: applied.sortOrder === "asc" ? "desc" : "asc" }) },
          ]} />
        <Btn kind={chips.length ? "gold" : "ghost"} onClick={() => { setDraft(applied); setDrawer(true); }}>Filters{chips.length ? ` (${chips.length})` : ""}</Btn>
        <Btn kind="ghost" disabled={!total} onClick={() => setExportOpen(true)}>Export CSV</Btn>
        <Btn onClick={() => setNewOpen(true)}>+ New booking</Btn>
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, mobile, email, reference or service…"
          className="w-full max-w-[360px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
        {/* Consultation ⇄ treatment switch */}
        <div className="flex rounded-(--radius-btn) border border-border bg-surface p-0.5">
          {([["", "All"], ["consultation", "Consultations"], ["treatment", "Treatments"]] as [string, string][]).map(([v, l]) => (
            <button key={v} onClick={() => clear({ kind: v })}
              className={`rounded-[calc(var(--radius-btn)-2px)] px-3 py-1.5 text-[12px] font-semibold ${applied.kind === v ? "bg-primary text-white" : "text-ink2 hover:bg-ivory"}`}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex rounded-(--radius-btn) border border-border bg-surface p-0.5">
            {([["list", "List"], ["week", "Week"], ["month", "Month"]] as [string, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-[calc(var(--radius-btn)-2px)] px-3 py-1.5 text-[12px] font-semibold ${view === v ? "bg-primary text-white" : "text-ink2 hover:bg-ivory"}`}>{l}</button>
            ))}
          </div>
          {calRange && (
            <div className="flex items-center gap-1">
              <Btn kind="ghost" className="!px-2" onClick={() => shift(-1)}>‹</Btn>
              <Btn kind="ghost" className="!px-2.5" onClick={() => setAnchor("")}>Today</Btn>
              <Btn kind="ghost" className="!px-2" onClick={() => shift(1)}>›</Btn>
            </div>
          )}
        </div>
      </div>
      <Tabs active={tab} onChange={setTab} items={TABS.map((t) => [t.label, countFor(t.status)])} />
      <ActiveFilters items={chips} onClear={() => clear({ ...EMPTY_BF, kind: applied.kind, sortBy: applied.sortBy, sortOrder: applied.sortOrder })} />
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />

      <Async q={q} label="Loading bookings…" rows={8}>
        {() => view === "list" ? (rows.length === 0 ? (
          <Empty title="No bookings here"
            hint={debounced || chips.length ? "Nothing matched the current search/filters." : "Nothing in this state for the selected centre."}
            action={<Btn onClick={() => setNewOpen(true)}>+ New booking</Btn>} />
        ) : (
          <DataTable
            cols={["Reference", "Guest", "Service", "Kind", "Dermatologist", "Centre", "When", "Payment", "Status", "Source"]}
            onRow={(i) => setSel(rows[i]._id)}
            rows={rows.map((b) => [
              <span key={b._id} className="font-mono text-[11px] text-ink3">{b.referenceNumber ?? "—"}</span>,
              <B key={`${b._id}n`}>{b.fullName}</B>,
              bookingServiceName(b),
              isConsultationBooking(b) ? <Tag key={`${b._id}k`} kind="gold">Consultation</Tag> : <Tag key={`${b._id}k`} kind="mute">Treatment</Tag>,
              b.specialistName || b.therapistName ? bookingProvider(b) : <span key={`${b._id}d`} className="text-err">Not assigned</span>,
              b.preferredLocation,
              bookingSlotLabel(b),
              b.paymentStatus === "paid" ? <Tag kind="ok">Paid</Tag> : <Tag kind="warn">{fmtINR(b.amount)}</Tag>,
              STATUS[statusKey(b)],
              <Tag kind="mute">{bookingSource(b)}</Tag>,
            ])}
          />
        )) : view === "week" ? (
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)).map((d) => {
              const k = isoOf(d); const list = byDay.get(k) ?? [];
              return (
                <div key={k} className={`min-h-[320px] rounded-lg border p-1.5 ${k === todayIso ? "border-gold bg-gold/5" : "border-border bg-ivory/60"}`}>
                  <div className="mb-1.5 flex items-baseline justify-between px-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink3">{fmtDayKey(k, { weekday: "short" })}</span>
                    <span className={`text-[13px] font-bold ${k === todayIso ? "text-gold-dark" : ""}`}>{d.getUTCDate()}</span>
                  </div>
                  <div className="flex flex-col gap-1">{list.map(calendarCell)}</div>
                  {list.length === 0 && <div className="px-0.5 text-[10.5px] text-ink3">—</div>}
                </div>
              );
            })}
          </div>
        ) : (
          (() => {
            const first = dayKeyDate(clinicMonthStart(isoOf(anchor)));
            const gridStart = startOfWeek(first);
            const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
            return (
              <div>
                <div className="grid grid-cols-7 gap-1 px-0.5 text-[10.5px] font-bold uppercase tracking-wider text-ink3">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-1 py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d) => {
                    const k = isoOf(d); const list = byDay.get(k) ?? []; const inMonth = d.getUTCMonth() === anchor.getUTCMonth();
                    return (
                      <div key={k} className={`min-h-[96px] rounded-lg border p-1 ${k === todayIso ? "border-gold bg-gold/5" : "border-border"} ${inMonth ? "bg-surface" : "bg-ivory/40 opacity-60"}`}>
                        <div className="flex items-center justify-between px-0.5">
                          <span className={`text-[11.5px] font-bold ${k === todayIso ? "text-gold-dark" : ""}`}>{d.getUTCDate()}</span>
                          {list.length > 0 && (
                            <button onClick={() => { setView("week"); setAnchor(k); }} className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{list.length}</button>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {list.slice(0, 3).map((b) => (
                            <button key={b._id} onClick={() => setSel(b._id)} className={`truncate rounded border-l-2 bg-ivory px-1 text-left text-[10px] leading-4 ${statusTone(b)}`}>
                              {(b.confirmedTime || b.preferredTimeSlots?.[0] || "").replace(/\s*-\s*.*$/, "")} {b.fullName}
                            </button>
                          ))}
                          {list.length > 3 && <button onClick={() => { setView("week"); setAnchor(k); }} className="px-1 text-left text-[10px] text-ink3">+{list.length - 3} more</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()
        )}
      </Async>
      {view === "list" && pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[12px] text-ink3">
          <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
          <span>Page {page} of {pages} · {total} bookings</span>
          <Btn kind="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn>
        </div>
      )}
      {calRange && total > rows.length && <Note kind="crit" className="mt-2">Showing the first {rows.length} of {total} appointments in this range — narrow the filters to see them all.</Note>}

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} title="Filter bookings" activeCount={chips.length}
        onApply={() => setApplied(draft)} onReset={() => setDraft({ ...EMPTY_BF, kind: draft.kind, sortBy: draft.sortBy, sortOrder: draft.sortOrder })}>
        <FSection title="Service kind">
          <Chips options={[["", "All"], ["consultation", "Dermatologist consultations"], ["treatment", "Treatments"]]} value={draft.kind} onChange={(v) => set("kind", v as string)} />
        </FSection>
        <FSection title="Appointment date" hint={calRange ? "The Week/Month view pins this to the visible range." : undefined}>
          <DateRange from={draft.startDate} to={draft.endDate} onChange={(a, b) => setDraft((d) => ({ ...d, startDate: a, endDate: b }))} />
          <div className="mb-1 mt-3 text-[11px] font-bold text-ink2">Booked on</div>
          <DateRange from={draft.createdFrom} to={draft.createdTo} onChange={(a, b) => setDraft((d) => ({ ...d, createdFrom: a, createdTo: b }))} />
        </FSection>
        <FSection title="Centre">
          <Chips multi options={branches.map((b) => [b.name, b.name] as [string, string])} value={draft.location} onChange={(v) => set("location", v as string[])} />
        </FSection>
        <FSection title="Dermatologist">
          <MultiSelect options={practitionerOptions} value={draft.specialistId} onChange={(v) => set("specialistId", v)} placeholder="Select dermatologists…" searchPlaceholder="Search app and Zenoti dermatologists…" />
        </FSection>
        {therapists.length > 0 && (
          <FSection title="Therapist">
            <Chips multi options={therapists.map((t) => [String(t._id), t.name] as [string, string])} value={draft.therapistId} onChange={(v) => set("therapistId", v as string[])} />
          </FSection>
        )}
        <FSection title="Service">
          {typeOpts.length > 0 && <Chips multi options={typeOpts.map((c) => [c, c] as [string, string])} value={draft.type} onChange={(v) => set("type", v as string[])} />}
          {categoryOpts.length > 0 && <div className="mt-2"><Chips multi options={categoryOpts.map((c) => [c, c] as [string, string])} value={draft.category} onChange={(v) => set("category", v as string[])} /></div>}
          <MultiSelect className="mt-2" options={services.map((c) => [c._id, c.name])} value={draft.consultationId}
            onChange={(v) => set("consultationId", v)} placeholder="Select services…" searchPlaceholder="Search services…" />
        </FSection>
        <FSection title="Source & guest">
          <Chips multi options={[["app", "App"], ["reception", "Reception"], ["package", "Package"], ["zenoti", "Zenoti"]]} value={draft.source} onChange={(v) => set("source", v as string[])} />
          <div className="mt-2"><Chips options={[["", "Any guest"], ["Zen Member", "Zen members"], ["Regular Member", "Regular"]]} value={draft.memberType} onChange={(v) => set("memberType", v as string)} /></div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chips options={[["true", "Package sessions"], ["false", "Not from a package"]]} value={draft.packageIncluded} onChange={(v) => set("packageIncluded", v as string)} />
            <Chips options={[["true", "Rated"]]} value={draft.hasRating} onChange={(v) => set("hasRating", v as string)} />
          </div>
        </FSection>
        <FSection title="Payment">
          <Chips multi options={[["paid", "Paid"], ["pending", "Pending"], ["failed", "Failed"], ["refunded", "Refunded"]]} value={draft.paymentStatus} onChange={(v) => set("paymentStatus", v as string[])} />
          <div className="mt-2"><Chips multi options={[["Razorpay", "Razorpay"], ["Cash", "Cash"], ["Card", "Card"], ["UPI", "UPI"], ["Package", "Package"], ["Membership", "Membership"], ["Other", "Other"]]} value={draft.paymentMethod} onChange={(v) => set("paymentMethod", v as string[])} /></div>
          <div className="mt-2"><NumRange prefix="₹" min={draft.amountMin} max={draft.amountMax} onChange={(a, b) => setDraft((d) => ({ ...d, amountMin: a, amountMax: b }))} /></div>
        </FSection>
        <FSection title="Sort">
          <Chips options={BOOKING_SORTS} value={draft.sortBy} onChange={(v) => set("sortBy", (v as string) || "date")} />
          <div className="mt-2"><Chips options={[["desc", "Latest first"], ["asc", "Earliest first"]]} value={draft.sortOrder} onChange={(v) => set("sortOrder", (v as string) || "desc")} /></div>
        </FSection>
      </FilterDrawer>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} columns={BOOKING_EXPORT_COLS} filename="zennara-bookings"
        summary={`${total.toLocaleString("en-IN")} booking${total === 1 ? "" : "s"} match the current tab, search and filters.`}
        fetchRows={(fields) => api.bookings.export({ ...query, page: undefined, limit: 20000, fields: fields.join(",") })} />

      <NewBookingModal open={newOpen} onClose={() => setNewOpen(false)} onBooked={() => q.reload()} />
      <BookingDrawer id={sel} onClose={() => setSel(null)} onChanged={() => q.reload()} />
    </Page>
  );
}

/* ================= PATIENTS ================= */
/* ---- patient filters ---- */
type PatientFilters = {
  source: string; memberType: string; zen: string; location: string[]; gender: string[];
  ageMin: string; ageMax: string; joinedFrom: string; joinedTo: string;
  lastLoginFrom: string; lastLoginTo: string; lastVisitFrom: string; lastVisitTo: string; noVisitSince: string;
  visitsMin: string; visitsMax: string; spendMin: string; spendMax: string;
  flags: string[]; isActive: string; verified: string;
  kind: string; consultationId: string[]; category: string[]; specialistId: string[];
  sortBy: string; sortOrder: string;
};
const EMPTY_PF: PatientFilters = {
  source: "", memberType: "", zen: "", location: [], gender: [], ageMin: "", ageMax: "", joinedFrom: "", joinedTo: "",
  lastLoginFrom: "", lastLoginTo: "", lastVisitFrom: "", lastVisitTo: "", noVisitSince: "", visitsMin: "", visitsMax: "",
  spendMin: "", spendMax: "", flags: [], isActive: "", verified: "", kind: "", consultationId: [], category: [], specialistId: [],
  sortBy: "createdAt", sortOrder: "desc",
};
const PATIENT_SORTS: [string, string][] = [
  ["createdAt", "Joined"], ["name", "Name"], ["visits", "Visits"], ["spend", "Spend"], ["lastLogin", "Last login"], ["dob", "Age"], ["zenExpiry", "Zen expiry"],
];
const PATIENT_EXPORT_COLS = ["Patient ID", "Full Name", "Email", "Phone", "Centre", "Source", "Member Type", "Zen Since", "Zen Expires", "Gender", "Date of Birth", "Age",
  "Total Visits", "Total Spent", "App Opens", "Drug Allergies", "Medical History", "Smoking", "Drinking", "Active", "Verified", "Registered On", "Last Login"];

/** Turn the filter state into query params; blanks are dropped. */
function patientQuery(f: PatientFilters): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  (Object.keys(f) as (keyof PatientFilters)[]).forEach((k) => {
    const v = f[k];
    if (Array.isArray(v)) { if (v.length) q[k] = v.join(","); }
    else if (v !== "" && v !== undefined) q[k] = v;
  });
  return q;
}

export function Patients() {
  const nav = useNavigate();
  const { toast, branch, branches } = useStore();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [applied, setApplied] = useState<PatientFilters>(EMPTY_PF);
  const [draft, setDraft] = useState<PatientFilters>(EMPTY_PF);
  const debounced = useDebounced(search);
  const set = <K extends keyof PatientFilters>(k: K, v: PatientFilters[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Option lists for the drawer.
  const svc = useApi(() => api.services.list({ includeInactive: "true", limit: 500 }).catch(() => ({ success: true, data: [] as Consultation[] })), []);
  const docs = useApi(() => api.doctors.list().catch(() => ({ success: true, data: [] as Doctor[] })), []);
  const practitionersQ = useApi(() => api.zenoti.practitioners().catch(() => []), []);
  const services = svc.data?.data ?? [];
  const categoryOpts = useMemo(() => Array.from(new Set(services.map((c) => c.category).filter(Boolean))).sort() as string[], [services]);
  const practitionerOptions = useMemo(() => {
    if (practitionersQ.data?.length) return practitionersQ.data.map((p) => [p.filterValue, `${p.name}${p.onboarded ? "" : " · Zenoti"}`] as [string, string]);
    return (docs.data?.data ?? []).map((d) => [d.doctorId, d.name] as [string, string]);
  }, [practitionersQ.data, docs.data]);

  const query = useMemo(() => {
    const base: Record<string, string | number> = { page, limit: 15, ...patientQuery(applied) };
    if (debounced) base.search = debounced;
    // The global centre switch scopes the list unless the drawer picked centres explicitly.
    if (!applied.location.length && branch && branch !== "All branches") base.location = branch;
    return base;
  }, [page, debounced, applied, branch]);

  const q = useApi(() => api.patients.list(query), [JSON.stringify(query)]);
  useEffect(() => { setPage(1); }, [debounced, applied, branch]);

  const users = q.data?.data?.users ?? [];
  const pagination = q.data?.data?.pagination;
  const stats = q.data?.data?.statistics ?? {};

  // Active-filter chips (sort is shown separately).
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  const clear = (patch: Partial<PatientFilters>) => { const next = { ...applied, ...patch }; setApplied(next); setDraft(next); };
  const svcName = (id: string) => services.find((c) => c._id === id)?.name ?? "service";
  const docName = (id: string) => practitionerOptions.find(([value]) => value === id)?.[1]?.replace(/ · Zenoti$/, "") ?? "doctor";
  if (applied.source) chips.push({ key: "source", label: applied.source === "zenoti" ? "Zennara clinic" : applied.source === "reception" ? "Walk-ins" : "App sign-ups", onRemove: () => clear({ source: "" }) });
  if (applied.memberType) chips.push({ key: "mt", label: applied.memberType, onRemove: () => clear({ memberType: "" }) });
  if (applied.zen) chips.push({ key: "zen", label: `Zen: ${applied.zen}`, onRemove: () => clear({ zen: "" }) });
  if (applied.location.length) chips.push({ key: "loc", label: applied.location.join(", "), onRemove: () => clear({ location: [] }) });
  if (applied.gender.length) chips.push({ key: "g", label: applied.gender.join("/"), onRemove: () => clear({ gender: [] }) });
  if (applied.ageMin || applied.ageMax) chips.push({ key: "age", label: `Age ${applied.ageMin || "0"}–${applied.ageMax || "∞"}`, onRemove: () => clear({ ageMin: "", ageMax: "" }) });
  if (applied.joinedFrom || applied.joinedTo) chips.push({ key: "joined", label: `Joined ${applied.joinedFrom || "…"} → ${applied.joinedTo || "…"}`, onRemove: () => clear({ joinedFrom: "", joinedTo: "" }) });
  if (applied.lastLoginFrom || applied.lastLoginTo) chips.push({ key: "login", label: `Last login ${applied.lastLoginFrom || "…"} → ${applied.lastLoginTo || "…"}`, onRemove: () => clear({ lastLoginFrom: "", lastLoginTo: "" }) });
  if (applied.lastVisitFrom || applied.lastVisitTo) chips.push({ key: "visit", label: `Visited ${applied.lastVisitFrom || "…"} → ${applied.lastVisitTo || "…"}`, onRemove: () => clear({ lastVisitFrom: "", lastVisitTo: "" }) });
  if (applied.noVisitSince) chips.push({ key: "lapsed", label: `No visit since ${applied.noVisitSince}`, onRemove: () => clear({ noVisitSince: "" }) });
  if (applied.visitsMin || applied.visitsMax) chips.push({ key: "visits", label: `Visits ${applied.visitsMin || "0"}–${applied.visitsMax || "∞"}`, onRemove: () => clear({ visitsMin: "", visitsMax: "" }) });
  if (applied.spendMin || applied.spendMax) chips.push({ key: "spend", label: `Spend ₹${applied.spendMin || "0"}–${applied.spendMax || "∞"}`, onRemove: () => clear({ spendMin: "", spendMax: "" }) });
  if (applied.flags.length) chips.push({ key: "flags", label: `Flags: ${applied.flags.join(", ")}`, onRemove: () => clear({ flags: [] }) });
  if (applied.isActive) chips.push({ key: "active", label: applied.isActive === "true" ? "Active accounts" : "Deactivated", onRemove: () => clear({ isActive: "" }) });
  if (applied.verified) chips.push({ key: "ver", label: applied.verified === "true" ? "Verified" : "Unverified", onRemove: () => clear({ verified: "" }) });
  if (applied.kind) chips.push({ key: "kind", label: applied.kind === "consultation" ? "Had a consultation" : "Had a treatment", onRemove: () => clear({ kind: "" }) });
  if (applied.consultationId.length) chips.push({ key: "svc", label: applied.consultationId.map(svcName).join(", "), onRemove: () => clear({ consultationId: [] }) });
  if (applied.category.length) chips.push({ key: "cat", label: applied.category.join(", "), onRemove: () => clear({ category: [] }) });
  if (applied.specialistId.length) chips.push({ key: "doc", label: `Seen ${applied.specialistId.map(docName).join(", ")}`, onRemove: () => clear({ specialistId: [] }) });

  const sortLabel = PATIENT_SORTS.find(([v]) => v === applied.sortBy)?.[1] ?? "Joined";
  const total = pagination?.totalUsers ?? 0;

  return (
    <Page title="Patients" sub={`${(stats.totalPatients ?? total).toLocaleString("en-IN")} on file${stats.clinicCustomers ? ` · ${Number(stats.clinicCustomers).toLocaleString("en-IN")} from the Zennara clinic` : ""}`}
      actions={<>
        <Menu align="right" button={<Btn kind="ghost">Sort: {sortLabel} {applied.sortOrder === "asc" ? "↑" : "↓"}</Btn>}
          items={[
            ...PATIENT_SORTS.map(([v, l]) => ({ label: `${l}${applied.sortBy === v ? " ✓" : ""}`, onClick: () => clear({ sortBy: v }) })),
            { label: applied.sortOrder === "asc" ? "Descending ↓" : "Ascending ↑", onClick: () => clear({ sortOrder: applied.sortOrder === "asc" ? "desc" : "asc" }) },
          ]} />
        <Btn kind={chips.length ? "gold" : "ghost"} onClick={() => { setDraft(applied); setDrawer(true); }}>
          Filters{chips.length ? ` (${chips.length})` : ""}
        </Btn>
        <Btn kind="ghost" disabled={!total} onClick={() => setExportOpen(true)}>Export CSV</Btn>
        <Btn onClick={() => setNewOpen(true)}>+ New patient</Btn>
      </>}>
      <Hint id="patients-live">Click any row to open the full record — visits, packages, forms, orders and consents. Use Filters to slice by centre, age, membership, visits, spend, treatments had, or lapsed guests; Export honours the same filters.</Hint>

      <div className="mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, email or patient ID…"
          className="w-full max-w-[420px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
      </div>
      <ActiveFilters items={chips} onClear={() => clear({ ...EMPTY_PF, sortBy: applied.sortBy, sortOrder: applied.sortOrder })} />
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />

      <Async q={q} label="Loading patients…" rows={8}>
        {() => users.length === 0 ? (
          <Empty title="No patients here" hint={debounced || chips.length ? "Nothing matched the current search/filters." : "Add the first patient to get started."}
            action={chips.length ? <Btn kind="ghost" onClick={() => clear(EMPTY_PF)}>Clear filters</Btn> : <Btn onClick={() => setNewOpen(true)}>+ New patient</Btn>} />
        ) : (
          <>
            <DataTable
              cols={["Patient", "Patient ID", "Phone", "Centre", "Source", "Joined", "Visits", "Spend", "Membership", "Flags"]}
              onRow={(i) => nav("/patient", { state: { id: users[i]._id } })}
              rows={users.map((p) => {
                const flags = patientFlags(p);
                const age = ageFrom(p.dateOfBirth);
                return [
                  <B key={p._id}>{p.fullName}{age ? ` · ${age}${(p.gender ?? "")[0] ?? ""}` : ""}</B>,
                  <span key={`${p._id}i`} className="font-mono text-[11px] text-ink3">{p.patientId ?? "—"}</span>,
                  p.phone,
                  p.location ?? "—",
                  p.source === "zenoti" ? <Tag key={`${p._id}src`} kind="info">Clinic</Tag> : p.source === "reception" ? <Tag key={`${p._id}src`} kind="gold">Walk-in</Tag> : <Tag key={`${p._id}src`} kind="mute">App</Tag>,
                  fmtDate(p.createdAt),
                  p.totalVisits ?? 0,
                  fmtINR(p.totalSpent),
                  isVip(p) ? <Tag kind="gold">Zen Member{p.zenMembershipExpiryDate ? ` · ${fmtDate(p.zenMembershipExpiryDate)}` : ""}</Tag> : <Tag kind="mute">Regular</Tag>,
                  flags.length ? <Tag kind={/allerg/i.test(flags[0]) ? "err" : "warn"}>{flags[0]}</Tag> : "—",
                ];
              })}
            />
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink3">
                <span>Page {pagination.currentPage} of {pagination.totalPages} · {pagination.totalUsers.toLocaleString("en-IN")} patients</span>
                <div className="flex gap-2">
                  <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Btn>
                  <Btn kind="ghost" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Async>

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} title="Filter patients" activeCount={chips.length}
        onApply={() => setApplied(draft)} onReset={() => { setDraft({ ...EMPTY_PF, sortBy: draft.sortBy, sortOrder: draft.sortOrder }); }}>
        <FSection title="Source">
          <Chips options={[["", "All"], ["app", "App sign-ups"], ["reception", "Walk-ins"], ["zenoti", "Zennara clinic"]]} value={draft.source} onChange={(v) => set("source", v as string)} />
        </FSection>
        <FSection title="Membership">
          <Chips options={[["", "Any"], ["Zen Member", "Zen members"], ["Regular Member", "Regular"]]} value={draft.memberType} onChange={(v) => set("memberType", v as string)} />
          <div className="mt-2">
            <Chips options={[["active", "Zen active"], ["expiring", "Expiring in 30 days"], ["expired", "Zen expired"], ["none", "Never Zen"]]} value={draft.zen} onChange={(v) => set("zen", v as string)} />
          </div>
        </FSection>
        <FSection title="Centre">
          <Chips multi options={branches.map((b) => [b.name, b.name] as [string, string])} value={draft.location} onChange={(v) => set("location", v as string[])} />
        </FSection>
        <FSection title="Gender & age">
          <Chips multi options={[["Female", "Female"], ["Male", "Male"], ["Other", "Other"]]} value={draft.gender} onChange={(v) => set("gender", v as string[])} />
          <div className="mt-2"><NumRange min={draft.ageMin} max={draft.ageMax} onChange={(a, b) => setDraft((d) => ({ ...d, ageMin: a, ageMax: b }))} placeholder={["Min age", "Max age"]} /></div>
        </FSection>
        <FSection title="Timeline" hint="Visits come from completed appointments (app and clinic).">
          <div className="mb-1 text-[11px] font-bold text-ink2">Joined</div>
          <DateRange from={draft.joinedFrom} to={draft.joinedTo} onChange={(a, b) => setDraft((d) => ({ ...d, joinedFrom: a, joinedTo: b }))} />
          <div className="mb-1 mt-3 text-[11px] font-bold text-ink2">Last visit between</div>
          <DateRange from={draft.lastVisitFrom} to={draft.lastVisitTo} onChange={(a, b) => setDraft((d) => ({ ...d, lastVisitFrom: a, lastVisitTo: b }))} />
          <div className="mb-1 mt-3 text-[11px] font-bold text-ink2">Lapsed — no visit since</div>
          <input type="date" value={draft.noVisitSince} onChange={(e) => set("noVisitSince", e.target.value)}
            className="w-full rounded-lg border border-border bg-ivory px-2.5 py-1.5 text-[12px] outline-none focus:border-gold-dark" />
          <div className="mb-1 mt-3 text-[11px] font-bold text-ink2">Last app login</div>
          <DateRange from={draft.lastLoginFrom} to={draft.lastLoginTo} onChange={(a, b) => setDraft((d) => ({ ...d, lastLoginFrom: a, lastLoginTo: b }))} />
        </FSection>
        <FSection title="Activity">
          <div className="mb-1 text-[11px] font-bold text-ink2">Visits</div>
          <NumRange min={draft.visitsMin} max={draft.visitsMax} onChange={(a, b) => setDraft((d) => ({ ...d, visitsMin: a, visitsMax: b }))} />
          <div className="mb-1 mt-2 text-[11px] font-bold text-ink2">Lifetime spend</div>
          <NumRange prefix="₹" min={draft.spendMin} max={draft.spendMax} onChange={(a, b) => setDraft((d) => ({ ...d, spendMin: a, spendMax: b }))} />
        </FSection>
        <FSection title="Treatments" hint="Patients who have had…">
          <Chips options={[["", "Anything"], ["consultation", "A dermatologist consultation"], ["treatment", "A treatment"]]} value={draft.kind} onChange={(v) => set("kind", v as string)} />
          {categoryOpts.length > 0 && <div className="mt-2"><Chips multi options={categoryOpts.map((c) => [c, c] as [string, string])} value={draft.category} onChange={(v) => set("category", v as string[])} /></div>}
          <MultiSelect className="mt-2" options={services.map((c) => [c._id, c.name])} value={draft.consultationId}
            onChange={(v) => set("consultationId", v)} placeholder="Select treatments…" searchPlaceholder="Search treatments…" />
          <div className="mt-2 text-[11px] font-bold text-ink2">Seen by</div>
          <MultiSelect options={practitionerOptions} value={draft.specialistId} onChange={(v) => set("specialistId", v)} placeholder="Select dermatologists…" searchPlaceholder="Search app and Zenoti dermatologists…" />
        </FSection>
        <FSection title="Flags & account">
          <Chips multi options={[["allergies", "Drug allergies"], ["medical", "Medical history"], ["smoking", "Smokes"], ["drinking", "Drinks"], ["inactive", "Deactivated"]]} value={draft.flags} onChange={(v) => set("flags", v as string[])} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chips options={[["true", "Active"], ["false", "Deactivated"]]} value={draft.isActive} onChange={(v) => set("isActive", v as string)} />
            <Chips options={[["true", "Verified"], ["false", "Unverified"]]} value={draft.verified} onChange={(v) => set("verified", v as string)} />
          </div>
        </FSection>
        <FSection title="Sort">
          <Chips options={PATIENT_SORTS} value={draft.sortBy} onChange={(v) => set("sortBy", (v as string) || "createdAt")} />
          <div className="mt-2"><Chips options={[["desc", "Newest / highest first"], ["asc", "Oldest / lowest first"]]} value={draft.sortOrder} onChange={(v) => set("sortOrder", (v as string) || "desc")} /></div>
        </FSection>
      </FilterDrawer>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} columns={PATIENT_EXPORT_COLS} filename="zennara-patients"
        summary={`${total.toLocaleString("en-IN")} patient${total === 1 ? "" : "s"} match the current search and filters.`}
        fetchRows={(fields) => api.patients.exportAll({ ...query, page: undefined as unknown as string, limit: 20000, fields: fields.join(",") })} />

      <NewPatientModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { q.reload(); nav("/patient", { state: { id } }); }} />
    </Page>
  );
}

function NewPatientModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  const { toast, branch, branches } = useStore();
  const [f, setF] = useState({ fullName: "", phone: "", email: "", dateOfBirth: "", gender: "Female", location: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF({ fullName: "", phone: "", email: "", dateOfBirth: "", gender: "Female",
      location: branch && branch !== "All branches" ? branch : branches[0]?.name ?? "" });
    setErr(null);
  }, [open, branch, branches.length]);

  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (f.fullName.trim().length < 2) return setErr("Enter the patient's full name");
    if (f.phone.replace(/\D/g, "").length < 10) return setErr("Enter a valid mobile number");
    if (!f.email.trim()) return setErr("An email is required — it is the login for the app");
    if (!f.dateOfBirth) return setErr("Date of birth is required");
    if (!f.location?.trim()) return setErr("A home centre is required — add a branch first if the list is empty");
    setBusy(true);
    try {
      const user = await api.patients.create({
        fullName: f.fullName.trim(), phone: f.phone.trim(), email: f.email.trim().toLowerCase(),
        dateOfBirth: f.dateOfBirth, gender: f.gender, location: f.location,
      });
      toast(`${f.fullName.trim()} created`);
      onCreated(user._id);
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New patient" wide>
      <div className="grid gap-3 md:grid-cols-2">
        <In label="Full name" value={f.fullName} onChange={set("fullName")} />
        <In label="Mobile" value={f.phone} onChange={set("phone")} placeholder="+91 …" />
        <In label="Email" type="email" value={f.email} onChange={set("email")} placeholder="name@email.com"
          hint="This is the address they sign into the app with." />
        <In label="Date of birth" type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} />
        <Sel label="Gender" value={f.gender} onChange={set("gender")} options={["Male", "Female", "Other"]} />
        <Sel label="Home centre" value={f.location} onChange={set("location")} options={branches.map((b) => b.name)} />
      </div>
      <Note>A patient ID is generated automatically. If this email or number is already on file the server will say so rather than creating a duplicate.</Note>
      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create patient"}</Btn>
      </div>
    </Modal>
  );
}

/* ================= PATIENT DETAIL ================= */
export function PatientDetail() {
  const loc = useLocation();
  const nav = useNavigate();
  const { toast, audit, role } = useStore();
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: 3 });
  const [bookOpen, setBookOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selBooking, setSelBooking] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [sp, setSp] = useSearchParams();
  // Opened from the list (router state) or from a notification / link (?id=).
  const routeState = loc.state as { id?: string; returnTo?: string } | null;
  const id = (routeState?.id ?? sp.get("id") ?? "") as string;
  // Router state does not survive a reload, so mirror the id into the query
  // string the moment we have it — every entry point becomes reload-safe
  // without each caller having to remember to build the URL.
  useEffect(() => {
    if (!id || sp.get("id") === id) return;
    const next = new URLSearchParams(sp);
    next.set("id", id);
    setSp(next, { replace: true });
  }, [id, sp, setSp]);
  const patientListPath = routeState?.returnTo || (role === "doctor" ? "/doctor/my-patients" : "/patients");

  const q = useApi(async () => {
    if (!id) throw new Error("No patient selected — open one from the Patients list.");
    const [user, bookings, assignments, orders, forms, consents, cards, clinicalNotes] = await Promise.all([
      api.patients.get(id),
      // Every list is scoped server-side to this guest; the client filter is a belt-and-braces guard.
      api.bookings.list({ userId: id }).then((r) => (r.data ?? []).filter((b) => idOf(b.userId) === id)),
      api.packageAssignments.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((a) => idOf(a.userId) === id)).catch(() => []),
      // Retail purchases are the clinic's business, not the consult room's.
      Promise.resolve([] as ProductOrder[]),
      api.preConsult.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((f) => idOf(f.userId) === id)).catch(() => []),
      api.consentForms.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((c) => idOf(c.userId) === id)).catch(() => []),
      api.serviceCards.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((c) => idOf(c.userId) === id)).catch(() => []),
      api.consultationNotes.list({ userId: id, limit: 200 }).then((r) => (r.data ?? []).filter((n) => idOf(n.userId) === id)).catch(() => []),
    ]);
    return { user, bookings, assignments, orders, forms, consents, cards, clinicalNotes };
  }, [id]);

  // Clinic (Zenoti) history — mirrored locally, refreshed when stale. Loaded
  // separately so a slow CRM never holds up the rest of the record.
  const clinic = useApi(() => (id ? api.zenoti.user(id).catch(() => null) : Promise.resolve(null)), [id]);
  const [clinicBusy, setClinicBusy] = useState(false);
  const refreshClinic = async () => {
    setClinicBusy(true);
    try { await api.zenoti.syncUser(id); clinic.reload(); q.reload(); toast("Clinic history refreshed from Zenoti"); }
    catch (e) { toast((e as Error).message); }
    finally { setClinicBusy(false); }
  };

  return (
    <Async q={q} label="Loading patient record…" rows={8}>
      {({ user: p, bookings, assignments, orders, forms, consents, cards, clinicalNotes }) => {
        const flags = patientFlags(p);
        const age = ageFrom(p.dateOfBirth);
        const activePkg = assignments.filter((a) => a.status === "Active");
        const zd = clinic.data?.details ?? null;
        const zAppts = zd?.appointments ?? [];
        const operationalZenotiIds = new Set(bookings.map((b) => b.zenotiAppointmentId).filter(Boolean));
        // The appointment reconciler now creates first-class Bookings. Keep
        // older/unmatched mirror rows as a fallback, but never show the same
        // Zenoti visit twice in the patient timeline.
        const zOnlyAppts = zAppts.filter((a) => !a.id || !operationalZenotiIds.has(a.id));
        const zOrders = zd?.orders ?? [];
        const zPkgs = zd?.packages ?? [];
        const zMems = zd?.memberships ?? [];
        const zNotes = zd?.notes ?? [];
        const zForms = zd?.forms ?? [];
        const zProfile = zd?.profile ?? null;
        const zHasActiveMembership = zMems.some(membershipActive);
        const zLinked = !!clinic.data?.linked;

        // Rows the Records tab will actually draw.
        const recordCount = forms.length + clinicalNotes.length
          + cards.reduce((n, c) => n + (c.services?.length ?? 0), 0)
          + zNotes.length + zForms.length;

        const tabBody = [
          /* timeline */
          bookings.length === 0 && zOnlyAppts.length === 0
            ? <Empty key="t" title="No activity yet" hint="Bookings and visits appear here as they happen." />
            : <DataTable key="t" cols={["Date", "Event", "Dermatologist / channel", "Value"]}
                onRow={(i) => { const b = bookings[i]; if (b) setSelBooking(b._id); }}
                rows={[
                  ...bookings.map((b) => [
                    fmtWhen(b.confirmedDate || b.preferredDate, b.confirmedTime),
                    <span key={b._id}>{bookingServiceName(b, "Service")} — {STATUS[statusKey(b)]}</span>,
                    bookingProvider(b),
                    b.paymentStatus === "paid" ? fmtINR(b.amount) : `${fmtINR(b.amount)} due`,
                  ]),
                  ...zOnlyAppts.map((a, i) => {
                    const state = appointmentState(a);
                    return [
                      fmtZWhen(a.startTime),
                      <span key={`za${i}`}>{a.serviceName ?? "Treatment"} — {state.label} <Tag kind="info">Clinic</Tag></span>,
                      `${a.therapistName ?? "—"}${a.centerName ? ` · ${a.centerName}` : ""}`,
                      money(a.price),
                    ];
                  }),
                ]} />,

          /* clinical records */
          recordCount === 0
            ? <Empty key="r" title="No clinical records" hint="Pre-consult forms, consultation notes and service cards appear here as they are written." />
            : <DataTable key="r" cols={["Date", "Record", "Dermatologist", "Status"]} rows={[
                ...forms.map((f) => [
                  fmtDate(f.dateOfVisit || f.createdAt),
                  "Pre-consult form",
                  f.doctorName ?? "—",
                  <Tag key={f._id} kind={f.status === "Approved" || f.status === "Reviewed" ? "ok" : f.status === "Rejected" ? "err" : "warn"}>{f.status}</Tag>,
                ]),
                ...cards.flatMap((c) => c.services.map((s) => [
                  fmtDate(s.date),
                  `${s.service}${s.grading ? ` · grade ${s.grading}` : ""}`,
                  s.doctorName ?? c.primaryDoctor,
                  s.therapist ? <Tag key={`${c._id}${s.serialNumber}`} kind="info">{s.therapist}</Tag> : <Tag key={`${c._id}${s.serialNumber}b`} kind="ok">Logged</Tag>,
                ])),
                ...clinicalNotes.map((n) => [
                  fmtDate(n.completedAt || n.updatedAt || n.createdAt),
                  <span key={n._id} className="block max-w-[520px] whitespace-normal">
                    {n.assessment || n.complaint || "Consultation note"}
                    {!!n.prescription?.length && ` · Prescription: ${n.prescription.map((p) => p.medicine).join(", ")}`}
                    {!!n.assignedServices?.length && (
                      <span className="mt-0.5 block text-[11px] text-secondary">
                        Assigned: {n.assignedServices.map((a) => `${a.name}${(a.sessions ?? 1) > 1 ? ` ×${a.sessions}` : ""}`).join(", ")}
                      </span>
                    )}
                  </span>,
                  n.doctorName ?? "—",
                  <span key={`${n._id}-status`} className="flex flex-wrap gap-1">
                    <Tag kind={n.status === "Completed" ? "ok" : "warn"}>{n.status}</Tag>
                    {n.zenotiSyncStatus && <Tag kind={n.zenotiSyncStatus === "synced" ? "info" : n.zenotiSyncStatus === "failed" ? "err" : "mute"}>Zenoti {n.zenotiSyncStatus}</Tag>}
                  </span>,
                ]),
                ...zForms.map((f, i) => [
                  fmtZDate(f.lastFilledAt),
                  <span key={`zf${i}`}>{f.name ?? "Guest form"} <Tag kind="info">Clinic</Tag></span>,
                  f.lastFilledBy ?? "—",
                  f.isExpired ? <Tag key={`zfs${i}`} kind="err">Expired</Tag> : String(f.status) === "2" ? <Tag key={`zfs${i}`} kind="ok">Submitted</Tag> : <Tag key={`zfs${i}`} kind="warn">Not submitted</Tag>,
                ]),
                ...zNotes.map((n, i) => [
                  fmtZDate(n.createdAt),
                  <span key={`zn${i}`} className="block max-w-[520px] whitespace-normal">{n.text || "Clinic note"} <Tag kind="info">Clinic</Tag></span>,
                  n.createdBy ?? "—",
                  n.isProfileAlert ? <Tag key={`zns${i}`} kind="warn">Profile alert</Tag> : <Tag key={`zns${i}`} kind="ok">Note</Tag>,
                ]),
              ]} />,

          /* packages */
          <div key="p">
            {assignments.length === 0 && zPkgs.length === 0 ? (
              <Empty title="No packages assigned" hint="Packages are assigned by the clinic admin." />
            ) : assignments.length === 0 ? null : (
              <>
                {assignments.map((a) => {
                  const used = a.usageTracking?.usedSessions ?? 0;
                  const total = a.usageTracking?.totalSessions ?? 0;
                  return (
                    <Card key={a._id} className="mb-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <b className="text-[14px] font-bold">{a.packageDetails?.packageName ?? nameOf(a.packageId, "Package")}</b>
                          <div className="text-[11.5px] text-ink3">
                            {used} of {total} sessions used
                            {a.validUntil ? ` · valid till ${fmtDate(a.validUntil)}` : ""}
                            {" · "}{fmtINR(a.pricing?.finalAmount)}
                          </div>
                        </div>
                        <Tag kind={a.status === "Active" ? "ok" : a.status === "Cancelled" ? "err" : "mute"}>{a.status}</Tag>
                      </div>
                      {total > 0 && <div className="mt-2"><Prog pct={Math.round((used / total) * 100)} w="w-full" /></div>}
                      {a.zenotiSyncStatus && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink3">
                          <Tag kind={a.zenotiSyncStatus === "synced" ? "ok" : a.zenotiSyncStatus === "failed" ? "err" : "warn"}>
                            Zenoti {a.zenotiSyncStatus}
                          </Tag>
                          {a.zenotiSyncError && <span>{a.zenotiSyncError}</span>}
                        </div>
                      )}
                      {(a.sessions?.length ?? 0) > 0 && (
                        <div className="mt-3 border-t border-border pt-2.5">
                          {a.preferredLocation && <div className="mb-1.5 text-[11px] text-ink3">Scheduled at {a.preferredLocation}</div>}
                          <div className="flex flex-col gap-1">
                            {(a.sessions ?? []).map((s, i) => (
                              <div key={s._id ?? i} className="flex items-center justify-between gap-2 text-[12px]">
                                <span className="min-w-0 flex-1 truncate">
                                  {s.serviceName || "Treatment"}
                                  {s.specialistName && <span className="text-ink3"> · {s.specialistName}</span>}
                                </span>
                                <span className="text-ink2">
                                  {s.scheduledDate ? fmtDate(s.scheduledDate) : "—"}{s.scheduledTime ? ` · ${s.scheduledTime}` : ""}
                                </span>
                                <Tag kind={s.status === "Booked" ? "info" : s.status === "Completed" ? "ok" : s.status === "Cancelled" ? "err" : "mute"}>
                                  {s.status === "Booked" ? "Appointment created" : s.status ?? "Scheduled"}
                                </Tag>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {a.payment?.isReceived === false && <Note kind="crit" className="mb-0">Payment not yet received.</Note>}
                    </Card>
                  );
                })}
              </>
            )}
            {zPkgs.length > 0 && (
              <div className="mt-4">
                <SecH t="Zennara clinic packages" em={`${zPkgs.length}`} />
                <div className="grid gap-3">
                  {[...zPkgs].sort((a, b) => Number(pkgActive(b)) - Number(pkgActive(a))).map((k, i) => <ZenotiPackageCard key={k.id ?? i} k={k} />)}
                </div>
              </div>
            )}
          </div>,

          /* consents */
          consents.length === 0
            ? <Empty key="c" title="No consent forms on file" hint="Treatment consents signed in the app appear here." />
            : <DataTable key="c" cols={["Procedure", "Dermatologist", "Signed", "Status"]} rows={consents.map((c) => [
                c.treatmentProcedure, c.doctorName, fmtDateFull(c.consentDate || c.createdAt),
                <Tag key={c._id} kind={c.status === "Approved" || c.status === "Signed" ? "ok" : "warn"}>{c.status}</Tag>,
              ])} />,
        ];

        return (
          <Page title={p.fullName}
            sub={[
              age ? `${age} ${p.gender ?? ""}`.trim() : p.gender,
              p.phone, p.location, p.patientId ? `ID ${p.patientId}` : "",
              `${p.totalVisits ?? 0} visits`,
              p.source === "zenoti" ? "Clinic customer" : "App sign-up",
              zd?.syncedAt ? `clinic data ${fmtAgo(zd.syncedAt)}` : "",
            ].filter(Boolean).join(" · ")}
            actions={<>
              <Btn kind="ghost" onClick={() => setEditOpen(true)}>Edit</Btn>
              <Btn kind="ghost" onClick={() => nav(patientListPath)}>← All patients</Btn>
              {zLinked && (
                <Btn kind="ghost" disabled={clinicBusy} onClick={refreshClinic}>
                  {clinicBusy ? "Refreshing…" : "Refresh from Zenoti"}
                </Btn>
              )}
              <Btn onClick={() => setBookOpen(true)}>Book</Btn>
            </>}>
            <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <Tabs active={tab} onChange={setTab} items={[
                  // Counts are derived from exactly what each tab renders —
                  // zAppts double-counted visits already mirrored as bookings,
                  // and a service card with no services inflated Records.
                  ["Timeline", bookings.length + zOnlyAppts.length],
                  ["Records", recordCount],
                  ["Packages", assignments.length + zPkgs.length],
                  ["Consents", consents.length],
                ]} />
                {tabBody[tab] ?? tabBody[0]}
              </div>
              <div className="grid gap-3">
                {zLinked && zd && (
                  <Card className="p-4"><SecH t="Zennara clinic history" right={<Tag kind="info">Clinic</Tag>} />
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Treatments</div><B>{zd.stats?.treatmentsDone ?? 0}</B></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Upcoming</div><B>{zd.stats?.upcoming ?? 0}</B></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Sessions left</div><B>{zd.stats?.sessionsLeft ?? 0}</B></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Lifetime spend</div><B>{money(zd.stats?.lifetimeSpend)}</B></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Last visit</div><B>{fmtZDate(zd.stats?.lastVisit)}</B></div>
                      <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Next visit</div><B>{fmtZDate(zd.stats?.nextVisit)}</B></div>
                    </div>
                    {zd.lastError && <Note kind="crit" className="mb-0 mt-2">Last sync had errors: {zd.lastError}</Note>}
                  </Card>
                )}
                {zMems.length > 0 && (
                  <div className="grid gap-2">
                    <SecH t="Zennara clinic memberships" em={`${zMems.length}`} />
                    {zMems.map((m, i) => <ZenotiMembershipCard key={m.id ?? i} m={m} />)}
                  </div>
                )}
                {zProfile && (
                  <Card className="p-4"><SecH t="Clinic profile" right={<Tag kind="info">Zenoti</Tag>} />
                    <div className="grid gap-1.5 text-[12px] text-ink2">
                      {zProfile.code && <div>Guest code <B>{zProfile.code}</B></div>}
                      {zProfile.preferredName && <div>Preferred name <B>{zProfile.preferredName}</B></div>}
                      {zProfile.memberSince && <div>Clinic customer since <B>{fmtZDate(zProfile.memberSince)}</B></div>}
                      {zProfile.address && (zProfile.address.line1 || zProfile.address.city) && <div>Address <B>{[zProfile.address.line1, zProfile.address.city, zProfile.address.zip].filter(Boolean).join(", ")}</B></div>}
                      {(zProfile.isOnlineBookingBlocked || zProfile.isClassBookingBlocked || zProfile.isBlockedForNoShow) && (
                        <Note kind="crit" className="mb-0 mt-1">Booking restriction is active in Zenoti.</Note>
                      )}
                    </div>
                  </Card>
                )}
                {flags.length > 0 && (
                  <Card className="p-4"><SecH t="Alerts" />
                    {flags.map((f) => <Note key={f} kind="crit" className="my-0 mb-2 last:mb-0"><B>{f}</B></Note>)}
                  </Card>
                )}
                <Card className="p-4">
                  <SecH t="Zen membership" right={isVip(p) ? <Tag kind="gold">Active</Tag> : <Tag kind="mute">None</Tag>} />
                  {isVip(p) ? (() => {
                    const exp = p.zenMembershipExpiryDate ? new Date(p.zenMembershipExpiryDate) : null;
                    const daysLeft = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;
                    const src = p.zenMembershipSource === "zenoti" || zHasActiveMembership ? "Zennara clinic (Zenoti)" : p.zenMembershipSource === "admin" ? "Clinic desk" : p.zenMembershipSource === "app" ? "App" : "—";
                    const rows: [string, React.ReactNode][] = [
                      ["Plan", p.zenMembershipPlan || "Zen Membership"],
                      ["Source", src],
                      ["Since", p.zenMembershipStartDate ? fmtDateFull(p.zenMembershipStartDate) : "—"],
                      [p.zenMembershipAutoRenew ? "Renews on" : "Expires on", exp ? <span>{fmtDateFull(exp)} <span className={`text-[10.5px] ${daysLeft !== null && daysLeft <= 30 ? "text-err" : "text-ink3"}`}>({daysLeft !== null ? (daysLeft < 0 ? "expired" : `${daysLeft}d left`) : ""})</span></span> : "No expiry recorded"],
                      ["Auto-renew", p.zenMembershipAutoRenew ? "Yes" : "No"],
                      ["Payment", p.zenMembershipPaymentMethod ? <span>{p.zenMembershipPaymentMethod}{p.zenMembershipAmount ? ` · ${fmtINR(p.zenMembershipAmount)}` : ""} {p.zenMembershipPaymentStatus === "pending" ? <Tag kind="warn">due</Tag> : p.zenMembershipPaymentStatus === "paid" ? <Tag kind="ok">paid</Tag> : null}</span> : "—"],
                    ];
                    if (p.zenMembershipGrantedBy) rows.push(["Granted by", p.zenMembershipGrantedBy]);
                    return (
                      <>
                        <div className="grid gap-1">{rows.map(([k, v]) => <Row key={k} k={k} v={v} />)}</div>
                        {p.zenotiMembershipSyncStatus && p.zenotiMembershipSyncStatus !== "synced" && (
                          <div className="mt-2 text-[11px] text-ink3"><Tag kind={p.zenotiMembershipSyncStatus === "failed" ? "err" : "warn"}>Zenoti {p.zenotiMembershipSyncStatus}</Tag> {p.zenotiMembershipSyncError}</div>
                        )}
                        <div className="mt-2 text-[11px] text-ink3">Granting, extending and payments are managed by the clinic admin.</div>
                      </>
                    );
                  })() : (
                    <div className="text-[12px] text-ink3">
                      Regular member{p.zenMembershipExpiryDate ? ` · previous membership ended ${fmtDateFull(p.zenMembershipExpiryDate)}` : ""}.
                      <span className="block text-[11px]">Memberships are granted by the clinic admin.</span>
                    </div>
                  )}
                </Card>
                <Card className="p-4"><SecH t="Spend" />
                  <div className="grid gap-2 text-[12.5px]">
                    <Row k="Lifetime spend" v={fmtINR(p.totalSpent)} />
                    <Row k="Visits" v={String(p.totalVisits ?? 0)} />
                    <Row k="Active packages" v={String(activePkg.length)} />
                    <Row k="App opens" v={String(p.appOpenCount ?? 0)} />
                  </div>
                </Card>
                <Card className="p-4"><SecH t="Account" />
                  <div className="text-[12px] leading-relaxed text-ink2">
                    {p.email?.endsWith("@zennara.local") ? "Walk-in record — no app login yet" : p.email}<br />
                    Joined {fmtDateFull(p.createdAt)}<br />
                    {p.lastLogin ? `Last app login ${fmtAgo(p.lastLogin)} ago` : "Never signed into the app"}
                  </div>
                  <div className="mt-2 text-[11px] text-ink3">Account access is managed by the clinic admin.</div>
                </Card>
              </div>
            </div>

            <NewBookingModal open={bookOpen} onClose={() => setBookOpen(false)} onBooked={q.reload} presetUser={p} />
            <EditPatientModal open={editOpen} onClose={() => setEditOpen(false)} user={p} onSaved={q.reload} />
            <BookingDrawer id={selBooking} onClose={() => setSelBooking(null)} onChanged={q.reload} />
          </Page>
        );
      }}
    </Async>
  );
}

function EditPatientModal({ open, onClose, user, onSaved }: {
  open: boolean; onClose: () => void; user: User; onSaved: () => void;
}) {
  const { toast, branches } = useStore();
  const [f, setF] = useState(user);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(user); setErr(null); } }, [open, user._id]);
  const set = (k: keyof User) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${user.fullName}`} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <In label="Full name" value={f.fullName ?? ""} onChange={set("fullName")} />
        <In label="Mobile" value={f.phone ?? ""} onChange={set("phone")} />
        <In label="Email" value={f.email ?? ""} onChange={set("email")} />
        <In label="Date of birth" type="date" value={(f.dateOfBirth ?? "").slice(0, 10)} onChange={set("dateOfBirth")} />
        <Sel label="Gender" value={f.gender ?? ""} onChange={set("gender")}
          options={["Male", "Female", "Other"]} />
        <Sel label="Home centre" value={f.location ?? ""} onChange={set("location")} options={branches.map((b) => b.name)} />
      </div>
      <div className="mt-3 grid gap-3">
        <Area label="Drug allergies (shows as a red alert on the record)" value={f.drugAllergies ?? ""} onChange={set("drugAllergies")} rows={2} />
        <Area label="Medical history" value={f.medicalHistory ?? ""} onChange={set("medicalHistory")} rows={2} />
      </div>
      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await api.patients.update(user._id, {
              fullName: f.fullName, phone: f.phone, email: f.email, dateOfBirth: f.dateOfBirth,
              gender: f.gender, location: f.location, drugAllergies: f.drugAllergies, medicalHistory: f.medicalHistory,
            });
            toast("Patient updated"); onSaved(); onClose();
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : "Save changes"}</Btn>
      </div>
    </Modal>
  );
}

/** "2:30 PM" from a datetime-local value ("2026-08-15T14:30"), read in the
 * clinic's own timezone — so the label the guest later sees matches what the
 * receptionist typed, independent of the server's timezone. */
function slotLabelFromLocal(dt: string): string {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { timeZone: CLINIC_TZ, hour: "numeric", minute: "2-digit", hour12: true });
}

type DraftSession = { serviceId: string; serviceName: string; dt: string };

/* ---- record what was actually charged for an existing membership ---- */
function RecordMembershipPaymentModal({ open, onClose, user, onDone }: {
  open: boolean; onClose: () => void; user: User; onDone: () => void;
}) {
  const { toast, audit } = useStore();
  const app = useApi(() => api.appStudio.get().catch(() => null), []);
  const suggested = Number((app.data as { membership?: { priceInr?: number } } | null)?.membership?.priceInr) || 110000;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Paid at clinic");
  const [txn, setTxn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = user.zenMembershipPaymentStatus === "pending";
  useEffect(() => { if (open) { setAmount(String(Number(user.zenMembershipAmount) > 0 ? user.zenMembershipAmount : suggested)); setMethod(user.zenMembershipPaymentMethod || "Paid at clinic"); setTxn(""); setErr(null); } }, [open, suggested, user.zenMembershipAmount, user.zenMembershipPaymentMethod]);
  const amt = Number(amount);

  return (
    <Modal open={open} onClose={onClose} title={pending ? "Mark membership as paid" : "Record membership payment"}>
      <Note>Enter what the guest was actually charged — this is what revenue reports will show. The suggested figure is only the current list price.</Note>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <In label="Amount charged (₹)" type="number" value={amount} onChange={setAmount} hint={`List price ${fmtINR(suggested)}`} />
        <Sel label="Payment method" value={method} onChange={setMethod} options={MEMBERSHIP_METHODS} />
        <In label="Receipt / transaction no." value={txn} onChange={setTxn} hint={method === "Cash" ? "Optional for cash" : "Required unless paid in cash"} full />
      </div>
      {err && <Note kind="crit" className="mt-2">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="gold" disabled={busy || !(amt >= 0 && amount !== "") || (method !== "Cash" && method !== "Complimentary" && !txn.trim())} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await api.patients.markMembershipPaid(user._id, { amount: amt, paymentMethod: method, transactionId: txn.trim() || undefined });
            audit("USER_ACTIVATED", `Recorded ${fmtINR(amt)} membership payment for ${user.fullName} · ${method}`, { userId: user._id });
            toast("Membership payment recorded");
            onDone();
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>Save payment</Btn>
      </div>
    </Modal>
  );
}

/* ---- grant / extend Zen membership from the desk ---- */
const MEMBERSHIP_METHODS = ["Paid at clinic", "Cash", "Card", "UPI", "Bank Transfer", "Pay at clinic", "Razorpay", "Complimentary"];
function GrantMembershipModal({ open, onClose, user, onDone }: { open: boolean; onClose: () => void; user: User; onDone: () => void }) {
  const { toast, audit } = useStore();
  const app = useApi(() => api.appStudio.get().catch(() => null), []);
  const yearly = Number((app.data as { membership?: { priceInr?: number; durationMonths?: number } } | null)?.membership?.priceInr) || 110000;
  const [months, setMonths] = useState(12);
  const [customMonths, setCustomMonths] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Paid at clinic");
  const [startDate, setStartDate] = useState(isoDay());
  const [autoRenew, setAutoRenew] = useState(false);
  const [notes, setNotes] = useState("");
  const [txn, setTxn] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = customMonths ? Math.max(1, Math.min(60, parseInt(customMonths, 10) || 0)) : months;
  const suggested = Math.round((yearly / 12) * m);
  const extending = isVip(user) && !!user.zenMembershipExpiryDate && new Date(user.zenMembershipExpiryDate) > new Date();
  useEffect(() => { if (open) { setReview(false); setErr(null); setMonths(12); setCustomMonths(""); setAmount(""); setMethod("Paid at clinic"); setStartDate(isoDay()); setAutoRenew(false); setNotes(""); setTxn(""); } }, [open]);
  useEffect(() => { setAmount(String(suggested)); }, [suggested]);
  const amt = Number(amount);
  const fromDate = extending ? new Date(user.zenMembershipExpiryDate as string) : new Date(startDate || isoDay());
  const until = new Date(fromDate); until.setMonth(until.getMonth() + m);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.patients.assignMembership(user._id, {
        months: m, paymentMethod: method, amount: method === "Complimentary" ? 0 : amt,
        paymentReceived: method !== "Pay at clinic", startDate: extending ? undefined : startDate, autoRenew, notes: notes || undefined, transactionId: txn || undefined,
      });
      audit("USER_ACTIVATED", `${extending ? "Extended" : "Granted"} Zen membership ${m}m · ${method} · ₹${method === "Complimentary" ? 0 : amt} for ${user.fullName}`, { userId: user._id });
      toast(`Zen membership ${extending ? "extended" : "granted"} until ${fmtDateFull(until)}`);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={extending ? "Extend Zen membership" : "Grant Zen membership"} wide>
      {!review ? (
        <>
          <div className="mb-1 text-[11px] font-bold text-ink2">Duration</div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" onClick={() => { setMonths(n); setCustomMonths(""); }}
                className={`h-9 min-w-[44px] rounded-lg border px-2 text-[12.5px] font-semibold ${!customMonths && months === n ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink2 hover:border-gold-dark"}`}>{n}{n === 1 ? " mo" : ""}</button>
            ))}
            <input type="number" min={1} max={60} value={customMonths} onChange={(e) => setCustomMonths(e.target.value)} placeholder="Custom"
              className={`h-9 w-24 rounded-lg border px-2 text-[12.5px] outline-none focus:border-gold-dark ${customMonths ? "border-primary" : "border-border bg-ivory"}`} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Sel label="Payment method" value={method} onChange={setMethod} options={MEMBERSHIP_METHODS} />
            <In label={`Amount (₹) · suggested ${fmtINR(suggested)} for ${m} month${m === 1 ? "" : "s"}`} type="number" value={method === "Complimentary" ? "0" : amount} onChange={setAmount} readOnly={method === "Complimentary"} />
            {!extending && <In label="Starts on" type="date" value={startDate} onChange={setStartDate} />}
            <In label={method !== "Pay at clinic" && method !== "Complimentary" && method !== "Cash" ? "Transaction / receipt no. (required)" : "Transaction / receipt no."} value={txn} onChange={setTxn}
              hint={method !== "Pay at clinic" && method !== "Complimentary" && method !== "Cash" ? "Required when a payment is recorded" : undefined} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> Auto-renew at expiry</label>
          <div className="mt-2"><Area label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="e.g. Paid at Jubilee Hills desk, receipt 1234" /></div>
          {method === "Pay at clinic" && <Note className="mb-0 mt-2">The membership starts now and shows as <B>payment due</B> until you mark it paid at the desk.</Note>}
          {err && <Note kind="crit" className="mt-2">{err}</Note>}
          <div className="mt-4 flex justify-end gap-2">
            <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
            <Btn disabled={m < 1 || (method !== "Complimentary" && !(amt >= 0 && amount !== "")) || (method !== "Pay at clinic" && method !== "Complimentary" && method !== "Cash" && !txn.trim())} onClick={() => { setErr(null); setReview(true); }}>Review →</Btn>
          </div>
        </>
      ) : (
        <>
          <Note kind="gold" className="mb-3">Please verify before granting — this changes what the guest sees in the app immediately.</Note>
          <div className="grid gap-1">
            <Row k="Guest" v={`${user.fullName} · ${user.phone}`} />
            <Row k={extending ? "Extends from" : "Starts"} v={fmtDateFull(fromDate)} />
            <Row k="Duration" v={`${m} month${m === 1 ? "" : "s"}`} />
            <Row k={autoRenew ? "Renews on" : "Expires on"} v={fmtDateFull(until)} />
            <Row k="Payment" v={`${method}${method === "Complimentary" ? "" : ` · ${fmtINR(amt)}`}${method === "Pay at clinic" ? " (due at the desk)" : ""}`} />
            {txn && <Row k="Reference" v={txn} />}
          </div>
          {err && <Note kind="crit" className="mt-2">{err}</Note>}
          <div className="mt-4 flex justify-end gap-2">
            <Btn kind="ghost" onClick={() => setReview(false)}>← Back</Btn>
            <Btn kind="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : extending ? "Extend membership" : "Grant membership"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}


/** Search-and-pick a patient (used where an action needs a guest first, e.g. assigning a package). */
export function PatientPickerModal({ open, onClose, onPick, title = "Choose a patient" }: { open: boolean; onClose: () => void; onPick: (u: User) => void; title?: string }) {
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term);
  const q = useApi(() => (open && debounced.length >= 2 ? api.patients.list({ search: debounced, limit: 12 }) : Promise.resolve(undefined)), [open, debounced]);
  const rows = q.data?.data?.users ?? [];
  useEffect(() => { if (open) setTerm(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type a name, phone, email or patient ID…"
        className="w-full rounded-lg border border-border bg-ivory px-3 py-2 text-[13px] outline-none focus:border-gold-dark" />
      <div className="mt-2 max-h-[320px] overflow-y-auto">
        {debounced.length < 2 ? <div className="px-1 py-3 text-[12px] text-ink3">Start typing to search the patient list (app sign-ups and Zennara clinic customers).</div>
          : q.loading && !q.data ? <div className="p-3"><Spinner /></div>
          : rows.length === 0 ? <div className="px-1 py-3 text-[12px] text-ink3">No patients match “{debounced}”.</div>
          : rows.map((u) => (
            <button key={u._id} onClick={() => onPick(u)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-ivory">
              <span><B>{u.fullName}</B><span className="ml-2 text-[11.5px] text-ink3">{u.phone} · {u.location ?? "—"}</span></span>
              {isVip(u) ? <Tag kind="gold">Zen</Tag> : <Tag kind="mute">{u.source === "zenoti" ? "Clinic" : "App"}</Tag>}
            </button>
          ))}
      </div>
    </Modal>
  );
}

/* ================= CONSULTATIONS ================= */
export function Consultations() {
  const nav = useNavigate();
  const { branch } = useStore();
  const [days, setDays] = useState(30);

  const window = useMemo(() => {
    const end = new Date(); const start = new Date();
    start.setDate(end.getDate() - days);
    return { startDate: isoDay(start), endDate: isoDay(end) };
  }, [days]);

  const q = useApi(async () => {
    const [bookingsRes, appts, svc, forms] = await Promise.all([
      api.bookings.list({ location: branch && branch !== "All branches" ? branch : undefined }),
      api.analytics.appointments(window),
      api.analytics.services(window),
      api.preConsult.list({ limit: 200 }).catch(() => ({ data: [] })),
    ]);
    return { bookings: bookingsRes.data ?? [], appts, svc, forms: forms.data ?? [] };
  }, [branch, window.startDate, window.endDate]);

  return (
    <Page title="Consultations" sub={`Dermatologist sessions · last ${days} days · ${branch || "all centres"}`}
      actions={
        <Menu button={<Btn kind="ghost">Last {days} days ▾</Btn>}
          items={[7, 30, 90].map((d) => ({ label: `Last ${d} days`, onClick: () => setDays(d) }))} />
      }>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading consultations…" rows={6}>
        {({ bookings, appts, svc, forms }) => {
          const cutoff = new Date(window.startDate).getTime();
          const inRange = bookings.filter((b) => new Date(b.preferredDate).getTime() >= cutoff);
          const completed = inRange.filter((b) => b.status === "Completed");
          const withForm = new Set(forms.map((f) => idOf(f.bookingId)).filter(Boolean));
          const avgDuration = completed.filter((b) => b.sessionDuration).length
            ? Math.round(completed.reduce((n, b) => n + (b.sessionDuration ?? 0), 0) / completed.filter((b) => b.sessionDuration).length)
            : null;

          const recent = [...inRange]
            // eventAt folds confirmed/preferred date and the time of day into one instant;
            // the fallback only matters for a response from an older backend.
            .sort((a, b) => new Date(b.eventAt ?? b.confirmedDate ?? b.preferredDate).getTime()
              - new Date(a.eventAt ?? a.confirmedDate ?? a.preferredDate).getTime())
            .slice(0, 60);

          return (
            <>
              <Stats items={[
                { k: "Consultations", v: inRange.length, d: `${appts.overview.totalBookings} bookings all-in` },
                { k: "Completed", v: completed.length, d: pct(appts.overview.conversionRate) + " conversion", tone: "up" },
                { k: "No-shows", v: inRange.filter((b) => b.status === "No Show").length, d: pct(appts.overview.noShowRate), tone: "dn" },
                { k: "Avg duration", v: avgDuration ? `${avgDuration} min` : "—", d: "checked-in to checked-out" },
                { k: "Pre-consult forms", v: withForm.size, d: `${inRange.length ? Math.round((withForm.size / inRange.length) * 100) : 0}% of visits` },
                { k: "Revenue", v: fmtCompactINR(svc.summary?.totalRevenue), d: `${svc.summary?.activeServices ?? 0} active services` },
              ]} />

              {recent.length === 0 ? (
                <Empty title="No consultations in this window" />
              ) : (
                <DataTable cols={["Date", "Guest", "Dermatologist", "Service", "Form", "Outcome", "Value"]}
                  onRow={(i) => nav("/patient", { state: { id: idOf(recent[i].userId) } })}
                  rows={recent.map((b) => [
                    bookingSlotLabel(b),
                    <B key={b._id}>{b.fullName}</B>,
                    bookingProvider(b),
                    bookingServiceName(b),
                    withForm.has(b._id) ? <Tag key={`${b._id}f`} kind="ok">Filled</Tag> : <Tag key={`${b._id}f`} kind="mute">—</Tag>,
                    STATUS[statusKey(b)],
                    b.paymentStatus === "paid" ? fmtINR(b.amount) : `${fmtINR(b.amount)} due`,
                  ])} />
              )}
            </>
          );
        }}
      </Async>
    </Page>
  );
}

/* ================= CHAT ================= */
const chatFileSize = (bytes = 0) => bytes < 1024
  ? `${bytes} B`
  : bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function Chat() {
  const nav = useNavigate();
  const { toast, branchId, branches, branch, admin } = useStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"active" | "closed">("active");
  const [live, setLive] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [assignOpen, setAssignOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSent = useRef(false);
  const typingTimer = useRef<number | null>(null);

  // "All branches" means every centre's threads, merged — not silently the first one.
  const targetBranches = branchId ? [branchId] : branches.map((b) => b._id);
  const targetKey = targetBranches.join(",");

  const threads = useApi(
    async () => {
      if (!targetBranches.length) return { success: true, data: [] as ChatThread[] };
      const parts = await Promise.all(targetBranches.map((b) => api.chat.byBranch(b, { status, limit: 100 }).catch(() => ({ success: false, data: [] as ChatThread[] }))));
      const merged = parts.flatMap((p) => p.data ?? []);
      merged.sort((a, b) => new Date(b.lastMessageTime ?? 0).getTime() - new Date(a.lastMessageTime ?? 0).getTime());
      return { success: true, data: merged };
    },
    [targetKey, status],
  );
  // Sockets carry the updates; the poll is only the safety net when they drop.
  usePoll(threads.reload, live ? 60000 : 15000, targetBranches.length > 0);

  const list = threads.data?.data ?? [];
  useEffect(() => {
    if (!activeId && list.length) setActiveId(list[0]._id);
    if (activeId && !list.some((c) => c._id === activeId)) setActiveId(list[0]?._id ?? null);
  }, [list.length]);

  const messages = useApi(
    () => (activeId
      ? api.chat.messages(activeId, { limit: 100 })
      : Promise.resolve({ success: true, data: [] as ChatMessage[] })),
    [activeId],
  );
  usePoll(messages.reload, live ? 30000 : 6000, !!activeId);
  // Local, socket-fed copy of the transcript so new messages land without a round trip.
  const [liveMsgs, setLiveMsgs] = useState<ChatMessage[]>([]);
  useEffect(() => { setLiveMsgs(messages.data?.data ?? []); }, [messages.data]);

  const staffQ = useApi(() => api.staff.list({ limit: 200 }), []);
  const staffList = (staffQ.data?.data ?? []).filter((a) => a.isActive);

  const cur = list.find((c) => c._id === activeId);
  const msgs = useMemo(() => {
    const seen = new Set<string>();
    // The endpoint pages newest-first; the transcript reads oldest-first.
    return liveMsgs.filter((m) => (seen.has(m._id) ? false : (seen.add(m._id), true)))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [liveMsgs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs.length, activeId, typing[activeId ?? ""]]);

  /* ---- socket wiring ---- */
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onConnect = () => {
      setLive(true);
      targetBranches.forEach((b) => s.emit("joinBranch", b));
      if (activeId) s.emit("joinChat", activeId);
    };
    const onDisconnect = () => setLive(false);
    const onUpdate = (_u: ChatUpdate) => threads.reload();
    const onPresence = (p: PresenceEvent) => setPresence((prev) => ({ ...prev, [p.chatId]: p.online }));
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("chatUpdate", onUpdate);
    s.on("userPresenceChanged", onPresence);
    if (s.connected) onConnect();
    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("chatUpdate", onUpdate);
      s.off("userPresenceChanged", onPresence);
      targetBranches.forEach((b) => s.emit("leaveBranch", b));
    };
  }, [targetKey]);

  useEffect(() => {
    const s = getSocket();
    if (!s || !activeId) return;
    const chatId = activeId;
    s.emit("joinChat", chatId);
    const onNew = (m: ChatMessage) => {
      if (String(m.chatId) !== chatId) return;
      setLiveMsgs((prev) => (prev.some((x) => x._id === m._id) ? prev : [...prev, m]));
      setTyping((t) => ({ ...t, [chatId]: "" }));
      if (m.senderModel === "User") s.emit("markAsRead", { chatId });
    };
    const onTyping = (t: TypingEvent) => { if (t.chatId === chatId && t.userType === "user") setTyping((p) => ({ ...p, [chatId]: t.userName || "Guest" })); };
    const onStop = (t: TypingEvent) => { if (t.chatId === chatId) setTyping((p) => ({ ...p, [chatId]: "" })); };
    const onRead = (d: { chatId: string }) => {
      if (d.chatId === chatId) setLiveMsgs((prev) => prev.map((m) => (m.senderModel === "Admin" ? { ...m, isRead: true } : m)));
    };
    const onDeleted = (d: DeletedEvent) => setLiveMsgs((prev) => prev.filter((m) => m._id !== d.messageId));
    const onClosed = (d: { chatId: string }) => { if (d.chatId === chatId) threads.reload(); };
    s.on("newMessage", onNew);
    s.on("userTyping", onTyping);
    s.on("userStoppedTyping", onStop);
    s.on("messagesRead", onRead);
    s.on("messageDeleted", onDeleted);
    s.on("chatClosed", onClosed);
    return () => {
      s.off("newMessage", onNew);
      s.off("userTyping", onTyping);
      s.off("userStoppedTyping", onStop);
      s.off("messagesRead", onRead);
      s.off("messageDeleted", onDeleted);
      s.off("chatClosed", onClosed);
      s.emit("leaveChat", chatId);
    };
  }, [activeId]);

  useEffect(() => {
    if (activeId && cur?.unreadCount) {
      const s = getSocket();
      if (s?.connected) s.emit("markAsRead", { chatId: activeId });
      api.chat.markRead(activeId).then(threads.reload).catch(() => undefined);
    }
  }, [activeId, cur?.unreadCount]);

  const onDraft = (value: string) => {
    setMsg(value);
    const s = getSocket();
    if (!s?.connected || !activeId) return;
    if (!typingSent.current && value.trim()) { s.emit("typing", { chatId: activeId }); typingSent.current = true; }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      s.emit("stopTyping", { chatId: activeId });
      typingSent.current = false;
    }, 1500);
  };

  const send = async () => {
    const text = msg.trim();
    const file = selectedFile;
    if ((!text && !file) || !activeId) return;
    setSending(true);
    try {
      const s = getSocket();
      if (s?.connected) { s.emit("stopTyping", { chatId: activeId }); typingSent.current = false; }
      // REST is the source of truth; the server fans the message out to the socket rooms.
      const res = file
        ? await api.chat.sendAttachment(activeId, file, text)
        : await api.chat.send(activeId, text);
      if (res?._id) setLiveMsgs((prev) => (prev.some((x) => x._id === res._id) ? prev : [...prev, res]));
      setMsg("");
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      threads.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast("File is too large. Maximum size is 15 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setSelectedFile(file);
  };

  const remove = async (m: ChatMessage) => {
    if (!window.confirm("Delete this message for everyone?")) return;
    try {
      await api.chat.deleteMessage(m._id);
      setLiveMsgs((prev) => prev.filter((x) => x._id !== m._id));
    } catch (e) { toast((e as Error).message); }
  };

  const assign = async (adminId: string | null) => {
    if (!cur) return;
    try {
      await api.chat.assign(cur._id, adminId);
      toast(adminId ? "Conversation assigned" : "Assignment cleared");
      setAssignOpen(false);
      threads.reload();
    } catch (e) { toast((e as Error).message); }
  };

  const assignedName = cur?.assignedAdmin && typeof cur.assignedAdmin === "object" ? cur.assignedAdmin.name : null;
  const myId = admin?._id ? String(admin._id) : "";

  if (!targetBranches.length) {
    return (
      <Page title="Chat" sub="Routed to the centre that owns the guest's care">
        <Empty title="No centres configured" hint="Chat threads are grouped by centre. Add one under Organisation → Branches."
          action={<Btn onClick={() => nav("/branches")}>Open branches</Btn>} />
      </Page>
    );
  }

  return (
    <Page title="Chat"
      sub={`${branchId ? branch : "All centres"} · ${list.length} conversation${list.length === 1 ? "" : "s"} · ${live ? "live" : "polling"}`}
      actions={
        <Menu button={<Btn kind="ghost">{status === "active" ? "Open" : "Closed"} ▾</Btn>}
          items={[
            { label: "Open", onClick: () => setStatus("active") },
            { label: "Closed", onClick: () => setStatus("closed") },
          ]} />
      }>
      <StaleBanner error={threads.data ? threads.error : null} onRetry={threads.reload} />
      <Async q={threads} label="Loading conversations…" rows={5}>
        {() => list.length === 0 ? (
          <Empty title={status === "active" ? "No open conversations" : "No closed conversations"}
            hint="Guests start chats from the app; they land here for the centre that owns their care." />
        ) : (
          <Card className="grid min-h-[560px] overflow-hidden md:grid-cols-[290px_minmax(0,1fr)]">
            <div className="max-h-[560px] overflow-y-auto border-r border-border bg-ivory">
              {list.map((th) => {
                const who = nameOf(th.userId, "Guest");
                const assignee = th.assignedAdmin && typeof th.assignedAdmin === "object" ? th.assignedAdmin.name : null;
                return (
                  <button key={th._id} onClick={() => setActiveId(th._id)}
                    className={`flex w-full gap-2.5 border-b border-border px-3 py-2.5 text-left ${
                      th._id === activeId ? "bg-surface shadow-[inset_3px_0_0_var(--color-gold-dark)]" : "hover:bg-surface/60"}`}>
                    <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-white">
                      {initials(who)}
                      {presence[th._id] && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ivory bg-emerald-500" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-1.5 text-[12.5px] font-bold">
                        <span className="truncate">{who}</span>
                        <span className="shrink-0 font-mono text-[10px] font-normal text-ink3">{fmtAgo(th.lastMessageTime)}</span>
                      </div>
                      <div className="truncate text-[11px] text-ink3">
                        {typing[th._id] ? <em>typing…</em> : th.lastMessage || "No messages yet"}
                      </div>
                      <div className="truncate text-[10px] text-ink3">
                        {!branchId && <span>{th.branchName}</span>}
                        {assignee && <span>{!branchId ? " · " : ""}{assignee}</span>}
                      </div>
                    </div>
                    {!!th.unreadCount && th.unreadCount > 0 && (
                      <span className="self-center rounded-full bg-gold px-1.5 font-mono text-[10px] font-bold text-primary">{th.unreadCount}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {cur ? (
              <div className="flex max-h-[560px] flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
                  <div className="min-w-0 text-[13px]">
                    <B>{nameOf(cur.userId, "Guest")}</B>{" "}
                    <span className="text-[11px] text-ink3">
                      · {cur.branchName}
                      {presence[cur._id] ? " · online" : ""}
                      {assignedName ? ` · with ${assignedName}` : " · unassigned"}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                      onClick={() => nav("/patient", { state: { id: idOf(cur.userId) } })}>Open patient ↗</Btn>
                    {cur.status === "active" && (
                      <>
                        <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setAssignOpen(true)}>
                          {assignedName ? "Reassign" : "Assign"}
                        </Btn>
                        {!assignedName && myId && (
                          <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => assign(myId)}>Take</Btn>
                        )}
                        <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={async () => {
                          try { await api.chat.close(cur._id); toast("Conversation closed"); threads.reload(); }
                          catch (e) { toast((e as Error).message); }
                        }}>Close</Btn>
                      </>
                    )}
                  </div>
                </div>

                <div ref={scrollRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
                  {messages.initial && !messages.data ? <Spinner /> : msgs.length === 0 ? (
                    <div className="m-auto text-[12.5px] text-ink3">No messages yet — say hello.</div>
                  ) : msgs.map((m) => m.messageType === "system" ? (
                    <div key={m._id} className="self-center rounded-full bg-ivory px-3 py-1 text-[11px] text-ink3">{m.content}</div>
                  ) : (
                    <div key={m._id} className={`group relative max-w-[82%] rounded-xl px-3 py-2 text-[12.5px] leading-normal ${
                      m.senderModel === "User" ? "self-start rounded-bl-[3px] bg-sage" : "self-end rounded-br-[3px] bg-primary text-white"}`}>
                      {m.attachment?.kind === "image" && (
                        <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mb-1.5 block overflow-hidden rounded-lg bg-black/5">
                          <img src={m.attachment.url} alt={m.attachment.fileName} className="max-h-64 w-full min-w-[220px] object-cover" />
                        </a>
                      )}
                      {m.attachment?.kind === "file" && (
                        <a href={m.attachment.url} target="_blank" rel="noreferrer"
                          className={`mb-1.5 flex min-w-[230px] items-center gap-2.5 rounded-lg border p-2.5 ${m.senderModel === "Admin" ? "border-white/20 bg-white/10" : "border-border bg-surface/75"}`}>
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg ${m.senderModel === "Admin" ? "bg-white/15" : "bg-ivory"}`}>↗</span>
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{m.attachment.fileName}</span>
                            <span className="block text-[10.5px] opacity-65">{chatFileSize(m.attachment.size)} · Open file</span>
                          </span>
                        </a>
                      )}
                      {m.content && <div className="whitespace-pre-wrap break-words">{m.content}</div>}
                      <span className="mt-0.5 block font-mono text-[9.5px] opacity-60">
                        {m.senderModel === "Admin" ? `${m.senderName} · ` : ""}{fmtAgo(m.createdAt)}
                        {m.senderModel === "Admin" ? (m.isRead ? " · read" : " · sent") : ""}
                      </span>
                      {m.senderModel === "Admin" && String(m.senderId) === myId && (
                        <button onClick={() => remove(m)} title="Delete message"
                          className="absolute -left-6 top-1.5 hidden text-[11px] text-ink3 hover:text-err group-hover:block">✕</button>
                      )}
                    </div>
                  ))}
                  {!!typing[cur._id] && (
                    <div className="self-start rounded-xl rounded-bl-[3px] bg-sage px-3 py-2 text-[12px] italic text-ink3">{typing[cur._id]} is typing…</div>
                  )}
                </div>

                <div className="border-t border-border p-2.5">
                  {selectedFile && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-ivory p-2 text-[11.5px]">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sage">{selectedFile.type.startsWith("image/") ? "▧" : "↗"}</span>
                      <span className="min-w-0 flex-1">
                        <B>{selectedFile.name}</B>
                        <span className="ml-1.5 text-ink3">{chatFileSize(selectedFile.size)} · ready to send</span>
                      </span>
                      <button type="button" onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="grid h-8 w-8 place-items-center rounded-full text-ink3 hover:bg-surface hover:text-err" aria-label="Remove attachment">✕</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                  <input ref={fileRef} type="file" className="hidden"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,application/pdf,text/plain,text/csv,application/json,application/rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    onChange={(e) => chooseFile(e.target.files?.[0])} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={sending || cur.status !== "active"}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-ivory text-lg text-primary hover:border-gold-dark disabled:opacity-50"
                    aria-label="Attach image or file" title="Attach image or file">＋</button>
                  <input value={msg} onChange={(e) => onDraft(e.target.value)}
                    maxLength={2000}
                    onKeyDown={(e) => e.key === "Enter" && !sending && send()}
                    disabled={cur.status !== "active"}
                    placeholder={cur.status === "active" ? `Reply as ${admin?.name ?? "the clinic"}…` : "This conversation is closed"}
                    className="flex-1 rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark disabled:opacity-60" />
                  <Btn disabled={sending || (!msg.trim() && !selectedFile) || cur.status !== "active"} onClick={send}>{sending ? "Sending…" : "Send"}</Btn>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid place-items-center text-[13px] text-ink3">Select a conversation</div>
            )}
          </Card>
        )}
      </Async>

      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign conversation">
        <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
          {staffList.length === 0 && <div className="text-[12.5px] text-ink3">No active staff found.</div>}
          {staffList.map((a) => (
            <button key={a._id} onClick={() => assign(String(a._id))}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-ivory">
              <span><B>{a.name}</B> <span className="text-ink3">· {a.role}</span></span>
              {cur?.assignedAdmin && idOf(cur.assignedAdmin) === String(a._id) && <Tag kind="ok">current</Tag>}
            </button>
          ))}
          {assignedName && (
            <button onClick={() => assign(null)} className="mt-1 rounded-lg px-3 py-2 text-left text-[12.5px] text-err hover:bg-ivory">Clear assignment</button>
          )}
        </div>
      </Modal>
    </Page>
  );
}

/* ================= SUPPORT INBOX ================= */
const SUPPORT_TABS: { label: string; status?: string }[] = [
  { label: "All" }, { label: "Pending", status: "pending" }, { label: "In progress", status: "in-progress" },
  { label: "Resolved", status: "resolved" }, { label: "Closed", status: "closed" },
];

export function SupportInbox() {
  const { toast, audit } = useStore();
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const q = useApi(() => api.support.list({ status: SUPPORT_TABS[tab].status, limit: 100 }), [tab]);
  const all = useApi(() => api.support.list({ limit: 200 }), []);

  const rows = q.data?.data ?? [];
  const everything = all.data?.data ?? [];
  // Look in the full set too, so resolving a ticket from the Pending tab keeps the drawer open.
  const sel = rows.find((m) => m._id === open) ?? everything.find((m) => m._id === open);

  const setStatus = async (id: string, status: string) => {
    try {
      await api.support.setStatus(id, status, note.trim() || undefined);
      audit("SUPPORT_UPDATED", `Ticket ${id} → ${status}`, { ticketId: id });
      toast(`Ticket marked ${status}`);
      setNote("");
      q.reload(); all.reload();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <Page title="Support inbox" sub="Messages guests send from the app's help screen">
      <Tabs active={tab} onChange={setTab}
        items={SUPPORT_TABS.map((t) => [t.label, t.status ? everything.filter((m) => m.status === t.status).length : everything.length])} />
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading tickets…" rows={6}>
        {() => rows.length === 0 ? <Empty title="Nothing in this queue" /> : (
          <DataTable cols={["Received", "Guest", "Subject", "Contact", "Priority", "Status"]}
            onRow={(i) => setOpen(rows[i]._id)}
            rows={rows.map((m) => [
              fmtWhen(m.createdAt),
              <B key={m._id}>{m.name}</B>,
              m.subject,
              <span key={`${m._id}c`} className="text-[11.5px]">{m.phone}<br /><span className="text-ink3">{m.email}</span></span>,
              <Tag key={`${m._id}p`} kind={m.priority === "urgent" || m.priority === "high" ? "err" : m.priority === "medium" ? "warn" : "mute"}>{m.priority}</Tag>,
              <Tag key={`${m._id}s`} kind={m.status === "resolved" || m.status === "closed" ? "ok" : m.status === "in-progress" ? "info" : "warn"}>{m.status}</Tag>,
            ])} />
        )}
      </Async>

      <Drawer open={!!sel} onClose={() => { setOpen(null); setNote(""); }} title={sel?.subject ?? "Ticket"}>
        {sel && (
          <>
            <Card className="p-4">
              <div className="text-[13px] font-bold">{sel.name}</div>
              <div className="mt-1 text-[12px] text-ink2">{sel.email} · {sel.phone}</div>
              {sel.location && <div className="text-[12px] text-ink3">{sel.location}</div>}
              <div className="mt-2 flex gap-2">
                <Tag kind={sel.priority === "urgent" || sel.priority === "high" ? "err" : "warn"}>{sel.priority}</Tag>
                <Tag kind={sel.status === "resolved" ? "ok" : "info"}>{sel.status}</Tag>
              </div>
              <div className="mt-3 whitespace-pre-wrap rounded-lg bg-ivory p-3 text-[12.5px] text-ink2">{sel.message}</div>
              <div className="mt-2 font-mono text-[10.5px] text-ink3">Received {fmtWhen(sel.createdAt)}</div>
            </Card>

            {!!sel.adminNotes?.length && (
              <Card className="mt-3 p-4"><SecH t="Desk notes" />
                {sel.adminNotes.map((n, i) => (
                  <div key={i} className="border-b border-border py-1.5 text-[12px] text-ink2 last:border-0">
                    {n.note}<span className="ml-1 text-[10.5px] text-ink3">· {fmtWhen(n.addedAt)}</span>
                  </div>
                ))}
              </Card>
            )}

            <div className="mt-3"><Area label="Add a note (optional)" value={note} onChange={setNote} rows={3} /></div>
            <div className="mt-3 grid gap-2">
              {sel.status === "pending" && <Btn onClick={() => setStatus(sel._id, "in-progress")}>Start working on it</Btn>}
              {sel.status !== "resolved" && <Btn kind="gold" onClick={() => setStatus(sel._id, "resolved")}>Mark resolved</Btn>}
              {sel.status !== "closed" && <Btn kind="ghost" onClick={() => setStatus(sel._id, "closed")}>Close ticket</Btn>}
              <Btn kind="ghost" onClick={() => window.open(`mailto:${sel.email}?subject=Re: ${encodeURIComponent(sel.subject)}`)}>
                Reply by email
              </Btn>
            </div>
          </>
        )}
      </Drawer>
    </Page>
  );
}
