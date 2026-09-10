import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, CalendarPlus, ChevronRight, ClipboardList, FileText, History, Images, Package, Pencil, Pill,
  Search, ShieldCheck, Sparkles, Stethoscope, Users,
} from "lucide-react";
import api from "../lib/api";
import type { MyPatient, ZenotiAppointment, ZenotiMembership } from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import { useStore } from "../store";
import { Area, Async, Btn, Empty, Modal, Panel, Segmented } from "../ui";
import { NoProfile, VisitRow, isOpenVisit, visitTime } from "../visit";
import { PhotoGrid, PhotoStudio } from "../photos";
import { PreConsultModal } from "../preconsult";
import GuestPurchases from "../purchases";
import { PackageCard, PackageLine as PackageSummary, PackagesFreshness, useGuestPackages } from "../packages";
import { NewBookingModal } from "./reception";
import { appointmentState, fmtZDate, fmtZWhen, membershipActive } from "./zenoti";
import {
  ageFrom, bookingServiceName, fmtDate, fmtDateLong, fmtWhen, idOf, initials, isoDay,
} from "../lib/format";
import type { Doctor, PreConsultForm, User } from "../lib/types";
import { ApiError } from "../lib/http";

/* =============================================================== my patients */

type PatientSort = "recent" | "name" | "next" | "visits";
const SORT_LABEL: Record<PatientSort, string> = {
  recent: "Most recent first",
  name: "Name, A to Z",
  next: "Next appointment",
  visits: "Most visits",
};
const PAGE = 30;

/**
 * Everyone this dermatologist has ever been booked with.
 *
 * Grouped, searched, sorted and paged on the server (GET /doctors/me/patients)
 * — a dermatologist can have several thousand bookings, and pulling them all
 * to count guests in the browser was slow enough to show an empty list.
 */
