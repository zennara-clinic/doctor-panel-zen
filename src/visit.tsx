import { useState, type ReactNode } from "react";
import {
  AlertTriangle, CalendarCheck, CheckCircle2, ChevronRight, ClipboardX, Clock, FilePen, FileText, History,
  MapPin, MoreHorizontal, PenLine, Play, RotateCcw, Stethoscope, UserCheck, UserX, XCircle,
} from "lucide-react";
import api from "./lib/api";
import { ApiError } from "./lib/http";
import type { Booking, Doctor, LifecycleAction, LifecycleOption, LifecycleState } from "./lib/types";
import { bookingServiceName, bookingSlotDate, fmtDate, fmtTime } from "./lib/format";
import { useApi } from "./lib/useApi";
import { useStore } from "./store";
import { Area, Btn, Empty, Menu, Modal, Note } from "./ui";
import { LIFECYCLE_TOAST, StatusHistory } from "./lifecycle";

/*
 * A visit, as the dermatologist sees it.
 *
 * The appointment's status belongs to the lifecycle service on the server
 * (Zenoti's own states). This file only decides how that status reads from the
 * consult room and which one button to offer. It never invents a transition:
 * every action goes through POST /bookings/admin/:id/lifecycle, and anything
 * the server does not offer right now is not shown.
 *
 *   Booked / Not arrived   the desk has not checked the guest in yet
 *   Waiting                checked in, waiting for the dermatologist
 *   In consultation        started — the note is being written
 *   Completed              checked out; the note is signed or still to sign
 *   No-show / Cancelled    closed without a consultation
 */

/** Bookings assigned to this dermatologist for a date or a window, soonest first. */
export function useMyBookings(doctor: Doctor | null | undefined, date?: string, range?: { startDate: string; endDate: string }) {
  return useApi(async () => {
    if (!doctor) return [] as Booking[];
    const res = await api.bookings.list({ specialistId: doctor.doctorId, date, ...(range ?? {}) });
    // Legacy rows were keyed on the display name only.
    const mine = (res.data ?? []).filter((b) => !b.specialistId || b.specialistId === doctor.doctorId || b.specialistName === doctor.name);
    return mine.sort((a, b) => (bookingSlotDate(a)?.getTime() ?? 0) - (bookingSlotDate(b)?.getTime() ?? 0));
  }, [doctor?._id, date, range?.startDate, range?.endDate]);
}

export function NoProfile({ email }: { email?: string }) {
  return (
    <Empty icon={<Stethoscope />} title="No dermatologist profile is linked to this login"
      hint={`Ask an admin to open Care → Dermatologists and set the profile's email to ${email ?? "your address"}. Until then this panel has no schedule to show.`} />
  );
}

export const visitTime = (b: Pick<Booking, "confirmedTime" | "preferredTimeSlots">) => b.confirmedTime || b.preferredTimeSlots?.[0] || "—";
export const isOpenVisit = (b: Pick<Booking, "status">) => !["Completed", "Cancelled", "No Show"].includes(b.status);

export function visitLook(b: Booking): { label: string; tone: string; icon: ReactNode } {
  switch (b.status) {
    case "Awaiting Confirmation": return { label: "Awaiting confirmation", tone: "warn", icon: <Clock /> };
    case "Checked In": return { label: "Waiting", tone: "gold", icon: <UserCheck /> };
    case "In Progress": return { label: "In consultation", tone: "info", icon: <Stethoscope /> };
    case "Completed": return { label: "Completed", tone: "ok", icon: <CheckCircle2 /> };
    case "No Show": return { label: "No-show", tone: "err", icon: <UserX /> };
    case "Cancelled": return { label: "Cancelled", tone: "off", icon: <XCircle /> };
    default: {
      const slot = bookingSlotDate(b);
      if (slot && Date.now() - slot.getTime() > 15 * 60_000) return { label: "Not arrived", tone: "warn", icon: <Clock /> };
      return { label: b.status === "Rescheduled" ? "Rescheduled" : "Booked", tone: "", icon: <CalendarCheck /> };
    }
  }
}

export function VisitStatus({ booking, small }: { booking: Booking; small?: boolean }) {
  const l = visitLook(booking);
  return <span className={`dz-pill ${small ? "dz-pill--sm" : ""} ${l.tone ? `dz-pill--${l.tone}` : ""}`}>{l.icon}{l.label}</span>;
}

