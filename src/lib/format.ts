import type { Booking, BookingStatus, Id, User } from "./types";

/* ---------------- money ---------------- */
export const fmtINR = (n: number | undefined | null) =>
  "₹" + Math.round(Number(n ?? 0)).toLocaleString("en-IN");

/** Service label that also works for Zenoti-only catalogue entries. */
export const bookingServiceName = (booking: Pick<Booking, "consultationId" | "externalServiceName">, fallback = "—") =>
  booking.externalServiceName || nameOf(booking.consultationId, fallback);

/** 3840000 → "₹38.4L". Used on dashboard tiles where full figures don't fit. */
export function fmtCompactINR(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return fmtINR(v);
}

export const pct = (n: number | undefined | null, digits = 1) =>
  `${Number(n ?? 0).toFixed(digits).replace(/\.0$/, "")}%`;

/* ---------------- dates ---------------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toDate(v: string | Date | undefined | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ---------------------------------------------------------------------------
 * Everything in the panel is a clinic-local (Asia/Kolkata) date, whatever
 * timezone the staff laptop happens to be in. Appointment days are stored at
 * IST midnight by the server; these helpers read them back the same way.
 * ------------------------------------------------------------------------- */
export const CLINIC_TZ = "Asia/Kolkata";
const partsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** Clinic-local calendar parts of an instant. */
export function clinicParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = partsFmt.formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute") };
}
/** Clinic-local YYYY-MM-DD — what the booking endpoints expect for `date`. */
export function isoDay(d: Date = new Date()): string {
  const c = clinicParts(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.y}-${p(c.m)}-${p(c.d)}`;
}

export const isSameDay = (a: Date | null, b: Date | null) => !!a && !!b && isoDay(a) === isoDay(b);

export function fmtDate(v: string | Date | undefined | null): string {
  const d = toDate(v);
  if (!d) return "—";
  const c = clinicParts(d);
  return `${c.d} ${MONTHS[c.m - 1]}`;
}

export function fmtDateFull(v: string | Date | undefined | null): string {
  const d = toDate(v);
  if (!d) return "—";
  const c = clinicParts(d);
  return `${c.d} ${MONTHS[c.m - 1]} ${c.y}`;
}

export function fmtTime(v: string | Date | undefined | null): string {
  const d = toDate(v);
  if (!d) return "—";
  const c = clinicParts(d);
  return `${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
}

/** "Today 10:00" / "Tomorrow 15:30" / "12 Jul 11:00" — the panel's shorthand. */
export function fmtWhen(date: string | Date | undefined | null, time?: string | null): string {
  const d = toDate(date);
  if (!d) return time || "—";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const label = isSameDay(d, now)
    ? "Today"
    : isSameDay(d, tomorrow)
      ? "Tomorrow"
      : isSameDay(d, yesterday)
        ? "Yesterday"
        : fmtDate(d);
  const c = clinicParts(d);
  const t = time || (c.hh || c.mm ? fmtTime(d) : "");
  return t ? `${label} ${t}` : label;
}

/** "2 m" / "18 m" / "3 h" / "4 d" — chat and notification lists. */
export function fmtAgo(v: string | Date | undefined | null): string {
  const d = toDate(v);
  if (!d) return "";
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)} m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)} d`;
  return fmtDate(d);
}

export function ageFrom(dob: string | Date | undefined | null): number | null {
  const d = toDate(dob);
  if (!d) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/* ---------------- booking status ---------------- */
/** UI keys used by the STATUS tag map in ui.tsx. */
export type StatusKey = "pending" | "confirmed" | "rescheduled" | "inprogress" | "completed" | "cancelled" | "noshow" | "late";

const STATUS_TO_KEY: Record<BookingStatus, StatusKey> = {
  "Awaiting Confirmation": "pending",
  Confirmed: "confirmed",
  Rescheduled: "rescheduled",
  "In Progress": "inprogress",
  Cancelled: "cancelled",
  "No Show": "noshow",
  Completed: "completed",
};

export function statusKey(
  b: Pick<Booking, "status" | "confirmedDate" | "confirmedTime" | "preferredDate"> & { preferredTimeSlots?: string[] },
): StatusKey {
  const key = STATUS_TO_KEY[b.status] ?? "pending";
  // A confirmed booking whose slot passed more than 10 minutes ago is late,
  // which is what the floor actually needs to see.
  if (key === "confirmed") {
    const slot = bookingSlotDate(b);
    if (slot && Date.now() - slot.getTime() > 10 * 60 * 1000) return "late";
  }
  return key;
}

/** Best-known moment for a booking: confirmed slot, else preferred slot. */
export function bookingSlotDate(
  b: Pick<Booking, "confirmedDate" | "confirmedTime" | "preferredDate"> & { preferredTimeSlots?: string[] },
): Date | null {
  const base = toDate(b.confirmedDate) ?? toDate(b.preferredDate);
  if (!base) return null;
  const time = b.confirmedTime || b.preferredTimeSlots?.[0];
  const m = time?.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return base;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = m[3]?.toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  // Build the instant on the clinic's calendar day, not the laptop's.
  return new Date(`${isoDay(base)}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+05:30`);
}

/** "HH:MM" of an instant in clinic time — for day-book buckets. */
export function clinicHM(d: Date): string {
  const c = clinicParts(d);
  return `${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
}

