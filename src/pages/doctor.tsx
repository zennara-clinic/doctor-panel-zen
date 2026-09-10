import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  Page, Btn, Tag, Stats, Card, B, Note, In, Area, SecH, Modal, AreaChart, ChartCard, HBars, Async, Empty, Loading,
  UploadField, Segmented,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import StockPill from "../stock-pill";
export { default as StockPill } from "../stock-pill";
import { useApi, useDebounced } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import { NoProfile } from "../visit";
import {
  addClinicDays, bookingServiceName, clinicMonthStart, clinicWeekday, dayKeyDate, fmtDayKey, fmtINR, fmtWhen, initials, isoDay, pct,
} from "../lib/format";
import type { Doctor } from "../lib/types";

/*
 * The dermatologist's own pages: insights, profile and fee, product
 * availability. Today, the consultation and patients live in their own files.
 */

/* ================= MY MONTH ================= */
export function MyMonth() {
  const { admin } = useStore();
  const me = useMyDoctor();

  const q = useApi(async () => {
    if (!me.data) return null;
    const today = isoDay();
    const currentStart = clinicMonthStart(today);
    const previousEnd = addClinicDays(currentStart, -1);
    const previousStart = clinicMonthStart(previousEnd);
    const res = await api.bookings.list({ specialistId: me.data.doctorId, startDate: previousStart });
    const mine = (res.data ?? []).filter(
      (b) => !b.specialistId || b.specialistId === me.data!.doctorId || b.specialistName === me.data!.name,
    );

    const inMonth = mine.filter((b) => isoDay(new Date(b.confirmedDate || b.preferredDate)) >= currentStart);
    const prevMonth = mine.filter((b) => {
      const day = isoDay(new Date(b.confirmedDate || b.preferredDate));
      return day >= previousStart && day < currentStart;
    });

    // 12-month trend of completed consultations.
    const trend: { label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const startDate = dayKeyDate(currentStart);
      startDate.setUTCMonth(startDate.getUTCMonth() - i, 1);
      const start = isoDay(startDate);
      const endDate = new Date(startDate);
      endDate.setUTCMonth(endDate.getUTCMonth() + 1, 1);
      const end = isoDay(endDate);
      trend.push({
        label: fmtDayKey(start, { month: "short", year: "2-digit" }),
        count: mine.filter((b) => {
          const day = isoDay(new Date(b.confirmedDate || b.preferredDate));
          return day >= start && day < end && b.status === "Completed";
        }).length,
      });
    }

    const byService = new Map<string, number>();
    for (const b of inMonth) {
      const n = bookingServiceName(b, "Other");
      byService.set(n, (byService.get(n) ?? 0) + 1);
    }

    // Weekday load and outcome mix — same month, two more angles on it.
    const byWeekday = [0, 0, 0, 0, 0, 0, 0];
    const byStatus = new Map<string, number>();
    for (const b of inMonth) {
      byWeekday[clinicWeekday(isoDay(new Date(b.confirmedDate || b.preferredDate)))] += 1;
      byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
    }

    const notes = await api.consultationNotes.list({ doctorId: me.data.doctorId, limit: 300 })
      .then((r) => r.data ?? []).catch(() => []);
    const assignedFromNotes = notes.filter(
      (n) => (n.assignedServices ?? []).length > 0 && isoDay(new Date(n.createdAt ?? 0)) >= currentStart,
    ).length;

    return { mine, inMonth, prevMonth, trend, byService, byWeekday, byStatus, notes, assignedFromNotes };
  }, [me.data?._id]);

  return (
    <Page eyebrow="Your workload" title="Insights" sub={me.data ? `${me.data.name} · ${fmtDayKey(isoDay(), { month: "long", year: "numeric" })}` : ""}>
      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <Async q={q} label="Adding up your month…" rows={5}>
            {(d) => !d ? <Empty title="No data yet" /> : (() => {
              const completed = d.inMonth.filter((b) => b.status === "Completed").length;
              const prevCompleted = d.prevMonth.filter((b) => b.status === "Completed").length;
              const delta = completed - prevCompleted;
              const noShows = d.inMonth.filter((b) => b.status === "No Show").length;
              const conversion = completed ? (d.assignedFromNotes / completed) * 100 : 0;
              const rated = d.mine.filter((b) => typeof b.rating === "number");
              const avgRating = rated.length ? rated.reduce((n, b) => n + (b.rating ?? 0), 0) / rated.length : null;

              return (
                <>
                  <Stats items={[
                    { k: "Booked", v: d.inMonth.length, d: `${completed} completed` },
                    { k: "vs last month", v: `${delta >= 0 ? "+" : ""}${delta}`, d: `${prevCompleted} completed then`, tone: delta >= 0 ? "up" : "dn" },
                    { k: "→ treatment", v: pct(conversion), d: "consults that assigned something", hot: true },
                    { k: "No-shows", v: noShows, d: d.inMonth.length ? pct((noShows / d.inMonth.length) * 100) : "—", tone: noShows ? "dn" : undefined },
                    { k: "Notes signed", v: d.notes.filter((n) => n.status === "Completed").length, d: `${d.notes.filter((n) => n.status === "Draft").length} still draft` },
                    { k: "Rating", v: avgRating ? avgRating.toFixed(1) : "—", d: `${rated.length} rated visits` },
                  ]} />

                  <div className="grid gap-3 xl:grid-cols-2">
                    <ChartCard title="Completed consultations" sub="Last 12 months" hero={String(completed)}
                      heroTone={delta > 0 ? `+${delta} on last month` : undefined}>
                      {d.trend.some((t) => t.count > 0)
                        ? <AreaChart pts={d.trend.map((t) => t.count)} labels={d.trend.map((t) => t.label)} label="Consultations" />
                        : <Empty title="No completed consultations yet" hint="Your first completed month will draw the trend line here." />}
                    </ChartCard>
                    <ChartCard title="What you saw most" sub="This month, by service">
                      {d.byService.size
                        ? <HBars rows={[...d.byService.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => [n, c] as [string, number])} />
                        : <Empty title="Nothing booked this month" />}
                    </ChartCard>
                    <ChartCard title="Busiest days" sub="This month, bookings by weekday">
                      {d.inMonth.length
                        ? <HBars rows={[1, 2, 3, 4, 5, 6, 0].map((day) =>
                            [["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day], d.byWeekday[day]] as [string, number])} />
                        : <Empty title="Nothing booked this month" />}
                    </ChartCard>
                    <ChartCard title="Visit outcomes" sub="This month, by status">
                      {d.byStatus.size
                        ? <HBars rows={[...d.byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, c] as [string, number])} />
                        : <Empty title="Nothing booked this month" />}
                    </ChartCard>
                  </div>

                  <Note className="mt-3">
                    This is your own view — clinic revenue stays with admin. What you see here is workload, conversion
                    and how guests rated the visits.
                  </Note>
                </>
              );
            })()}
          </Async>
        )}
      </Async>
    </Page>
  );
}


/* ---------- the doctor's own fee, and requesting a change ---------- */
function MyFeeCard() {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useApi(() => api.feeRequests.myFee(), []);
  const history = useApi(() => api.feeRequests.list({ mine: "true", limit: 20 }), []);
  const me = q.data;
  const past = (history.data?.data ?? []).filter((r) => r.status !== "Pending");

  useEffect(() => {
    if (!open) return;
    setAmount(me?.effectiveFee ? String(me.effectiveFee) : "");
    setReason("");
    setErr(null);
  }, [open, me?.effectiveFee]);

  const submit = async () => {
    setErr(null);
    const value = Number(amount);
    if (!value || value <= 0) return setErr("Enter the fee you would like to charge");
    if (reason.trim().length < 10) return setErr("Give the admin a reason — at least 10 characters");
    setBusy(true);
    try {
      await api.feeRequests.create({ requestedFee: value, reason: reason.trim() });
      toast("Request sent — an admin will review it");
      setOpen(false);
      q.reload(); history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (q.initial && !me) return <Loading label="Loading your fee…" rows={2} />;
  if (!me?.linked) {
    return (
      <Note className="my-0 text-[11.5px]">
        No dermatologist profile is linked to this login yet, so there is no fee to manage.
      </Note>
    );
  }

  const pending = me.pendingRequest;

  return (
    <>
      <Card className="p-4">
        <div className="text-[22px] font-bold tabular-nums">{fmtINR(me.effectiveFee)}</div>
        <div className="mt-0.5 text-[11.5px] text-ink3">
          {me.hasOverride
            ? `Your approved rate · the standard fee for your tier is ${fmtINR(me.standardFee)}`
            : "The clinic's standard fee for your tier"}
        </div>

        {pending ? (
          <>
            <Note className="mb-0 mt-3 text-[11.5px]">
              <B>Request pending.</B> You asked for {fmtINR(pending.requestedFee)} on{" "}
              {fmtWhen(pending.createdAt)}. An admin will review it.
            </Note>
            <Btn kind="ghost" className="mt-2 w-full" onClick={async () => {
              try {
                await api.feeRequests.withdraw(pending._id);
                toast("Request withdrawn"); q.reload(); history.reload();
              } catch (e) { toast((e as Error).message); }
            }}>Withdraw request</Btn>
          </>
        ) : (
          <Btn kind="gold" className="mt-3 w-full" onClick={() => setOpen(true)}>Request a fee change</Btn>
        )}

        {past.length > 0 && (
          <>
            <SecH t="Past requests" />
            <div className="grid gap-1.5">
              {past.slice(0, 4).map((r) => (
                <div key={r._id} className="rounded-lg bg-ivory px-2.5 py-2 text-[11.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span>{fmtINR(r.currentFee)} → {fmtINR(r.requestedFee)}</span>
                    {r.status === "Approved"
                      ? <Tag kind="ok">Approved{r.approvedFee !== r.requestedFee ? ` at ${fmtINR(r.approvedFee ?? 0)}` : ""}</Tag>
                      : r.status === "Rejected" ? <Tag kind="err">Rejected</Tag> : <Tag kind="mute">{r.status}</Tag>}
                  </div>
                  {r.reviewNote && <div className="mt-1 text-ink3">“{r.reviewNote}”</div>}
                  <div className="mt-0.5 font-mono text-[10px] text-ink3">{fmtWhen(r.decidedAt ?? r.createdAt)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request a fee change">
        <Note className="mt-0">
          You cannot change your own fee. This sends a request to an admin, who can approve it as asked,
          approve a different amount, or decline with a reason.
        </Note>
        <div className="grid gap-3">
          <In label="Fee you would like to charge (₹)" type="number" value={amount} onChange={setAmount}
            hint={`You currently charge ${fmtINR(me.effectiveFee)}${me.hasOverride ? "" : ` (the standard fee)`}.`} />
          <Area label="Why? (the admin reads this)" value={reason} onChange={setReason} rows={4}
            placeholder="e.g. additional fellowship completed, longer consultation slots, demand at this centre…" />
        </div>
        {err && <Note kind="crit">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send request"}</Btn>
        </div>
      </Modal>
    </>
  );
}

/* ================= MY PROFILE ================= */
/** Chip editor — click a chip to remove it, type and press Enter to add one. */
function ChipList({ label, em, values, onChange, placeholder }: {
  label: string; em?: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <SecH t={label} em={em} />
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((e, i) => (
          <button key={`${e}${i}`} type="button" title="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="rounded-full bg-sage px-2.5 py-1 text-[11px] font-semibold text-secondary hover:bg-err-bg hover:text-err">{e} ×</button>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={placeholder ?? "+ type & press Enter"}
          className="w-60 max-w-full rounded-full border border-dashed border-border bg-surface px-2.5 py-1 text-[11px] outline-none focus:border-gold-dark" />
      </div>
    </div>
  );
}

/**
 * Login email and phone — the account, as distinct from the app card. There is
 * no password: sign-in is a one-time code emailed to this address, so changing
 * the address is what changes how you sign in.
 */
function AccountSecurity() {
  const { toast } = useStore();
  const acct = useApi(() => api.auth.me(), []);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (acct.data) { setEmail(acct.data.email); setPhone(acct.data.phone ?? ""); }
  }, [acct.data]);

  const emailChanged = !!acct.data && email.trim().toLowerCase() !== acct.data.email;
  const phoneChanged = !!acct.data && (phone.trim() || "") !== (acct.data.phone ?? "");

  const save = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr("Enter a valid email address"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.auth.updateContact({ email: email.trim().toLowerCase(), phone: phone.trim() });
      toast(emailChanged ? `Saved — sign-in codes now go to ${r.email}` : "Saved");
      acct.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card className="grid gap-2.5 p-3.5">
      <In label="Login email" type="email" value={email} onChange={setEmail}
        hint="Your sign-in code is emailed to this address" />
      <In label="Phone" value={phone} onChange={setPhone} hint="Staff contact only — never shown in the app" />
      {(emailChanged || phoneChanged) && (
        <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Btn>
      )}
      <div className="rounded-xl border border-border bg-ivory px-3.5 py-2.5 text-[11px] text-ink3">
        You sign in with a 6-digit code sent to your email each time. There is no password to remember or reset.
      </div>
      {err && <Note kind="crit" className="mb-0">{err}</Note>}
    </Card>
  );
}

export function DoctorProfile() {
  const { toast, audit, admin } = useStore();
  const me = useMyDoctor();
  const [f, setF] = useState<Partial<Doctor>>({});
  const [prevOpen, setPrevOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const tiers = useApi(() => api.doctors.tiers().catch(() => []), []);

  useEffect(() => { if (me.data) { setF(me.data); setDirty(false); } }, [me.data?._id]);

  const set = <K extends keyof Doctor>(k: K) => (v: Doctor[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  // Typed-but-unsaved edits only live in this tab — warn before they are lost.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const tierFee = tiers.data?.find((t) => t.id === f.tier)?.fee ?? 0;
  const shownFee = f.fee || tierFee;

  const publish = async () => {
    if (!me.data) return;
    setBusy(true); setErr(null);
    try {
      // The tier and its fee are admin-owned; a doctor edits their identity.
      // The clinic owns designation, fee/tier and centres — the server strips
      // them from a dermatologist's own update, so they are not sent at all.
      await api.doctors.update(me.data._id, {
        name: f.name?.trim() || me.data.name, photo: f.photo,
        experienceYears: Number(f.experienceYears) || 0,
        experienceNote: f.experienceNote, qualifications: f.qualifications, expertise: f.expertise,
        achievements: f.achievements, phone: f.phone,
      });
      audit("DOCTOR_UPDATED", `${me.data.name} updated their app profile`, { doctorId: me.data.doctorId });
      toast("Saved — your app card is live");
      setPrevOpen(false);
      setDirty(false);
      me.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title="My profile" sub="What guests see on the app's dermatologist card"
      actions={<>
        {dirty && <Tag kind="warn">unsaved changes</Tag>}
        <Btn kind="ghost" onClick={() => setPrevOpen(true)} disabled={!me.data}>Preview</Btn>
        <Btn kind="gold" onClick={publish} disabled={!me.data || busy || !dirty}>{busy ? "Saving…" : "Save & publish"}</Btn>
      </>}>
      {err && <Note kind="crit" className="mb-3">{err}</Note>}
      <Async q={me} label="Loading your profile…" rows={5}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="p-4">
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] font-bold text-ink2">Profile photo</div>
                <div className="flex items-center gap-4">
                  {f.photo
                    ? <img src={f.photo} alt="" className="h-32 w-32 rounded-full border-2 border-gold-dark object-cover" />
                    : <span className="grid h-32 w-32 place-items-center rounded-full border-2 border-border bg-sage-2 text-[34px] font-extrabold text-primary">
                        {initials(doctor.name)}
                      </span>}
                  <div className="grid flex-1 gap-2">
                    <UploadField label="Photo" value={f.photo ?? ""} onChange={set("photo")} preview={false}
                      upload={(file) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "")} />
                    {f.photo && (
                      <button onClick={() => set("photo")(null)} className="text-left text-[12px] font-semibold text-err">
                        Remove — back to initials
                      </button>
                    )}
                    <div className="max-w-[280px] text-[11px] leading-relaxed text-ink3">
                      Square image, at least <B>400 × 400 px</B>. Shown as a circle — face centred, plain background
                      works best. Upload straight from here, or paste a URL.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <In label="Display name" value={f.name ?? ""} onChange={set("name")}
                  hint="Shown on your app card exactly as typed here" />
                <In label="Designation" value={doctor.designation ?? ""} onChange={() => {}} readOnly
                  hint="Set by the clinic with your consultation tier — ask admin to change it" />
                <In label="Years of experience" type="number" value={String(f.experienceYears ?? 0)}
                  onChange={(v) => set("experienceYears")(Number(v) || 0)} />
                <In label="Consultation fee" value={fmtINR(shownFee)} onChange={() => {}} readOnly
                  hint="The clinic sets this. Use “My fee” below to request a change." />
                <In label="Contact phone" value={f.phone ?? ""} onChange={set("phone")}
                  hint="Clinic contact only — never shown in the app" />
                <In label="Centres" value={(doctor.availableCentres ?? []).join(", ") || "none set"} onChange={() => {}} readOnly
                  hint="Assigned by the clinic admin" />
              </div>

              <div className="mt-3 grid gap-3">
                <Area label="About you — shown on your app card" value={f.experienceNote ?? ""}
                  onChange={set("experienceNote")} rows={3} />
              </div>

              <div className="mt-4 grid gap-4">
                <ChipList label="Qualifications" em="· shown on the app card" values={f.qualifications ?? []}
                  onChange={set("qualifications")} placeholder="+ e.g. MD (Dermatology) — Enter to add" />
                <ChipList label="Expertise" em="· shown on the app card" values={f.expertise ?? []}
                  onChange={set("expertise")} placeholder="+ e.g. Acne & acne scars — Enter to add" />
                <ChipList label="Achievements" em="· optional" values={f.achievements ?? []}
                  onChange={set("achievements")} placeholder="+ e.g. 10,000+ procedures — Enter to add" />
              </div>
            </Card>

            <div className="grid gap-2">
              <SecH t="My fee" />
              <MyFeeCard />

              <SecH t="Account & security" />
              <AccountSecurity />

              <SecH t="Visibility" />
              <div className="flex items-center justify-between rounded-xl border border-border bg-ivory px-3.5 py-2.5">
                <div><div className="text-[12.5px] font-bold">Listed in the app</div><div className="text-[11px] text-ink3">Only an admin can change this — ask them if you need to come off the list</div></div>
                <Tag kind={doctor.isActive ? "ok" : "mute"}>{doctor.isActive ? "Listed" : "Hidden"}</Tag>
              </div>
              <Note className="text-[11.5px]">
                Availability lives in <B>My availability</B>. This page is your identity as guests see it,
                and every publish is audited.
              </Note>
              {err && <Note kind="crit">{err}</Note>}
            </div>
          </div>
        )}
      </Async>

      <Modal open={prevOpen} onClose={() => setPrevOpen(false)} title="This is how your card will look">
        <div className="rounded-2xl border border-border bg-ivory p-4">
          <div className="flex items-start gap-3">
            {f.photo
              ? <img src={f.photo} alt="" className="h-14 w-14 rounded-full border border-gold-dark object-cover" />
              : <span className="grid h-14 w-14 place-items-center rounded-full bg-sage-2 text-[16px] font-extrabold text-primary">
                  {initials(me.data?.name)}
                </span>}
            <div>
              <b className="text-[14.5px] font-bold">{f.name || me.data?.name}</b>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-gold-dark">{f.designation}</div>
              <div className="mt-0.5 text-[11px] text-ink3">
                {f.experienceYears ? `${f.experienceYears} yrs` : ""}{shownFee ? ` · ${fmtINR(shownFee)}` : ""}
              </div>
            </div>
          </div>
          {f.experienceNote && <div className="mt-2 text-[12px] text-ink2">{f.experienceNote}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {(f.expertise ?? []).slice(0, 6).map((e, i) => (
              <span key={`${e}${i}`} className="rounded-full bg-sage px-2 py-0.5 text-[10px] font-semibold text-secondary">{e}</span>
            ))}
            {(f.expertise?.length ?? 0) > 6 && <span className="text-[10px] text-ink3">+{f.expertise!.length - 6} more</span>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setPrevOpen(false)}>Keep editing</Btn>
          <Btn kind="gold" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Publish to app"}</Btn>
        </div>
      </Modal>
      
    </Page>
  );
}

/**
 * Product availability — "can I recommend this, and is it here today?".
 * No price column, no vendor, no purchase history: the endpoint does not
 * return them at all.
 */
export function ProductStock() {
  const { branchId } = useStore();
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [status, setStatus] = useState<"" | "in_stock" | "available" | "low_stock" | "out_of_stock">("");
  const rows = useApi(
    () => api.productAvailability
      .list({ ...(search.trim() ? { search: search.trim() } : {}), ...(branchId ? { branchId } : {}), ...(status ? { status } : {}) })
      .then((r) => r.data ?? []),
    [search, branchId, status],
  );

  return (
    <Page eyebrow="At your centre" title="Products" sub="What you can recommend today, and whether it is on the shelf.">
      <div className="dz-row mb-4">
        <div className="dz-searchbox" style={{ flex: "1 1 280px", maxWidth: 520 }}>
          <Search />
          <input className="dz-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, brand or formulation" />
        </div>
        <Segmented value={status} onChange={setStatus} options={[
          { key: "", label: "All" }, { key: "in_stock", label: "In stock" }, { key: "low_stock", label: "Low" },
          { key: "out_of_stock", label: "Out" }, { key: "available", label: "To order" },
        ]} />
      </div>
      <Async q={rows} label="Checking the shelves…" rows={6}>
        {(list) => list.length === 0 ? (
          <Empty title="Nothing matches" hint="Try another name, or clear the filter." />
        ) : (
          <div className="dz-list">
            {list.map((p) => (
              <div key={`${p.source}-${p._id}`} className="dz-result" style={{ cursor: "default", minHeight: 68 }}>
                <span className="dz-result__txt">
                  <b>{p.name}</b>
                  <small>{[p.brand, p.category, p.productType, p.formulation].filter(Boolean).join(" · ") || "—"}</small>
                </span>
                <span className="dz-result__side">
                  {p.isRx && <Tag kind="warn">Rx</Tag>}
                  {p.syncedFromZenoti && <Tag kind="info">Zenoti</Tag>}
                  <StockPill status={p.status} qty={p.quantity} />
                </span>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Page>
  );
}
