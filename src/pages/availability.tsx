import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import { Async, B, Btn, Card, Empty, Note, Page, SecH, Switch, Tag } from "../ui";
import { useStore } from "../store";
import type { ScheduleOverride, TimeRange, WeeklyBlock } from "../lib/types";
import { SESSION_SLOT_MINUTES } from "../lib/scheduling";

/**
 * A dermatologist's booking calendar.
 *
 * Two layers, and the distinction is the whole design:
 *
 *   the week      the pattern they normally sit — "Tuesdays, 10:00–13:00"
 *   a named date  one day that breaks the pattern, which always wins
 *
 * Slots themselves are never edited here. The server cuts fixed one-hour
 * sessions from these ranges at read time, so no per-slot rows are stored.
 *
 * Whatever is saved here is exactly what the app offers patients — there is no
 * second copy of this anywhere.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

const SEL = "w-full rounded-lg border border-border bg-ivory px-2.5 py-2 text-[13px] outline-none focus:border-gold-dark disabled:text-ink3";
const SEL_SM = "rounded-lg border border-border bg-ivory px-2 py-1 text-[11px] outline-none focus:border-gold-dark";

/** "2026-08-14" for a Date, in local time — never toISOString(). */
function key(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromKey(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const prettyDate = (k: string) =>
  fromKey(k).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

/* -------------------------------------------------------------------------
 * Time range editor — one row per block of clinic time
 * ---------------------------------------------------------------------- */

function Ranges({
  ranges,
  onChange,
  disabled,
}: {
  ranges: TimeRange[];
  onChange: (next: TimeRange[]) => void;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<TimeRange>) =>
    onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const input = "rounded-lg border px-2 py-1.5 text-[12.5px] outline-none focus:border-gold-dark disabled:bg-ivory disabled:text-ink3";

  return (
    <div className="space-y-2">
      {ranges.map((r, i) => {
        // Flagged inline rather than only on save: a backwards range produces
        // no slots, which reads as "the save didn't work" instead of a typo.
        const invalid = !!r.start && !!r.end && r.end <= r.start;
        return (
          <div key={i} className="flex items-center gap-2">
            <input type="time" value={r.start} disabled={disabled}
              onChange={(e) => set(i, { start: e.target.value })}
              className={`${input} border-border bg-surface`} />
            <span className="text-ink3">–</span>
            <input type="time" value={r.end} disabled={disabled}
              onChange={(e) => set(i, { end: e.target.value })}
              className={`${input} ${invalid ? "border-err bg-err-bg" : "border-border bg-surface"}`} />
            {invalid && <span className="text-[11px] font-semibold text-err">end must be after start</span>}
            {!disabled && (
              <button onClick={() => onChange(ranges.filter((_, j) => j !== i))}
                className="ml-auto rounded-lg px-2 py-1 text-[11px] font-semibold text-ink3 hover:bg-ivory hover:text-err">
                Remove
              </button>
            )}
          </div>
        );
      })}

      {!disabled && (
        <button onClick={() => onChange([...ranges, { start: "10:00", end: "13:00" }])}
          className="text-[11.5px] font-bold text-primary hover:underline">
          + Add hours
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------- */

/**
 * Named `Schedule`, not `Availability` — the existing Availability page is
 * about which *centres* a dermatologist works at. This is about *when*. Two
 * different questions, and collapsing them into one name is how you end up
 * editing the wrong screen.
 *
 * `doctorId` is optional so an admin can open someone else's calendar; with
 * nothing passed it resolves to the signed-in dermatologist.
 */
export function Schedule({ doctorId: forced }: { doctorId?: string } = {}) {
  const me = useMyDoctor();
  const { branches, admin, toast } = useStore();
  const doctorId = forced ?? me.data?.doctorId ?? "";
  const [resetting, setResetting] = useState(false);

  const [saved, setSaved] = useState(false);
  // Re-read after a save, otherwise the page shows the pre-save schedule.
  const loaded = useApi(
    () => (doctorId ? api.schedules.get(doctorId) : Promise.resolve(null)),
    [doctorId, saved],
  );
  const branchName = (id?: string | null) => branches.find((b) => b._id === id)?.name ?? "Any centre";

  const [draft, setDraft] = useState<{
    slotMinutes: number;
    leadTimeHours: number;
    horizonDays: number;
    isActive: boolean;
    weekly: WeeklyBlock[];
    overrides: ScheduleOverride[];
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [openDate, setOpenDate] = useState<string | null>(null);

  // The draft is seeded from the server on first render and owned locally
  // after that, so typing never fights an in-flight refetch.
  const s = draft ?? (loaded.data ? {
    slotMinutes: SESSION_SLOT_MINUTES,
    leadTimeHours: loaded.data.schedule.leadTimeHours ?? 4,
    horizonDays: loaded.data.schedule.horizonDays ?? 60,
    isActive: loaded.data.schedule.isActive ?? true,
    weekly: loaded.data.schedule.weekly ?? [],
    overrides: loaded.data.schedule.overrides ?? [],
  } : null);

  const canEdit = loaded.data?.canEdit ?? false;

  // Centre choices are the dermatologist's assigned centres, nothing else —
  // assignment itself is admin-only, done from the admin panel.
  const myCentres = loaded.data?.dermatologist.availableCentres ?? [];
  const centreBranches = branches.filter((b) => myCentres.includes(b.name));
  const patch = (p: Partial<NonNullable<typeof s>>) => s && setDraft({ ...s, ...p });

  /** Free/booked counts for the month on screen. */
  const monthRange = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return { from: key(first), to: key(last) };
  }, [month]);

  const days = useApi(
    () => api.schedules.days(doctorId, monthRange.from, monthRange.to),
    [doctorId, monthRange.from, monthRange.to, saved],
  );

  const dayMap = useMemo(() => {
    const m = new Map<string, { free: number; total: number }>();
    (days.data?.days ?? []).forEach((d) => m.set(d.date, { free: d.free, total: d.total }));
    return m;
  }, [days.data]);

  const slots = useApi(
    () => (openDate ? api.schedules.slots(doctorId, openDate) : Promise.resolve(null)),
    [doctorId, openDate, saved],
  );

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      await api.schedules.save(doctorId, {
        ...s,
        slotMinutes: SESSION_SLOT_MINUTES,
      });
      setSaved((v) => !v); // re-reads the calendar and the open day
      setDraft(null);
    } catch (e) {
      // The server lists every bad range; show them, not just "Invalid schedule".
      const err = e as Error & { payload?: { errors?: string[] } };
      const details = err.payload?.errors?.length ? ` — ${err.payload.errors.join("; ")}` : "";
      setError((err.message || "Could not save") + details);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Load the centres' opening hours into the editor as a draft. Nothing is
   * saved until Save & publish, so a wrong reset is one click to abandon.
   */
  const resetToCentreHours = async () => {
    if (!s) return;
    setResetting(true);
    setError(null);
    try {
      const d = await api.schedules.defaultWeek(doctorId);
      if (!d.weekly.length) {
        setError("Your centres have no usable opening hours to copy — ask the clinic admin to set them under Branches.");
        return;
      }
      patch({ weekly: d.weekly });
      toast(`Centre hours loaded from ${d.centres.join(", ") || "your centres"} — review and Save & publish`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const hasBadRange = !!s && [...s.weekly.flatMap((w) => w.ranges), ...s.overrides.flatMap((o) => o.ranges ?? [])]
    .some((r) => r.start && r.end && r.end <= r.start);

  const weekFor = (day: number) => s?.weekly.find((w) => w.day === day);

  const setWeek = (day: number, ranges: TimeRange[], branchId?: string | null) => {
    if (!s) return;
    const prev = weekFor(day);
    const rest = s.weekly.filter((w) => w.day !== day);
    // No ranges means "not working that day", which is the absence of a row
    // rather than a row saying nothing.
    patch({ weekly: ranges.length ? [...rest, { day, branchId: branchId === undefined ? (prev?.branchId ?? null) : branchId, ranges }] : rest });
  };

  const overrideFor = (date: string) => s?.overrides.find((o) => o.date === date);

  const setOverride = (date: string, next: ScheduleOverride | null) => {
    if (!s) return;
    const rest = s.overrides.filter((o) => o.date !== date);
    patch({ overrides: next ? [...rest, next] : rest });
  };

  /** Leading blanks so the 1st lands under the right weekday. */
  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= total; d++) cells.push(key(new Date(month.getFullYear(), month.getMonth(), d)));
    return cells;
  }, [month]);

  const dirty = draft !== null;

  if (!doctorId) {
    return me.initial && !forced
      ? <Async q={me}>{() => null}</Async>
      : <NoProfileNote email={admin?.email} />;
  }

  return (
    <Async q={loaded}>
      {() =>
        !s ? (
          <Empty title="No schedule to show" hint={loaded.error ?? "This dermatologist could not be loaded."} />
        ) : (
          <Page
            title={forced ? (loaded.data?.dermatologist.name ?? "Working hours") : "My schedule"}
            sub="Your usual week plus date-specific changes — exactly what patients can book in the app"
            actions={canEdit ? (
              <>
                {dirty && !error && <Tag kind="warn">unsaved changes</Tag>}
                <Btn kind="gold" disabled={saving || !dirty || hasBadRange} onClick={save}>
                  {saving ? "Saving…" : "Save & publish"}
                </Btn>
              </>
            ) : undefined}>

            {error && <Note kind="crit" className="mb-3">{error}</Note>}
            {hasBadRange && <Note kind="crit" className="mb-3">A time range ends before it starts — fix it to save.</Note>}
            {loaded.data?.schedule.configured === false && (
              <Note kind="crit" className="mb-3">
                <B>No working hours yet.</B> Until a week is saved here, this dermatologist shows no bookable
                slots in the app or at reception.
              </Note>
            )}
            {loaded.data?.schedule.seededFromBranchHours && (
              <Note className="mb-3">
                <B>Pre-set from the centres&rsquo; opening hours.</B> This week was filled in automatically when
                the centres were assigned, and bookings are already live on it. Keep it as it is, or adjust
                any day and <B>Save &amp; publish</B> to make the week your own.
              </Note>
            )}
            {!canEdit && (
              <Note className="mb-3">You can view this calendar, but only its owner or an admin can change it.</Note>
            )}

            <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_390px]">
              {/* ------------------------- the normal week ------------------ */}
              <Card className="min-w-0 p-4">
                <SecH t="Your usual week" em="· days without hours are not bookable"
                  right={canEdit ? (
                    <button onClick={resetToCentreHours} disabled={resetting}
                      title="Replace the week below with your centres' opening days and hours — saved only when you publish"
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-ink2 hover:border-gold-dark hover:text-ink disabled:opacity-50">
                      {resetting ? "Loading…" : "↺ Reset to centre hours"}
                    </button>
                  ) : undefined} />
                <div>
                  {DAYS.map((name, day) => {
                    const block = weekFor(day);
                    const on = !!block?.ranges.length;
                    return (
                      <div key={day} className="flex flex-col gap-2 border-b border-border py-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:gap-5">
                        <button type="button" disabled={!canEdit}
                          onClick={() => setWeek(day, on ? [] : [{ start: "10:00", end: "13:00" }])}
                          className="flex w-40 shrink-0 items-center gap-2.5 text-left disabled:cursor-default">
                          <span className={`relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-border"}`}>
                            <span className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[16px]" : "left-[2px]"}`} />
                          </span>
                          <span className={`text-[13px] ${on ? "font-bold text-ink" : "font-medium text-ink3"}`}>{name}</span>
                        </button>

                        {on ? (
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <Ranges ranges={block!.ranges} disabled={!canEdit} onChange={(next) => setWeek(day, next)} />
                            {centreBranches.length > 1 ? (
                              <label className="flex items-center gap-2 text-[11px] text-ink3">
                                at
                                <select value={block?.branchId ?? ""} disabled={!canEdit}
                                  onChange={(e) => setWeek(day, block!.ranges, e.target.value || null)}
                                  className={SEL_SM}>
                                  <option value="">Any of my centres</option>
                                  {centreBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                                </select>
                              </label>
                            ) : centreBranches.length === 1 ? (
                              <div className="text-[11px] text-ink3">at {centreBranches[0].name}</div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="pt-0.5 text-[12.5px] text-ink3">Not working</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <div className="grid gap-3.5">
                {/* ---------------------------- rules ---------------------- */}
                <Card className="p-4">
                  <SecH t="Booking rules" />
                  <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="text-[12px]">
                        <span className="mb-1 block font-bold text-ink2">Notice needed</span>
                        <select value={s.leadTimeHours} disabled={!canEdit}
                          onChange={(e) => patch({ leadTimeHours: Number(e.target.value) })} className={SEL}>
                          {[0, 1, 2, 4, 8, 12, 24, 48].map((n) => (
                            <option key={n} value={n}>{n === 0 ? "None" : `${n} hours`}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[12px]">
                        <span className="mb-1 block font-bold text-ink2">Book up to</span>
                        <select value={s.horizonDays} disabled={!canEdit}
                          onChange={(e) => patch({ horizonDays: Number(e.target.value) })} className={SEL}>
                          {[14, 30, 45, 60, 90, 180].map((n) => (
                            <option key={n} value={n}>{n} days ahead</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Switch on={s.isActive} onChange={(v) => canEdit && patch({ isActive: v })}
                      label="Accepting bookings" sub="Off hides every slot in the app without touching your hours" />
                    <div className="text-[11px] text-ink3">Appointments are fixed at {SESSION_SLOT_MINUTES} minutes across the clinic.</div>
                  </div>
                </Card>

                {/* --------------------------- the month ---------------------- */}
                <Card className="p-4">
                  <SecH t="Specific dates" em="· leave & one-off hours"
                    right={
                      <div className="flex items-center gap-1">
                        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                          aria-label="Previous month"
                          className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-ivory hover:text-ink">‹</button>
                        <span className="w-32 text-center text-[12px] font-bold">
                          {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                        </span>
                        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                          aria-label="Next month"
                          className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-ivory hover:text-ink">›</button>
                      </div>
                    } />

                  <div className="grid grid-cols-7 gap-1 text-center">
                    {DAY_SHORT.map((d, i) => (
                      <div key={i} className="pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink3">{d}</div>
                    ))}

                    {grid.map((k, i) => {
                      if (!k) return <div key={`b${i}`} />;
                      const info = dayMap.get(k);
                      const ov = overrideFor(k);
                      const isOff = ov?.unavailable;
                      const custom = !!ov?.ranges?.length;
                      const free = info?.free ?? 0;

                      return (
                        <button key={k} onClick={() => setOpenDate(openDate === k ? null : k)}
                          className={[
                            "relative rounded-lg border py-1.5 text-[12.5px] transition-colors",
                            openDate === k ? "border-gold-dark bg-cream font-bold" : "border-transparent hover:border-border",
                            isOff ? "text-err line-through" : free > 0 ? "text-ink" : "text-ink3",
                          ].join(" ")}>
                          {fromKey(k).getDate()}
                          {/* Free count, so a day that looks open but is fully
                              booked is distinguishable at a glance. */}
                          {!isOff && info && info.total > 0 && (
                            <span className={`block text-[9px] leading-tight ${free > 0 ? "text-ok" : "text-ink3"}`}>{free} free</span>
                          )}
                          {custom && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-gold" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* ------------------------ one open date ------------------- */}
                  {openDate && (
                    <div className="mt-4 rounded-xl border border-border bg-ivory p-3.5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[13px] font-extrabold">{prettyDate(openDate)}</div>
                        {canEdit && (
                          <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => setOverride(openDate, { date: openDate, unavailable: true, note: "" })}
                              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold hover:border-err hover:text-err">
                              Mark unavailable
                            </button>
                            <button
                              onClick={() =>
                                setOverride(openDate, {
                                  date: openDate,
                                  unavailable: false,
                                  ranges: overrideFor(openDate)?.ranges?.length
                                    ? overrideFor(openDate)!.ranges
                                    : [{ start: "10:00", end: "13:00" }],
                                })
                              }
                              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold hover:border-gold-dark">
                              Different hours
                            </button>
                            {overrideFor(openDate) && (
                              <button onClick={() => setOverride(openDate, null)}
                                className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-ink3 hover:bg-surface">
                                Back to usual
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {overrideFor(openDate)?.unavailable && (
                        <p className="mb-3 text-[12.5px] font-semibold text-err">
                          On leave — no bookings offered on this date.
                        </p>
                      )}

                      {overrideFor(openDate) && (
                        <div className="mb-3 grid gap-2">
                          <input type="text" value={overrideFor(openDate)?.note ?? ""} disabled={!canEdit} maxLength={200}
                            placeholder="Reason (leave, conference, half day…) — staff only"
                            onChange={(e) => setOverride(openDate, { ...overrideFor(openDate)!, note: e.target.value })}
                            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
                          {!overrideFor(openDate)?.unavailable && centreBranches.length > 1 && (
                            <select value={overrideFor(openDate)?.branchId ?? ""} disabled={!canEdit}
                              onChange={(e) => setOverride(openDate, { ...overrideFor(openDate)!, branchId: e.target.value || null })}
                              className={SEL_SM}>
                              <option value="">Any of my centres</option>
                              {centreBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                            </select>
                          )}
                        </div>
                      )}

                      {!!overrideFor(openDate)?.ranges?.length && !overrideFor(openDate)?.unavailable && (
                        <div className="mb-3">
                          <p className="mb-2 text-[11px] font-bold text-ink2">Hours for this date only</p>
                          <Ranges ranges={overrideFor(openDate)!.ranges!} disabled={!canEdit}
                            onChange={(next) => setOverride(openDate, { ...overrideFor(openDate)!, ranges: next })} />
                        </div>
                      )}

                      {/* Saved state, not the draft — a slot cannot be shown as
                          booked against hours that have not been saved yet. */}
                      {dirty ? (
                        <p className="text-[12px] text-ink3">Save to see how this date looks to patients.</p>
                      ) : (
                        <Async q={slots}>
                          {(d) =>
                            !d || !d.slots.length ? (
                              <p className="text-[12px] text-ink3">No bookable times on this date.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {d.slots.map((slot) => (
                                  <span key={slot.time}
                                    className={[
                                      "rounded-lg border px-2.5 py-1 text-[11px]",
                                      slot.booked
                                        ? "border-border bg-surface text-ink3 line-through"
                                        : slot.tooSoon
                                          ? "border-border bg-surface text-dis"
                                          : "border-ok bg-ok-bg font-semibold text-ok",
                                    ].join(" ")}
                                    title={slot.booked ? "Booked" : slot.tooSoon ? "Too soon to book" : "Free"}>
                                    {slot.label}
                                  </span>
                                ))}
                              </div>
                            )
                          }
                        </Async>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </Page>
        )
      }
    </Async>
  );
}


/** Shown when a panel login has no matching Doctor profile. */
function NoProfileNote({ email }: { email?: string }) {
  return (
    <Empty
      title="No dermatologist profile is linked to this login"
      hint={`Ask an admin to open Care → Dermatologists and set the profile's email to ${email ?? "your address"} (or link it under Staff & roles). Until then there is no calendar to show.`}
    />
  );
}