export type VisitFlags = {
  /** Pre-consult status, or null when the guest has not filled one. */
  form?: string | null;
  /** Consultation note status, or null when nothing is written yet. */
  note?: string | null;
  /** Drug allergies from the intake — the one fact that changes what may be prescribed. */
  allergy?: string | null;
};

/** One appointment as a row, with the single action its state calls for. */
export function VisitRow({ booking: b, flags, onOpen, onStart, starting, showDate }: {
  booking: Booking;
  flags?: VisitFlags;
  onOpen: (bookingId: string) => void;
  /** Start a checked-in guest's consultation straight from the list. */
  onStart?: (b: Booking) => void;
  starting?: boolean;
  showDate?: boolean;
}) {
  const waiting = b.status === "Checked In";
  const live = b.status === "In Progress";
  const done = !isOpenVisit(b);
  const when = b.confirmedDate || b.preferredDate;
  const open = () => onOpen(b._id);

  let action: ReactNode;
  if (live) action = <Btn onClick={open}><FileText />Continue</Btn>;
  else if (waiting) action = onStart
    ? <Btn onClick={() => onStart(b)} disabled={starting}><Play />{starting ? "Starting…" : "Start"}</Btn>
    : <Btn onClick={open}><Play />Open</Btn>;
  else if (b.status === "Completed") action = flags?.note === "Completed"
    ? <Btn kind="secondary" onClick={open}><FileText />View note</Btn>
    : flags?.note === "Draft"
      ? <Btn kind="gold" onClick={open}><PenLine />Sign note</Btn>
      // No note here: most completed visits come from Zenoti, where nothing was written in this panel.
      : <Btn kind="secondary" onClick={open}>Open<ChevronRight /></Btn>;
  else if (done) action = <Btn kind="plain" onClick={open}>View</Btn>;
  else action = <Btn kind="secondary" onClick={open}>Open<ChevronRight /></Btn>;

  const allergy = flags?.allergy ? (flags.allergy.length > 36 ? `${flags.allergy.slice(0, 34)}…` : flags.allergy) : null;
  const noForm = !!flags && !flags.form && !done;
  const draft = flags?.note === "Draft";

  return (
    <div className={`dz-visit ${live ? "is-live" : waiting ? "is-waiting" : done ? "is-done" : ""}`}>
      <div className="dz-visit__time">
        {visitTime(b)}
        {showDate && when ? <small>{fmtDate(when)}</small> : waiting && b.checkInTime ? <small>Arrived {fmtTime(b.checkInTime)}</small> : null}
      </div>
      <button type="button" className="dz-visit__main" onClick={open}>
        <div className="dz-visit__name">{b.fullName}</div>
        <div className="dz-visit__meta">
          <span><Stethoscope />{bookingServiceName(b, "Visit")}</span>
          {b.preferredLocation && <span><MapPin />{b.preferredLocation}</span>}
        </div>
        {(allergy || noForm || draft) && (
          <div className="dz-visit__flags">
            {allergy && <span className="dz-pill dz-pill--sm dz-pill--err"><AlertTriangle />Allergy: {allergy}</span>}
            {noForm && <span className="dz-pill dz-pill--sm dz-pill--warn"><ClipboardX />No pre-consult form</span>}
            {draft && <span className="dz-pill dz-pill--sm dz-pill--warn"><FilePen />Note in draft</span>}
          </div>
        )}
      </button>
      <div className="dz-visit__side">
        <VisitStatus booking={b} small />
        {action}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ lifecycle runs */

const CONFIRM_COPY: Partial<Record<LifecycleAction, string>> = {
  no_show: "The guest did not come. The appointment is marked no-show here and in Zenoti.",
  undo_no_show: "Puts the appointment back to booked. This corrects Zennara only — Zenoti has no undo for a no-show.",
  undo_start: "Moves the guest back to waiting. Nothing you have written is lost.",
  undo_check_in: "Moves the appointment back to booked, as if the guest had not arrived yet.",
};

type Ask = { title: string; message: string; needsReason: boolean; confirmLabel: string; danger?: boolean; run: (reason?: string) => Promise<boolean> };

function ReasonDialog({ ask, busy, onClose }: { ask: Ask; busy: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const blocked = ask.needsReason && reason.trim().length < 3;
  return (
    <Modal open onClose={onClose} title={ask.title}
      footer={<>
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Back</Btn>
        <Btn kind={ask.danger ? "danger" : "primary"} disabled={busy || blocked}
          onClick={async () => { if (await ask.run(reason.trim() || undefined)) onClose(); }}>
          {busy ? "Working…" : ask.confirmLabel}
        </Btn>
      </>}>
      {ask.message && <Note kind={ask.danger ? "crit" : "gold"} className="mt-0">{ask.message}</Note>}
      {ask.needsReason && (
        <Area label="Reason — recorded against your name" value={reason} onChange={setReason} rows={2}
          placeholder="e.g. guest arrived early and the room is free" />
      )}
    </Modal>
  );
}

/**
 * Runs lifecycle actions for one booking, asking for a reason where the server
 * requires one (an early check-in, a reopen).
 */
export function useVisitRunner(booking: Booking | null | undefined, onChanged: () => void) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  // The lifecycle route writes the audit entry (with the reason) itself.
  const exec = async (action: LifecycleAction, over: { reason?: string; force?: boolean } = {}) => {
    if (!booking) return;
    await api.bookings.lifecycle(booking._id, { action, ...over });
  };

  const perform = async (fn: () => Promise<void>, message: string): Promise<boolean> => {
    setBusy(true); setError(null);
    try { await fn(); toast(message); onChanged(); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); onChanged(); return false; }
    finally { setBusy(false); }
  };

  /** Start the consultation — checking the guest in first if the desk has not. */
  const start = (state: LifecycleState | null) => {
    const opts = state?.actions ?? [];
    if (opts.some((o) => o.action === "start")) { void perform(() => exec("start"), "Consultation started"); return; }
    const checkIn = opts.find((o) => o.action === "check_in");
    if (!checkIn) { setError("This visit can’t be started from where it is now."); return; }
    const both = (over: { reason?: string; force?: boolean } = {}) => perform(async () => {
      await exec("check_in", over);
      await exec("start");
    }, "Guest checked in — consultation started");
    if (checkIn.blocked) {
      setAsk({
        title: "Check in early and start?",
        message: checkIn.blockedReason ?? "It is outside this appointment’s check-in window.",
        needsReason: true,
        confirmLabel: "Check in & start",
        run: (reason) => both({ reason, force: true }),
      });
      return;
    }
    void both();
  };

  /** One of the secondary actions from the visit menu. */
  const offer = (opt: LifecycleOption) => {
    setAsk({
      title: `${opt.label}?`,
      message: CONFIRM_COPY[opt.action] ?? "",
      needsReason: Boolean(opt.needsReason || opt.blocked),
      confirmLabel: opt.label,
      danger: opt.action === "no_show",
      run: (reason) => perform(() => exec(opt.action, reason ? { reason, force: opt.blocked || undefined } : {}), LIFECYCLE_TOAST[opt.action]),
    });
  };

  const dialog = ask ? <ReasonDialog ask={ask} busy={busy} onClose={() => setAsk(null)} /> : null;
  return { busy, error, clearError: () => setError(null), exec, perform, start, offer, dialog };
}
export type VisitRunner = ReturnType<typeof useVisitRunner>;

const MENU_ACTIONS: LifecycleAction[] = ["no_show", "undo_no_show", "undo_start", "undo_check_in"];

/** The overflow menu on the consultation bar: corrections and the audit trail. */
export function VisitMenu({ booking, state, runner }: { booking: Booking; state: LifecycleState | null; runner: VisitRunner }) {
  const [history, setHistory] = useState(false);
  const opts = (state?.actions ?? []).filter((o) => MENU_ACTIONS.includes(o.action));
  const log = state?.statusLog ?? booking.statusLog ?? [];
  return (
    <>
      <Menu align="right"
        button={<button type="button" className="dz-iconbtn" aria-label="More visit actions"><MoreHorizontal /></button>}
        items={[
          ...opts.map((o) => ({
            label: o.label,
            icon: o.action === "no_show" ? <UserX /> : <RotateCcw />,
            danger: o.action === "no_show",
            onClick: () => runner.offer(o),
          })),
          ...(opts.length ? [{ divider: true, label: "" }] : []),
          { label: "Appointment history", icon: <History />, onClick: () => setHistory(true) },
        ]} />
      <Modal open={history} onClose={() => setHistory(false)} title="Appointment history" sub={booking.fullName}>
        {log.length ? <StatusHistory log={log} /> : <div className="dz-hint">Nothing recorded on this appointment yet.</div>}
      </Modal>
    </>
  );
}