export function MyPatients() {
  const nav = useNavigate();
  const { admin, setSearchOpen } = useStore();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 300);
  const [filter, setFilter] = useState<"all" | "booked" | "unbooked">("all");
  const [sort, setSort] = useState<PatientSort>("recent");
  const [page, setPage] = useState(1);
  const term = debounced.trim();
  useEffect(() => { setPage(1); }, [term, filter, sort]);

  const me = useMyDoctor();
  const q = useApi(
    () => api.doctors.myPatients({ search: term || undefined, filter, sort, page, limit: PAGE })
      .catch((e) => {
        // Until the API with /doctors/me/patients is deployed, group in the browser.
        if (e instanceof ApiError && e.status === 404 && me.data) return patientsInBrowser(me.data, { term, filter, sort, page });
        throw e;
      }),
    [term, filter, sort, page, me.data?._id],
  );
  const res = q.data;
  const rows: MyPatient[] = res?.data ?? [];
  const total = res?.total ?? 0;
  const counts = res?.counts ?? { all: 0, booked: 0, unbooked: 0 };
  const pages = Math.max(1, res?.pages ?? 1);
  const from = total ? (page - 1) * PAGE + 1 : 0;

  return (
    <div className="dz-page">
      <header className="dz-head">
        <div className="dz-head__txt">
          <div className="dz-eyebrow">{res && !term ? `${counts.all.toLocaleString("en-IN")} under your care` : "Your patients"}</div>
          <h1 className="dz-title">Patients</h1>
        </div>
        <div className="dz-head__actions">
          <Btn kind="secondary" title="Searches guests booked with you" onClick={() => setSearchOpen(true)}><Search />Find a guest</Btn>
        </div>
      </header>

      <div className="dz-row mb-4">
        <div className="dz-searchbox" style={{ flex: "1 1 280px", maxWidth: 480 }}>
          <Search />
          <input className="dz-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone or patient ID" />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[
          { key: "all", label: "All", count: counts.all },
          { key: "booked", label: "Booked ahead", count: counts.booked },
          { key: "unbooked", label: "Not booked", count: counts.unbooked },
        ]} />
        <select className="dz-select" style={{ width: 220 }} value={sort} aria-label="Sort patients"
          onChange={(e) => setSort(e.target.value as PatientSort)}>
          {(Object.keys(SORT_LABEL) as PatientSort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
      </div>

      <Async q={q} label="Gathering your patients…" rows={6}>
        {(r) => r.linked === false ? <NoProfile email={admin?.email} /> : rows.length === 0 ? (
          <Empty icon={<Users />} title={term || filter !== "all" ? "No patient matches" : "No patients yet"}
            hint={term || filter !== "all" ? "Try another name or number, or clear the filter." : "Guests appear here once they have been booked with you."} />
        ) : (
          <div style={{ opacity: q.loading ? 0.6 : 1, transition: "opacity .15s" }}>
            <div className="dz-list">
              {rows.map((p) => (
                <button key={p.userId} type="button" className="dz-prow"
                  onClick={() => nav(`/dermatologist/patient?id=${p.userId}`, { state: { id: p.userId } })}>
                  <span className="dz-avatar dz-avatar--sage" style={{ width: 48, height: 48, fontSize: 16 }}>{initials(p.fullName)}</span>
                  <span className="min-w-0">
                    <span className="dz-prow__name">
                      {p.fullName}
                      {p.drugAllergy && <span className="dz-pill dz-pill--sm dz-pill--err"><AlertTriangle />Allergy</span>}
                      {p.nextVisit && <span className="dz-pill dz-pill--sm">Next: {fmtWhen(p.nextVisit)}</span>}
                    </span>
                    <span className="dz-prow__sub">
                      {[p.patientId, [ageFrom(p.dateOfBirth) ? `${ageFrom(p.dateOfBirth)} yrs` : null, p.gender].filter(Boolean).join(" "), p.services.slice(0, 3).join(" · ")].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <span className="dz-prow__side">
                    {p.lastVisit ? <>Last seen <b>{fmtDate(p.lastVisit)}</b></> : p.lastBooked ? <>Last booked <b>{fmtDate(p.lastBooked)}</b></> : p.nextVisit ? <>First visit ahead</> : <>Not seen yet</>}<br />
                    {p.visits} visit{p.visits === 1 ? "" : "s"} · {p.bookings} booking{p.bookings === 1 ? "" : "s"}
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
            <div className="dz-pager">
              <span>{from.toLocaleString("en-IN")}–{Math.min(page * PAGE, total).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
              <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" disabled={page <= 1 || q.loading} onClick={() => { setPage(page - 1); window.scrollTo({ top: 0 }); }}>Previous</button>
              <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" disabled={page >= pages || q.loading} onClick={() => { setPage(page + 1); window.scrollTo({ top: 0 }); }}>Next</button>
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}

type PatientsPage = Awaited<ReturnType<typeof api.doctors.myPatients>>;

/**
 * The old in-browser grouping, same shape as GET /doctors/me/patients. Only a
 * fallback for an API that predates that endpoint; slow for large diaries.
 */
async function patientsInBrowser(doctor: Doctor, o: { term: string; filter: "all" | "booked" | "unbooked"; sort: PatientSort; page: number }): Promise<PatientsPage> {
  const res = await api.bookings.list({ specialistId: doctor.doctorId });
  const now = Date.now();
  const today = isoDay();
  const byUser = new Map<string, MyPatient & { recency: number }>();
  for (const b of res.data ?? []) {
    const id = idOf(b.userId);
    if (!id) continue;
    const u = typeof b.userId === "object" ? (b.userId as User) : null;
    const whenIso = b.eventAt || b.confirmedDate || b.preferredDate;
    const when = new Date(whenIso).getTime();
    const row = byUser.get(id) ?? { userId: id, fullName: u?.fullName || b.fullName, phone: u?.phone ?? b.mobileNumber, patientId: u?.patientId ?? null, bookings: 0, visits: 0, services: [], recency: 0 };
    row.bookings += 1;
    if (b.status === "Completed") { row.visits += 1; if (!row.lastVisit || when > new Date(row.lastVisit).getTime()) row.lastVisit = whenIso; }
    if (b.status !== "Cancelled" && when <= now && (!row.lastBooked || when > new Date(row.lastBooked).getTime())) row.lastBooked = whenIso;
    if (isOpenVisit(b) && isoDay(new Date(whenIso)) >= today && (!row.nextVisit || when < new Date(row.nextVisit).getTime())) row.nextVisit = whenIso;
    const svc = bookingServiceName(b, "");
    if (svc && !row.services.includes(svc)) row.services.push(svc);
    byUser.set(id, row);
  }
  let rows = [...byUser.values()].map((r) => ({ ...r, recency: new Date(r.lastBooked || r.nextVisit || 0).getTime() }));
  const counts = { all: 0, booked: 0, unbooked: 0 };
  if (o.term) { const t = o.term.toLowerCase(); rows = rows.filter((r) => [r.fullName, r.phone, r.patientId].some((v) => String(v ?? "").toLowerCase().includes(t))); }
  counts.all = rows.length; counts.booked = rows.filter((r) => r.nextVisit).length; counts.unbooked = counts.all - counts.booked;
  if (o.filter !== "all") rows = rows.filter((r) => (o.filter === "booked" ? !!r.nextVisit : !r.nextVisit));
  const sorters: Record<PatientSort, (a: typeof rows[number], b: typeof rows[number]) => number> = {
    recent: (a, b) => b.recency - a.recency,
    name: (a, b) => a.fullName.localeCompare(b.fullName),
    next: (a, b) => (a.nextVisit ? new Date(a.nextVisit).getTime() : Infinity) - (b.nextVisit ? new Date(b.nextVisit).getTime() : Infinity),
    visits: (a, b) => b.visits - a.visits || b.recency - a.recency,
  };
  rows.sort(sorters[o.sort]);
  const total = rows.length;
  return { success: true, linked: true, total, page: o.page, pages: Math.max(1, Math.ceil(total / PAGE)), counts, data: rows.slice((o.page - 1) * PAGE, o.page * PAGE) };
}

/* ============================================================ patient record */

type Tab = "overview" | "consultations" | "photos" | "forms" | "packages" | "visits";

export function PatientRecord() {
  const loc = useLocation();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const routeState = loc.state as { id?: string } | null;
  const id = (routeState?.id ?? sp.get("id") ?? "") as string;
  const tab = (sp.get("tab") as Tab) || "overview";
  const setTab = (t: Tab) => { const next = new URLSearchParams(sp); next.set("tab", t); if (id) next.set("id", id); setSp(next, { replace: true }); };

  // Router state does not survive a reload, so mirror the id into the address.
  useEffect(() => {
    if (!id || sp.get("id") === id) return;
    const next = new URLSearchParams(sp);
    next.set("id", id);
    setSp(next, { replace: true });
  }, [id, sp, setSp]);

  const [bookOpen, setBookOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [openForm, setOpenForm] = useState<PreConsultForm | null>(null);

  const q = useApi(async () => {
    if (!id) throw new Error("No guest selected — open one from Patients.");
    // A part that fails to load is named, never shown as an empty list — a real
    // guest must not read "no notes" because a request failed.
    const failed: string[] = [];
    const missing = (what: string) => () => { failed.push(what); return [] as never[]; };
    const [user, bookings, assignments, forms, consents, notes, photos] = await Promise.all([
      api.patients.get(id),
      api.bookings.list({ userId: id }).then((r) => (r.data ?? []).filter((b) => idOf(b.userId) === id)),
      api.packageAssignments.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((a) => idOf(a.userId) === id)).catch(missing("packages")),
      api.preConsult.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((f) => idOf(f.userId) === id)).catch(missing("pre-consult forms")),
      api.consentForms.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((c) => idOf(c.userId) === id)).catch(missing("consent forms")),
      api.consultationNotes.list({ userId: id, limit: 200 }).then((r) => (r.data ?? []).filter((n) => idOf(n.userId) === id)).catch(missing("consultation notes")),
      api.patientPhotos.list({ userId: id, limit: 8 }).then((r) => r.data ?? []).catch(missing("photos")),
    ]);
    return { user, bookings, assignments, forms, consents, notes, photos, failed };
  }, [id]);
  const clinic = useApi(() => (id ? api.zenoti.user(id).catch(() => null) : Promise.resolve(null)), [id]);
  // Packages read live: a pull from Zenoti when the copy is stale, and every few
  // minutes while the Packages tab is open.
  const pk = useGuestPackages(id, { watch: tab === "packages", onLive: clinic.reload });

  return (
    <Async q={q} label="Loading the patient record…" rows={6}>
      {({ user: p, bookings, assignments, forms, consents, notes, photos, failed }) => {
        const age = ageFrom(p.dateOfBirth);
        const zd = clinic.data?.details ?? null;
        const knownZenotiIds = new Set(bookings.map((b) => b.zenotiAppointmentId).filter(Boolean));
        const zAppts = (zd?.appointments ?? []).filter((a) => !a.id || !knownZenotiIds.has(a.id));
        const zMems = zd?.memberships ?? [];
        const zNotes = zd?.notes ?? [];
        const zForms = zd?.forms ?? [];

        const sortedNotes = [...notes].sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime());
        const lastSigned = sortedNotes.find((n) => n.status === "Completed");
        const latestForm = [...forms].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
        const sortedVisits = [...bookings].sort((a, b) => new Date(b.eventAt || b.confirmedDate || b.preferredDate).getTime() - new Date(a.eventAt || a.confirmedDate || a.preferredDate).getTime());
        const upcoming = [...bookings].filter((b) => isOpenVisit(b) && isoDay(new Date(b.confirmedDate || b.preferredDate)) >= isoDay())
          .sort((a, b) => new Date(a.confirmedDate || a.preferredDate).getTime() - new Date(b.confirmedDate || b.preferredDate).getTime());
        const todayOpen = upcoming.find((b) => isoDay(new Date(b.confirmedDate || b.preferredDate)) === isoDay());

        const drug = p.drugAllergies?.trim() || (latestForm?.drugAllergies && !/^none/i.test(latestForm.drugAllergies) ? latestForm.drugAllergies : "") || (p.hasDrugAllergy ? "Drug allergy — details not recorded" : "");
        const pregnancy = latestForm?.pregnancyStatus && ["pregnant", "breastfeeding", "planning"].includes(latestForm.pregnancyStatus) ? latestForm.pregnancyStatus : null;
        const openConsult = (bookingId: string) => nav(`/dermatologist/consultation?booking=${bookingId}`);

        return (
          <div className="dz-page">
            <header className="dz-head">
              <div className="dz-head__txt">
                <button type="button" className="dz-back" onClick={() => nav("/dermatologist/my-patients")}><ChevronRight style={{ transform: "rotate(180deg)" }} />Patients</button>
                <div className="flex items-center gap-4">
                  <span className="dz-avatar dz-avatar--xl dz-avatar--sage">{initials(p.fullName)}</span>
                  <div className="min-w-0">
                    <h1 className="dz-title">{p.fullName}</h1>
                    <div className="dz-sub">
                      {[age ? `${age} yrs` : null, p.gender, p.patientId ? `ID ${p.patientId}` : null, p.memberType === "Zen Member" ? "Zen Member" : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                {(drug || pregnancy) && (
                  <div className="dz-row mt-3" style={{ gap: 6 }}>
                    {drug && <span className="dz-pill dz-pill--err"><AlertTriangle />Allergy: {drug}</span>}
                    {pregnancy && <span className="dz-pill dz-pill--err"><AlertTriangle />{pregnancy === "planning" ? "Planning a pregnancy" : pregnancy === "pregnant" ? "Pregnant" : "Breastfeeding"}</span>}
                  </div>
                )}
              </div>
              <div className="dz-head__actions">
                <Btn kind="secondary" onClick={() => setEditOpen(true)}><Pencil />Allergies &amp; history</Btn>
                {todayOpen
                  ? <Btn onClick={() => openConsult(todayOpen._id)}><Stethoscope />Open today’s consultation</Btn>
                  : <Btn onClick={() => setBookOpen(true)}><CalendarPlus />Book follow-up</Btn>}
              </div>
            </header>

            {failed.length > 0 && (
              <div className="dz-note dz-note--warn mb-4"><AlertTriangle />
                <span className="flex-1">Couldn’t load this guest’s {failed.join(", ")}. What shows below may be incomplete.</span>
                <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" onClick={q.reload}>Retry</button>
              </div>
            )}
            <div className="mb-5 max-w-full">
              <Segmented value={tab} onChange={setTab} options={[
                { key: "overview", label: "Overview" },
                { key: "consultations", label: "Consultations", count: notes.length + zNotes.length },
                { key: "photos", label: "Photos" },
                { key: "forms", label: "Forms", count: forms.length + consents.length + zForms.length },
                { key: "packages", label: "Packages", count: (pk.views?.length ?? assignments.length) + zMems.length },
                { key: "visits", label: "Visits", count: bookings.length + zAppts.length },
              ]} />
            </div>

            {tab === "overview" && (
              <div className="dz-grid-2">
                <div className="dz-stack">
                  <Panel icon={<ClipboardList />} title="Clinical summary">
                    <dl className="dz-kv">
                      <dt>Drug allergies</dt><dd className={drug ? "is-alert" : ""}>{drug || "None recorded"}</dd>
                      <dt>Medical history</dt><dd>{p.medicalHistory?.trim() || "Nothing recorded"}</dd>
                      <dt>Last diagnosis</dt><dd>{lastSigned?.primaryDiagnosis || lastSigned?.assessment || "—"}</dd>
                      <dt>Last prescription</dt><dd>{lastSigned?.prescription?.length ? lastSigned.prescription.map((r) => r.medicine).join(", ") : "—"}</dd>
                      {latestForm?.currentMedications && <><dt>Taking</dt><dd>{latestForm.currentMedications}</dd></>}
                      {latestForm && <><dt>Latest intake</dt><dd>{fmtDate(latestForm.dateOfVisit || latestForm.createdAt)} · {latestForm.status}</dd></>}
                    </dl>
                  </Panel>

                  {(() => {
                    const lastDone = sortedVisits.find((b) => b.status === "Completed");
                    const n = lastDone ? notes.find((x) => idOf(x.bookingId) === lastDone._id) : null;
                    const who = lastDone ? lastDone.specialistName || lastDone.zenotiTherapistName || lastDone.therapistName : null;
                    return (
                      <Panel icon={<History />} title="Latest visit"
                        sub={lastDone ? `${fmtDateLong(lastDone.confirmedDate || lastDone.preferredDate)}${who ? ` · ${who}` : ""}` : undefined}
                        right={lastDone ? <Btn kind="secondary" size="sm" onClick={() => openConsult(lastDone._id)}>Open<ChevronRight /></Btn> : undefined}>
                        {!lastDone ? <div className="dz-hint">No completed visits on record.</div>
                          : n ? <NoteSummary n={n} />
                          : <div className="dz-hint">{bookingServiceName(lastDone, "Visit")}. No note was written in this panel for that visit.</div>}
                      </Panel>
                    );
                  })()}
                </div>

                <div className="dz-stack">
                  <Panel icon={<CalendarPlus />} title="Next visit">
                    {upcoming[0] ? (
                      <VisitRow booking={upcoming[0]} onOpen={openConsult} showDate />
                    ) : (
                      <div className="dz-row">
                        <span className="dz-hint flex-1">Nothing booked ahead.</span>
                        <Btn kind="secondary" size="sm" onClick={() => setBookOpen(true)}><CalendarPlus />Book follow-up</Btn>
                      </div>
                    )}
                  </Panel>

                  {(() => {
                    const active = (pk.views ?? []).filter((v) => v.active);
                    return (
                      <Panel icon={<Package />} title="Active packages"
                        sub={pk.views && !active.length ? "None active" : undefined}
                        right={pk.views?.length ? <button type="button" className="dz-link" onClick={() => setTab("packages")}>All<ChevronRight /></button> : undefined}>
                        {!pk.views ? <div className="dz-hint">Loading packages…</div>
                          : active.length === 0 ? <div className="dz-hint">{pk.views.length ? "Earlier packages are used up or expired — see Packages." : "Packages are sold and assigned at the desk."}</div>
                          : <div>{active.map((v) => <PackageSummary key={v.key} v={v} />)}</div>}
                      </Panel>
                    );
                  })()}

                  <Panel icon={<Images />} title="Recent photos" right={<button type="button" className="dz-link" onClick={() => setTab("photos")}>All photos<ChevronRight /></button>}>
                    {photos.length === 0 ? <div className="dz-hint">No photos yet.</div> : (
                      <PhotoGrid photos={photos.slice(0, 4)} onOpen={() => setTab("photos")} />
                    )}
                  </Panel>

                  <GuestPurchases userId={id} patient={p} hidePackages />
                </div>
              </div>
            )}

            {tab === "consultations" && (
              <div className="dz-stack">
                {sortedNotes.length === 0 && zNotes.length === 0 && failed.includes("consultation notes") && (
                  <div className="dz-note dz-note--warn"><AlertTriangle /><span>Couldn’t load this guest’s consultation notes.</span></div>
                )}
                {sortedNotes.length === 0 && zNotes.length === 0 && !failed.includes("consultation notes") && (
                  <Empty icon={<FileText />} title="No notes written yet"
                    hint={`${bookings.filter((b) => b.status === "Completed").length} completed visits are listed under Visits. A note appears here once one is written in this panel or in Zenoti.`} />
                )}
                {sortedNotes.map((n) => (
                  <Panel key={n._id} icon={<Stethoscope />}
                    title={fmtDateLong(n.completedAt || n.createdAt)}
                    sub={n.doctorName ?? undefined}
                    right={<span className="dz-row" style={{ gap: 8 }}>
                      <span className={`dz-pill dz-pill--sm ${n.status === "Completed" ? "dz-pill--ok" : "dz-pill--warn"}`}>{n.status === "Completed" ? "Signed" : "Draft"}</span>
                      <Btn kind="secondary" size="sm" onClick={() => openConsult(idOf(n.bookingId))}>Open<ChevronRight /></Btn>
                    </span>}>
                    <NoteSummary n={n} />
                  </Panel>
                ))}
                {zNotes.length > 0 && (
                  <Panel icon={<FileText />} title="Clinic notes from Zenoti" sub={`${zNotes.length} on the clinic system`}>
                    <div className="dz-tl">
                      {zNotes.map((n, i) => (
                        <div key={n.id ?? i} className="dz-tl__item">
                          <div className="dz-tl__date">{fmtZDate(n.createdAt)}{n.createdBy ? ` · ${n.createdBy}` : ""}{n.isProfileAlert ? " · profile alert" : ""}</div>
                          <div className="dz-tl__text" style={{ whiteSpace: "pre-wrap" }}>{n.text || "—"}</div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>
            )}

            {tab === "photos" && (
              <Panel icon={<Images />} title="Photos" sub="Every photo on this guest’s record, newest first">
                <PhotoStudio userId={id} />
              </Panel>
            )}

            {tab === "forms" && (
              <div className="dz-grid-even">
                <Panel icon={<ClipboardList />} title="Pre-consult forms" sub={forms.length ? `${forms.length} submitted` : "None yet"}>
                  {forms.length === 0 ? <div className="dz-hint">The guest fills this in the app or on the walk-in tablet.</div> : (
                    <div className="dz-stack--sm">
                      {forms.map((f) => (
                        <button key={f._id} type="button" className="dz-result" onClick={() => setOpenForm(f)}>
                          <span className="dz-result__txt"><b>{fmtDate(f.dateOfVisit || f.createdAt)}</b><small>{f.doctorName ? `For ${f.doctorName}` : "Pre-consult form"}</small></span>
                          <span className="dz-result__side">
                            <span className={`dz-pill dz-pill--sm ${f.status === "Reviewed" || f.status === "Approved" ? "dz-pill--ok" : "dz-pill--warn"}`}>{f.status}</span>
                            <ChevronRight className="h-5 w-5 text-ink3" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
                <div className="dz-stack">
                  <Panel icon={<ShieldCheck />} title="Consent forms" sub={consents.length ? undefined : "None on file"}>
                    {consents.length === 0 ? <div className="dz-hint">Treatment consents signed in the app appear here.</div> : (
                      <div className="dz-stack--sm">
                        {consents.map((c) => (
                          <div key={c._id} className="dz-result" style={{ cursor: "default" }}>
                            <span className="dz-result__txt"><b>{c.treatmentProcedure}</b><small>{fmtDate(c.consentDate || c.createdAt)}{c.doctorName ? ` · ${c.doctorName}` : ""}</small></span>
                            <span className={`dz-pill dz-pill--sm ${c.doctorSignature ? "dz-pill--ok" : "dz-pill--warn"}`}>{c.doctorSignature ? "Counter-signed" : c.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                  {zForms.length > 0 && (
                    <Panel icon={<FileText />} title="Clinic forms from Zenoti">
                      <div className="dz-stack--sm">
                        {zForms.map((f, i) => (
                          <div key={f.id ?? i} className="dz-result" style={{ cursor: "default" }}>
                            <span className="dz-result__txt"><b>{f.name ?? "Guest form"}</b><small>{fmtZDate(f.lastFilledAt)}{f.lastFilledBy ? ` · ${f.lastFilledBy}` : ""}</small></span>
                            <span className={`dz-pill dz-pill--sm ${f.isExpired ? "dz-pill--err" : String(f.status) === "2" ? "dz-pill--ok" : "dz-pill--warn"}`}>
                              {f.isExpired ? "Expired" : String(f.status) === "2" ? "Submitted" : "Not submitted"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  )}
                </div>
              </div>
            )}

            {tab === "packages" && (
              <div className="dz-stack">
                <PackagesFreshness linked={pk.linked} syncedAt={pk.syncedAt} pulling={pk.pulling} pullFailed={pk.pullFailed} onPull={() => void pk.pull()} />
                {pk.q.initial && !pk.views ? <div className="dz-hint">Loading packages…</div>
                  : pk.q.error && !pk.views ? <div className="dz-note dz-note--warn"><AlertTriangle /><span>Couldn’t load this guest’s packages.</span></div>
                  : (pk.views?.length ?? 0) + zMems.length === 0 ? (
                    <Empty icon={<Package />} title="No packages or memberships" hint="Packages are sold and assigned at the desk." />
                  ) : null}
                {pk.partial && <div className="dz-hint">Part of the package history couldn’t load — tap Refresh.</div>}
                {!!pk.views?.length && (
                  <div className="dz-grid-even">
                    {pk.views.map((v) => <PackageCard key={v.key} v={v} />)}
                  </div>
                )}
                {zMems.length > 0 && (
                  <Panel icon={<Sparkles />} title="Memberships">
                    <div className="dz-stack--sm">{zMems.map((m, i) => <ClinicMembership key={m.id ?? i} m={m} />)}</div>
                  </Panel>
                )}
              </div>
            )}

            {tab === "visits" && (
              <div className="dz-stack">
                {sortedVisits.length === 0 && zAppts.length === 0 && <Empty icon={<History />} title="No visits yet" />}
                {sortedVisits.length > 0 && <div className="dz-list">{sortedVisits.map((b) => <VisitRow key={b._id} booking={b} onOpen={openConsult} showDate />)}</div>}
                {zAppts.length > 0 && (
                  <Panel icon={<History />} title="Earlier clinic visits from Zenoti">
                    <div className="dz-stack--sm">{zAppts.map((a, i) => <ClinicVisit key={a.id ?? i} a={a} />)}</div>
                  </Panel>
                )}
              </div>
            )}

            <NewBookingModal open={bookOpen} onClose={() => setBookOpen(false)} onBooked={q.reload} presetUser={p} />
            <EditClinical open={editOpen} onClose={() => setEditOpen(false)} user={p} onSaved={q.reload} />
            <PreConsultModal form={openForm} open={!!openForm} onClose={() => setOpenForm(null)} />
          </div>
        );
      }}
    </Async>
  );
}

function NoteSummary({ n }: { n: { primaryDiagnosis?: string; secondaryDiagnosis?: string; assessment?: string; complaint?: string; plan?: string; prescription?: { medicine: string }[]; assignedServices?: { name: string; sessions?: number }[] } }) {
  const rows: [string, ReactNode][] = [];
  if (n.complaint) rows.push(["Complaint", n.complaint]);
  if (n.primaryDiagnosis) rows.push(["Diagnosis", `${n.primaryDiagnosis}${n.secondaryDiagnosis ? ` · ${n.secondaryDiagnosis}` : ""}`]);
  if (n.assessment) rows.push(["Assessment", n.assessment]);
  if (n.plan) rows.push(["Plan", n.plan]);
  if (n.prescription?.length) rows.push(["Prescription", <span key="rx" className="inline-flex flex-wrap gap-1.5">{n.prescription.map((r, i) => <span key={i} className="dz-pill dz-pill--sm"><Pill />{r.medicine}</span>)}</span>]);
  if (n.assignedServices?.length) rows.push(["Treatments", n.assignedServices.map((a) => `${a.name}${(a.sessions ?? 1) > 1 ? ` × ${a.sessions}` : ""}`).join(", ")]);
  if (!rows.length) return <div className="dz-hint">Nothing written yet.</div>;
  return <dl className="dz-kv">{rows.map(([k, v]) => <FactPair key={k} k={k} v={v} />)}</dl>;
}
function FactPair({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function ClinicMembership({ m }: { m: ZenotiMembership }) {
  const active = membershipActive(m);
  return (
    <div className="dz-result" style={{ cursor: "default" }}>
      <span className="dz-result__txt">
        <b>{m.name ?? "Membership"}</b>
        <small>{m.memberSince ? `Member since ${fmtZDate(m.memberSince)}` : ""}{m.expiryDate ? ` · ${active ? "expires" : "expired"} ${fmtZDate(m.expiryDate)}` : ""}</small>
      </span>
      <span className={`dz-pill dz-pill--sm ${active ? "dz-pill--gold" : "dz-pill--off"}`}>{active ? "Active" : "Expired"}</span>
    </div>
  );
}

function ClinicVisit({ a }: { a: ZenotiAppointment }) {
  const state = appointmentState(a);
  const tone = { ok: "dz-pill--ok", info: "dz-pill--info", err: "dz-pill--err", warn: "dz-pill--warn", mute: "dz-pill--off" }[state.kind];
  return (
    <div className="dz-result" style={{ cursor: "default" }}>
      <span className="dz-result__txt">
        <b>{a.serviceName ?? "Treatment"}</b>
        <small>{fmtZWhen(a.startTime)}{a.therapistName ? ` · ${a.therapistName}` : ""}{a.centerName ? ` · ${a.centerName}` : ""}</small>
      </span>
      <span className={`dz-pill dz-pill--sm ${tone}`}>{state.label}</span>
    </div>
  );
}

/** The two fields a dermatologist actually corrects on a guest's profile. */
function EditClinical({ open, onClose, user, onSaved }: { open: boolean; onClose: () => void; user: User; onSaved: () => void }) {
  const { toast } = useStore();
  const [drug, setDrug] = useState(user.drugAllergies ?? "");
  const [history, setHistory] = useState(user.medicalHistory ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setDrug(user.drugAllergies ?? ""); setHistory(user.medicalHistory ?? ""); setErr(null); } }, [open, user._id]);
  return (
    <Modal open={open} onClose={onClose} title="Allergies and medical history" sub={user.fullName}
      footer={<>
        {err && <span className="dz-error mr-auto">{err}</span>}
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            // The flag follows the text, so clearing the allergy clears the red alert too.
            await api.patients.update(user._id, { drugAllergies: drug, hasDrugAllergy: !!drug.trim(), medicalHistory: history });
            toast("Guest record updated"); onSaved(); onClose();
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : "Save"}</Btn>
      </>}>
      <div className="dz-stack">
        <Area label="Drug allergies — shown as a red alert everywhere" value={drug} onChange={setDrug} rows={2} placeholder="e.g. Sulfa drugs, doxycycline" />
        <Area label="Medical history" value={history} onChange={setHistory} rows={3} placeholder="Conditions, surgeries, long-term medication" />
      </div>
    </Modal>
  );
}
