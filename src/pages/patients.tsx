import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, CalendarPlus, ChevronRight, ClipboardList, FileText, History, Images, Package, Pencil, Pill,
  Search, ShieldCheck, Sparkles, Stethoscope, Users,
} from "lucide-react";
import api from "../lib/api";
import type { ZenotiAppointment, ZenotiMembership, ZenotiPackage } from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import { useStore } from "../store";
import { Area, Async, Btn, Empty, Modal, Panel, Prog, Segmented } from "../ui";
import { NoProfile, VisitRow, isOpenVisit, visitTime } from "../visit";
import { PhotoGrid, PhotoStudio } from "../photos";
import { PreConsultModal } from "../preconsult";
import GuestPurchases from "../purchases";
import { NewBookingModal } from "./reception";
import { appointmentState, fmtZDate, fmtZWhen, membershipActive, pkgActive } from "./zenoti";
import {
  ageFrom, bookingServiceName, fmtDate, fmtDateLong, fmtWhen, idOf, initials, isoDay,
} from "../lib/format";
import type { PreConsultForm, User } from "../lib/types";

/* =============================================================== my patients */

type Row = { name: string; userId: string; visits: number; last?: string; next?: string; nextTime?: string; services: Set<string> };

export function MyPatients() {
  const nav = useNavigate();
  const { admin, setSearchOpen } = useStore();
  const me = useMyDoctor();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 200);
  const [filter, setFilter] = useState<"all" | "booked" | "unbooked">("all");

  const q = useApi(async () => {
    if (!me.data) return [] as Row[];
    const res = await api.bookings.list({ specialistId: me.data.doctorId });
    const mine = (res.data ?? []).filter(
      (b) => !b.specialistId || b.specialistId === me.data!.doctorId || b.specialistName === me.data!.name,
    );
    // One row per guest: "who is under my care", not "every appointment".
    const byUser = new Map<string, Row>();
    for (const b of mine) {
      const id = idOf(b.userId);
      if (!id) continue;
      const entry = byUser.get(id) ?? { name: b.fullName, userId: id, visits: 0, services: new Set<string>() };
      const when = b.confirmedDate || b.preferredDate;
      if (b.status === "Completed") {
        entry.visits += 1;
        if (!entry.last || new Date(when) > new Date(entry.last)) entry.last = when;
      } else if (isOpenVisit(b) && isoDay(new Date(when)) >= isoDay()) {
        if (!entry.next || new Date(when) < new Date(entry.next)) { entry.next = when; entry.nextTime = visitTime(b); }
      }
      const svc = bookingServiceName(b, "");
      if (svc) entry.services.add(svc);
      byUser.set(id, entry);
    }
    return [...byUser.values()].sort((a, b) => (b.last ? new Date(b.last).getTime() : 0) - (a.last ? new Date(a.last).getTime() : 0));
  }, [me.data?._id]);

  const all = q.data ?? [];
  const rows = all
    .filter((r) => !debounced || r.name.toLowerCase().includes(debounced.toLowerCase()))
    .filter((r) => filter === "all" || (filter === "booked" ? !!r.next : !r.next));

  return (
    <div className="dz-page">
      <header className="dz-head">
        <div className="dz-head__txt">
          <div className="dz-eyebrow">{me.data ? `${all.length} under your care` : " "}</div>
          <h1 className="dz-title">Patients</h1>
        </div>
        <div className="dz-head__actions">
          <Btn kind="secondary" onClick={() => setSearchOpen(true)}><Search />Find any guest</Btn>
        </div>
      </header>

      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <>
            <div className="dz-row mb-4">
              <div className="dz-searchbox" style={{ flex: "1 1 280px", maxWidth: 520 }}>
                <Search />
                <input className="dz-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your patients by name" />
              </div>
              <Segmented value={filter} onChange={setFilter} options={[
                { key: "all", label: "All", count: all.length },
                { key: "booked", label: "Booked ahead", count: all.filter((r) => r.next).length },
                { key: "unbooked", label: "Not booked", count: all.filter((r) => !r.next).length },
              ]} />
            </div>

            <Async q={q} label="Gathering your patients…" rows={6}>
              {() => rows.length === 0 ? (
                <Empty icon={<Users />} title={all.length ? "No patient matches" : "No patients yet"}
                  hint={all.length ? "Try another name, or clear the filter." : "Guests appear here once they have been booked with you."} />
              ) : (
                <div className="dz-list">
                  {rows.map((r) => (
                    <button key={r.userId} type="button" className="dz-prow"
                      onClick={() => nav(`/dermatologist/patient?id=${r.userId}`, { state: { id: r.userId } })}>
                      <span className="dz-avatar dz-avatar--lg dz-avatar--sage" style={{ width: 48, height: 48, fontSize: 16 }}>{initials(r.name)}</span>
                      <span className="min-w-0">
                        <span className="dz-prow__name">
                          {r.name}
                          {r.next && <span className="dz-pill dz-pill--sm">Next: {fmtWhen(r.next, r.nextTime)}</span>}
                        </span>
                        <span className="dz-prow__sub">{[...r.services].slice(0, 3).join(" · ") || "—"}</span>
                      </span>
                      <span className="dz-prow__side">
                        {r.last ? <>Last seen <b>{fmtDate(r.last)}</b></> : <>Not seen yet</>}<br />
                        {r.visits} visit{r.visits === 1 ? "" : "s"}
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              )}
            </Async>
          </>
        )}
      </Async>
    </div>
  );
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
    const [user, bookings, assignments, forms, consents, notes, photos] = await Promise.all([
      api.patients.get(id),
      api.bookings.list({ userId: id }).then((r) => (r.data ?? []).filter((b) => idOf(b.userId) === id)),
      api.packageAssignments.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((a) => idOf(a.userId) === id)).catch(() => []),
      api.preConsult.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((f) => idOf(f.userId) === id)).catch(() => []),
      api.consentForms.list({ userId: id, limit: 100 }).then((r) => (r.data ?? []).filter((c) => idOf(c.userId) === id)).catch(() => []),
      api.consultationNotes.list({ userId: id, limit: 200 }).then((r) => (r.data ?? []).filter((n) => idOf(n.userId) === id)).catch(() => []),
      api.patientPhotos.list({ userId: id, limit: 8 }).then((r) => r.data ?? []).catch(() => []),
    ]);
    return { user, bookings, assignments, forms, consents, notes, photos };
  }, [id]);
  const clinic = useApi(() => (id ? api.zenoti.user(id).catch(() => null) : Promise.resolve(null)), [id]);

  return (
    <Async q={q} label="Loading the patient record…" rows={6}>
      {({ user: p, bookings, assignments, forms, consents, notes, photos }) => {
        const age = ageFrom(p.dateOfBirth);
        const zd = clinic.data?.details ?? null;
        const knownZenotiIds = new Set(bookings.map((b) => b.zenotiAppointmentId).filter(Boolean));
        const zAppts = (zd?.appointments ?? []).filter((a) => !a.id || !knownZenotiIds.has(a.id));
        const zPkgs = zd?.packages ?? [];
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
        const activeAssignments = assignments.filter((a) => a.status === "Active");
        const activeZPkgs = zPkgs.filter(pkgActive);

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
                      {[age ? `${age} yrs` : null, p.gender, p.patientId ? `ID ${p.patientId}` : null, p.phone, p.memberType === "Zen Member" ? "Zen Member" : null].filter(Boolean).join(" · ")}
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

            <div className="mb-5 max-w-full">
              <Segmented value={tab} onChange={setTab} options={[
                { key: "overview", label: "Overview" },
                { key: "consultations", label: "Consultations", count: notes.length + zNotes.length },
                { key: "photos", label: "Photos" },
                { key: "forms", label: "Forms", count: forms.length + consents.length + zForms.length },
                { key: "packages", label: "Packages", count: assignments.length + zPkgs.length + zMems.length },
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

                  <Panel icon={<History />} title="Latest consultation"
                    right={sortedNotes[0] ? <Btn kind="secondary" size="sm" onClick={() => openConsult(idOf(sortedNotes[0].bookingId))}>Open<ChevronRight /></Btn> : undefined}>
                    {!sortedNotes[0] ? <div className="dz-hint">No consultation notes yet.</div> : (
                      <NoteSummary n={sortedNotes[0]} />
                    )}
                  </Panel>
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

                  <Panel icon={<Package />} title="Active packages" sub={activeAssignments.length + activeZPkgs.length ? undefined : "None active"}>
                    {activeAssignments.length + activeZPkgs.length === 0 ? <div className="dz-hint">Packages are sold and assigned at the desk.</div> : (
                      <div className="dz-stack--sm">
                        {activeAssignments.map((a) => {
                          const used = a.usageTracking?.usedSessions ?? 0;
                          const total = a.usageTracking?.totalSessions ?? 0;
                          return <PackageLine key={a._id} name={a.packageDetails?.packageName ?? "Package"} used={used} total={total} until={a.validUntil} />;
                        })}
                        {activeZPkgs.map((k, i) => (
                          <PackageLine key={k.id ?? i} name={k.name ?? "Package"} used={Math.max(0, (k.sessionsTotal ?? 0) - (k.sessionsRemaining ?? 0))}
                            total={k.sessionsTotal ?? 0} until={k.neverExpires ? null : k.endDate} clinic />
                        ))}
                      </div>
                    )}
                  </Panel>

                  <Panel icon={<Images />} title="Recent photos" right={<button type="button" className="dz-link" onClick={() => setTab("photos")}>All photos<ChevronRight /></button>}>
                    {photos.length === 0 ? <div className="dz-hint">No photos yet.</div> : (
                      <PhotoGrid photos={photos.slice(0, 4)} onOpen={() => setTab("photos")} />
                    )}
                  </Panel>

                  <GuestPurchases userId={id} patient={p} compact />
                </div>
              </div>
            )}

            {tab === "consultations" && (
              <div className="dz-stack">
                {sortedNotes.length === 0 && zNotes.length === 0 && <Empty icon={<FileText />} title="No consultation notes yet" />}
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
                {assignments.length + zPkgs.length + zMems.length === 0 && (
                  <Empty icon={<Package />} title="No packages or memberships" hint="Packages are sold and assigned at the desk." />
                )}
                {assignments.length > 0 && (
                  <div className="dz-grid-even">
                    {assignments.map((a) => {
                      const used = a.usageTracking?.usedSessions ?? 0;
                      const total = a.usageTracking?.totalSessions ?? 0;
                      return (
                        <Panel key={a._id} icon={<Package />} title={a.packageDetails?.packageName ?? "Package"}
                          sub={a.validUntil ? `Valid until ${fmtDate(a.validUntil)}` : undefined}
                          right={<span className={`dz-pill dz-pill--sm ${a.status === "Active" ? "dz-pill--ok" : a.status === "Cancelled" ? "dz-pill--err" : "dz-pill--off"}`}>{a.status}</span>}>
                          <div className="dz-stack--sm">
                            <div className="dz-row"><Prog pct={total ? (used / total) * 100 : 0} w="flex-1" /><b className="text-[14px]">{used} of {total} used</b></div>
                            {(a.sessions ?? []).map((s, i) => (
                              <div key={s._id ?? i} className="flex items-center justify-between gap-3 border-b border-border py-2 text-[14px] last:border-0">
                                <span className="min-w-0 truncate">{s.serviceName || "Treatment"}{s.specialistName ? <span className="text-ink3"> · {s.specialistName}</span> : null}</span>
                                <span className="shrink-0 text-ink2">{s.scheduledDate ? fmtDate(s.scheduledDate) : "—"}</span>
                              </div>
                            ))}
                          </div>
                        </Panel>
                      );
                    })}
                  </div>
                )}
                {zPkgs.length > 0 && (
                  <Panel icon={<Package />} title="Clinic packages from Zenoti" sub={`${zPkgs.length} on the clinic system`}>
                    <div className="dz-stack--sm">{zPkgs.map((k, i) => <ClinicPackage key={k.id ?? i} k={k} />)}</div>
                  </Panel>
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

function PackageLine({ name, used, total, until, clinic }: { name: string; used: number; total: number; until?: string | null; clinic?: boolean }) {
  return (
    <div className="grid gap-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-3 text-[14px]">
        <b className="min-w-0 truncate">{name}</b>
        {clinic && <span className="dz-pill dz-pill--sm dz-pill--info">Clinic</span>}
      </div>
      <div className="dz-row" style={{ gap: 10 }}>
        <Prog pct={total ? (used / total) * 100 : 0} w="flex-1" />
        <span className="shrink-0 text-[13px] text-ink2">{Math.max(0, total - used)} of {total} left{until ? ` · until ${fmtDate(until)}` : ""}</span>
      </div>
    </div>
  );
}

/** A Zenoti package without its price — the consult room never shows money. */
function ClinicPackage({ k }: { k: ZenotiPackage }) {
  const total = k.sessionsTotal ?? 0;
  const left = k.sessionsRemaining ?? 0;
  const active = pkgActive(k);
  return (
    <div className="dz-result" style={{ cursor: "default", alignItems: "flex-start" }}>
      <span className="dz-result__txt">
        <b>{k.name ?? "Package"}</b>
        <small>Bought {fmtZDate(k.purchaseDate || k.startDate)} · {k.neverExpires ? "never expires" : `expires ${fmtZDate(k.endDate)}`}{k.centerName ? ` · ${k.centerName}` : ""}</small>
        {!!k.services?.length && <small>{k.services.map((s) => `${s.name ?? "Service"} ${s.balance ?? 0}/${s.total ?? 0}`).join(" · ")}</small>}
      </span>
      <span className="dz-result__side">
        <span className="text-[13px] font-bold text-ink2">{left} of {total} left</span>
        <span className={`dz-pill dz-pill--sm ${active ? "dz-pill--ok" : "dz-pill--off"}`}>{active ? "Active" : "Inactive"}</span>
      </span>
    </div>
  );
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
            await api.patients.update(user._id, { drugAllergies: drug, medicalHistory: history });
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
