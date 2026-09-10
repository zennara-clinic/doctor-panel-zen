import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Coffee, FileText, PenLine, Play, Stethoscope, UserCheck, Users,
} from "lucide-react";
import api from "../lib/api";
import { useApi, useBookingUpdates, usePoll } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import { useStore } from "../store";
import { Async, Btn, Loading, Segmented, StaleBanner } from "../ui";
import { NoProfile, VisitRow, isOpenVisit, useMyBookings, visitTime, type VisitFlags } from "../visit";
import {
  addClinicDays, bookingServiceName, clinicMonthStart, clinicParts, fmtDayKey, fmtTime, idOf, isoDay,
} from "../lib/format";
import type { Booking, PreConsultForm } from "../lib/types";

/**
 * Today — the dermatologist's home.
 *
 * Top to bottom it answers the three questions asked between guests:
 *   who needs me right now      the spotlight (in consultation, or waiting)
 *   how is the day going        four numbers
 *   who is next, what do I press   the list, split into still-to-see and done
 */
export function MyDay() {
  const nav = useNavigate();
  const { admin, toast, audit } = useStore();
  const me = useMyDoctor();
  const [day, setDay] = useState(isoDay());
  const liveDay = useRef(isoDay());
  const today = isoDay();
  const isToday = day === today;

  // Roll over at midnight if the dermatologist was looking at "today".
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = isoDay();
      setDay((selected) => (selected === liveDay.current ? current : selected));
      liveDay.current = current;
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  const bookings = useMyBookings(me.data, day);
  useBookingUpdates(bookings.reload, !!me.data);
  usePoll(bookings.reload, 60000, !!me.data);

  const monthRange = useMemo(() => ({ startDate: clinicMonthStart(today), endDate: today }), [today]);
  const month = useMyBookings(me.data, undefined, monthRange);
  const upcomingRange = useMemo(() => ({ startDate: addClinicDays(today, 1), endDate: addClinicDays(today, 7) }), [today]);
  const upcoming = useMyBookings(me.data, undefined, upcomingRange);

  const rows = bookings.data ?? [];
  const idsKey = rows.map((b) => b._id).join(",");

  const forms = useApi(async () => {
    const ids = rows.map((b) => b._id);
    if (!ids.length) return [] as PreConsultForm[];
    const parts = await Promise.all(ids.map((id) => api.preConsult.list({ bookingId: id, limit: 1 }).then((r) => r.data ?? []).catch(() => [] as PreConsultForm[])));
    return parts.flat();
  }, [idsKey]);

  /*
   * Where each guest's intake stands: submitted, started, held on paper at the
   * clinic (a returning guest), or genuinely missing. Only the last one earns
   * the "No pre-consult form" warning.
   */
  const intake = useApi(async () => {
    const entries = await Promise.all(rows.map((b) => api.preConsult.statusForBooking(b._id)
      .then((st) => [b._id, st.state] as const)
      .catch(() => [b._id, "unknown"] as const)));
    return new Map<string, string>(entries);
  }, [idsKey]);

  const notes = useApi(
    () => (me.data ? api.consultationNotes.list({ doctorId: me.data.doctorId, limit: 300 }).then((r) => r.data ?? []) : Promise.resolve([])),
    [me.data?._id, rows.map((b) => `${b._id}:${b.status}`).join(",")],
  );

  const noteByBooking = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes.data ?? []) map.set(idOf(n.bookingId), n.status);
    return map;
  }, [notes.data]);

  const flagsFor = useMemo(() => {
    const formByBooking = new Map<string, string>();
    const allergyByUser = new Map<string, string>();
    for (const f of forms.data ?? []) {
      formByBooking.set(idOf(f.bookingId), f.status);
      const a = f.drugAllergies;
      if (a && !/^none/i.test(a)) allergyByUser.set(idOf(f.userId), a);
    }
    return (b: Booking): VisitFlags => ({
      // Until the intake state is known, assume nothing is missing rather than flash a warning.
      form: formByBooking.get(b._id) ?? (!intake.data ? "loading" : intake.data.get(b._id) === "not_started" ? null : intake.data.get(b._id) ?? "unknown"),
      note: noteByBooking.get(b._id) ?? null,
      allergy: allergyByUser.get(idOf(b.userId)) ?? null,
    });
  }, [forms.data, noteByBooking, intake.data]);

  const openRows = rows.filter(isOpenVisit);
  const doneRows = rows.filter((b) => !isOpenVisit(b));
  const completed = rows.filter((b) => b.status === "Completed");
  const waiting = rows
    .filter((b) => b.status === "Checked In")
    .sort((a, b) => new Date(a.checkInTime ?? 0).getTime() - new Date(b.checkInTime ?? 0).getTime());
  const live = rows.find((b) => b.status === "In Progress");
  const next = openRows.find((b) => ["Confirmed", "Rescheduled", "Awaiting Confirmation"].includes(b.status));
  const toSign = (month.data ?? []).filter((b) => b.status === "Completed" && noteByBooking.get(b._id) !== "Completed");

  const [view, setView] = useState<"next" | "done" | "sign">("next");
  const [starting, setStarting] = useState<string | null>(null);

  const openConsult = (id: string) => nav(`/dermatologist/consultation?booking=${id}`);
  const start = async (b: Booking) => {
    setStarting(b._id);
    try {
      await api.bookings.lifecycle(b._id, { action: "start" });
      audit("BOOKING_UPDATED", `${b.fullName} · start`, { bookingId: b._id });
      toast(`Consultation started — ${b.fullName}`);
      openConsult(b._id);
    } catch (e) {
      toast((e as Error).message);
      bookings.reload();
    } finally {
      setStarting(null);
    }
  };

  const hour = clinicParts(new Date()).hh;
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = (me.data?.name ?? admin?.name ?? "").replace(/^dr\.?\s*/i, "").trim().split(/\s+/)[0];
  const dayLabel = fmtDayKey(day, { weekday: "long", day: "numeric", month: "short", year: "numeric" });

  const list = view === "next" ? openRows : view === "done" ? doneRows : toSign;

  return (
    <div className="dz-page">
      <header className="dz-head">
        <div className="dz-head__txt">
          <div className="dz-eyebrow">{isToday ? dayLabel : "Looking at another day"}</div>
          <h1 className="dz-title">{isToday ? (first ? `${greet}, Dr ${first}` : greet) : dayLabel}</h1>
          {me.data && !bookings.initial && (
            <div className="dz-sub">
              {rows.length === 0 ? "Nothing booked." : `${rows.length} guest${rows.length === 1 ? "" : "s"} · ${completed.length} seen · ${openRows.length} still to see`}
            </div>
          )}
        </div>
        <div className="dz-head__actions">
          <button type="button" className="dz-iconbtn" onClick={() => setDay(addClinicDays(day, -1))} aria-label="Previous day"><ChevronLeft /></button>
          <input type="date" className="dz-input" style={{ width: 172 }} value={day} aria-label="Pick a date"
            onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button type="button" className="dz-iconbtn" onClick={() => setDay(addClinicDays(day, 1))} aria-label="Next day"><ChevronRight /></button>
          {!isToday && <Btn kind="secondary" onClick={() => setDay(today)}>Today</Btn>}
        </div>
      </header>

      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <>
            <StaleBanner error={bookings.data ? bookings.error : null} onRetry={bookings.reload} />

            {isToday && !bookings.initial && (
              live ? (
                <div className="dz-now">
                  <span className="dz-now__icon"><Stethoscope /></span>
                  <div className="dz-now__txt">
                    <div className="dz-now__eyebrow">In consultation now</div>
                    <div className="dz-now__name">{live.fullName}</div>
                    <div className="dz-now__meta">{bookingServiceName(live, "Visit")} · booked for {visitTime(live)}</div>
                  </div>
                  <Btn kind="gold" size="lg" onClick={() => openConsult(live._id)}><FileText />Continue</Btn>
                </div>
              ) : waiting.length > 0 ? (
                <div className="dz-now">
                  <span className="dz-now__icon"><UserCheck /></span>
                  <div className="dz-now__txt">
                    <div className="dz-now__eyebrow">Waiting for you{waiting.length > 1 ? ` · ${waiting.length - 1} more after` : ""}</div>
                    <div className="dz-now__name">{waiting[0].fullName}</div>
                    <div className="dz-now__meta">
                      {bookingServiceName(waiting[0], "Visit")}{waiting[0].checkInTime ? ` · arrived ${fmtTime(waiting[0].checkInTime)}` : ""}
                    </div>
                  </div>
                  <Btn kind="secondary" onClick={() => openConsult(waiting[0]._id)}>Open</Btn>
                  <Btn kind="gold" size="lg" disabled={starting === waiting[0]._id} onClick={() => start(waiting[0])}>
                    <Play />{starting === waiting[0]._id ? "Starting…" : "Start consultation"}
                  </Btn>
                </div>
              ) : next ? (
                <div className="dz-now">
                  <span className="dz-now__icon"><CalendarCheck /></span>
                  <div className="dz-now__txt">
                    <div className="dz-now__eyebrow">Next guest</div>
                    <div className="dz-now__name">{next.fullName}</div>
                    <div className="dz-now__meta">{visitTime(next)} · {bookingServiceName(next, "Visit")} · not checked in yet</div>
                  </div>
                  <Btn kind="secondary" size="lg" onClick={() => openConsult(next._id)}>Prepare<ChevronRight /></Btn>
                </div>
              ) : rows.length > 0 ? (
                <div className="dz-now">
                  <span className="dz-now__icon"><Coffee /></span>
                  <div className="dz-now__txt">
                    <div className="dz-now__eyebrow">All done</div>
                    <div className="dz-now__name">Every guest booked today has been seen.</div>
                    {toSign.length > 0 && <div className="dz-now__meta">{toSign.length} note{toSign.length === 1 ? "" : "s"} still to sign this month.</div>}
                  </div>
                  {toSign.length > 0 && <Btn kind="gold" size="lg" onClick={() => setView("sign")}><PenLine />Sign notes</Btn>}
                </div>
              ) : null
            )}

            <div className="dz-stats">
              <div className="dz-stat">
                <div className="dz-stat__top">Guests {isToday ? "today" : "that day"}<span className="dz-stat__icon"><Users /></span></div>
                <div className="dz-stat__n">{rows.length}</div>
                <div className="dz-stat__d">{openRows.length} still to see</div>
              </div>
              <div className={`dz-stat ${waiting.length ? "dz-stat--gold" : ""}`}>
                <div className="dz-stat__top">Waiting now<span className="dz-stat__icon"><UserCheck /></span></div>
                <div className="dz-stat__n">{waiting.length}</div>
                <div className="dz-stat__d">{waiting.length ? "checked in at the desk" : "nobody waiting"}</div>
              </div>
              <div className="dz-stat">
                <div className="dz-stat__top">Completed<span className="dz-stat__icon"><CheckCircle2 /></span></div>
                <div className="dz-stat__n">{completed.length}</div>
                <div className="dz-stat__d">{doneRows.length - completed.length} no-show or cancelled</div>
              </div>
              <button type="button" className={`dz-stat ${toSign.length ? "dz-stat--warn" : ""} ${view === "sign" ? "is-on" : ""}`} onClick={() => setView("sign")}>
                <div className="dz-stat__top">Notes to sign<span className="dz-stat__icon"><PenLine /></span></div>
                <div className="dz-stat__n">{toSign.length}</div>
                <div className="dz-stat__d">completed this month, unsigned</div>
              </button>
            </div>

            <div className="dz-grid-2">
              <section className="min-w-0">
                <div className="mb-3.5">
                  <Segmented value={view} onChange={setView} options={[
                    { key: "next", label: "Still to see", count: openRows.length },
                    { key: "done", label: "Done", count: doneRows.length },
                    { key: "sign", label: "Notes to sign", count: toSign.length },
                  ]} />
                </div>
                {bookings.initial && !bookings.data ? <Loading label="" rows={4} /> : list.length === 0 ? (
                  <div className="dz-empty">
                    <div className="dz-empty__icon">{view === "sign" ? <CheckCircle2 /> : <Coffee />}</div>
                    <b>{view === "next" ? (rows.length ? "Nobody left to see" : `Nothing booked for ${dayLabel}`) : view === "done" ? "Nobody seen yet" : "Every note is signed"}</b>
                    <p>{view === "next" && !rows.length ? "Guests booked with you at the front desk or in the app appear here." : view === "sign" ? "Completed visits without a signed note would show here." : ""}</p>
                  </div>
                ) : (
                  <div className="dz-list">
                    {list.map((b) => (
                      <VisitRow key={b._id} booking={b} flags={flagsFor(b)} onOpen={openConsult}
                        onStart={start} starting={starting === b._id} showDate={view === "sign"} />
                    ))}
                  </div>
                )}
              </section>

              <aside className="min-w-0">
                <div className="dz-section" style={{ marginTop: 0, minHeight: 50 }}>
                  <h2>Coming up</h2>
                  <span>next 7 days</span>
                </div>
                <Async q={upcoming} label="" rows={3}>
                  {(list7) => {
                    const open7 = list7.filter(isOpenVisit);
                    return open7.length === 0 ? (
                      <div className="dz-empty"><b>Nothing booked this week</b><p>New bookings with you appear here as they come in.</p></div>
                    ) : (
                      <div className="dz-list">
                        {open7.slice(0, 6).map((b) => <VisitRow key={b._id} booking={b} onOpen={openConsult} showDate />)}
                        {open7.length > 6 && <div className="dz-hint px-1">+{open7.length - 6} more later this week</div>}
                      </div>
                    );
                  }}
                </Async>
              </aside>
            </div>
          </>
        )}
      </Async>
    </div>
  );
}