export function bookingSlotLabel(b: Booking): string {
  const time = b.confirmedTime || b.preferredTimeSlots?.[0] || "";
  return fmtWhen(b.confirmedDate || b.preferredDate, time);
}

/** Bookings carry a status string but no "source"; infer it for the list view. */
export function bookingSource(b: Booking): string {
  if (b.source === "reception") return "Reception";
  if (b.source === "package") return "Package";
  if (b.source === "zenoti") return "Zenoti";
  if (b.source === "app") return "App";
  // Older rows predate the `source` field.
  if (b.adminNotes?.toLowerCase().includes("reception")) return "Reception";
  return b.paymentStatus === "paid" ? "App" : "App";
}

/**
 * Dermatologist consultation vs treatment — the same rule the app and backend use:
 * category "Consultation(s)" or a name containing "consultation".
 */
export function isConsultationBooking(b: Booking): boolean {
  const c = b.consultationId && typeof b.consultationId === "object" ? (b.consultationId as { name?: string; category?: string }) : null;
  if (c) return /^consultations?$/i.test(c.category ?? "") || /consult|counsel/i.test(c.name ?? "");
  return /consult|counsel/i.test(b.externalServiceName ?? "");
}

/** Dermatologist on the booking; falls back to the clinic practitioner name. */
export const bookingProvider = (b: Booking) => b.specialistName || b.therapistName || b.specialistTier || "Not assigned";

/* ---------------- ids & names ---------------- */
export function idOf(v: unknown): Id | "" {
  if (!v) return "";
  if (typeof v === "string") return v;
  const obj = v as { _id?: Id };
  return obj._id ?? "";
}

/** Populated refs arrive as objects; unpopulated as ids. */
export function nameOf(v: unknown, fallback = "—"): string {
  if (!v) return fallback;
  if (typeof v === "string") return fallback;
  const o = v as { fullName?: string; name?: string; inventoryName?: string };
  return o.fullName ?? o.name ?? o.inventoryName ?? fallback;
}

export function initials(name: string | undefined | null): string {
  if (!name) return "?";
  const parts = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `${phone.slice(0, phone.length - 5)}•••${phone.slice(-2)}`;
}

/** Clinical risk chips shown on the patient list before the record is opened. */
export function patientFlags(u: User): string[] {
  const flags: string[] = [];
  if (u.drugAllergies?.trim()) flags.push(`${u.drugAllergies.trim()} allergy`);
  else if (u.hasDrugAllergy) flags.push("Drug allergy");
  if (u.medicalHistory?.trim()) flags.push(u.medicalHistory.trim().slice(0, 40));
  if (u.isActive === false) flags.push("Account deactivated");
  return flags;
}

export const isVip = (u: User) => u.memberType === "Zen Member";

export const imageUrl = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  return (v as { url?: string }).url ?? "";
};

/**
 * Several analytics endpoints return a keyed map ({ "Jubilee Hills": 2700 })
 * where a chart wants rows. Sorts high-to-low and drops empty buckets.
 */
export function mapToRows(
  map: Record<string, number> | undefined | null,
  fmt: (n: number) => string = String,
): [string, number, string][] {
  return Object.entries(map ?? {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, v]) => [k || "Unknown", Number(v), fmt(Number(v))]);
}
