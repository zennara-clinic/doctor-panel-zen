import type { PreConsultForm, User } from "./lib/types";
import { fmtDate, fmtDateTime, guestCodeOf } from "./lib/format";
import { Modal, Tag } from "./ui";

/**
 * One pre-consult form, read in full.
 *
 * The panel used to show a guest's forms only as table rows — a date, the
 * words "Pre-consult form" and a status — with no way to open them. The
 * answers were readable in exactly one place, the consultation screen, and
 * only for a form attached to that appointment. A guest who filled the form on
 * the front-desk tablet has no appointment attached to it, so their answers
 * were unreachable everywhere. This is the view that fixes that; it is used
 * from the patient record and from the consultation.
 *
 * It is read-only on purpose. A form is what the guest attested to and signed;
 * the clinic's own reading of it belongs in the consultation note, not on top
 * of the patient's words.
 */

const on = (v: unknown) => v === true;

/** The chosen entries of a `{ label: boolean }` block, in the record's order. */
export function chosenLabels(block: Record<string, unknown> | undefined): string[] {
  return Object.entries(block ?? {})
    .filter(([, v]) => on(v))
    .map(([k]) => humanise(k));
}

/** `hairFallThinning` → `Hair fall thinning`; already-spaced labels pass through. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function Row({ k, v }: { k: string; v?: unknown }) {
  const text = v === null || v === undefined || v === "" ? "" : String(v);
  if (!text.trim()) return null;
  return (
    <div className="flex gap-2 border-b border-border py-2.5 last:border-0">
      <span className="w-[42%] shrink-0 text-ink3">{k}</span>
      <span className="flex-1 whitespace-pre-wrap text-ink2">{text}</span>
    </div>
  );
}

/** A block of questions, hidden entirely when the guest answered none of it. */
function Block({ t, children, empty }: { t: string; children: React.ReactNode; empty?: boolean }) {
  if (empty) return null;
  return (
    <div className="mt-6">
      <div className="mb-1.5 text-[13.5px] font-extrabold text-ink">{t}</div>
      {children}
    </div>
  );
}

const yesNo = (b: Record<string, unknown> | undefined, key: string) => {
  const block = b?.[key] as { used?: boolean; visited?: boolean; had?: boolean; details?: string } | undefined;
  if (!block) return null;
  const yes = on(block.used) || on(block.visited) || on(block.had);
  return `${yes ? "Yes" : "No"}${yes && block.details ? ` — ${block.details}` : ""}`;
};

export function PreConsultBody({ form }: { form: PreConsultForm }) {
  const guest = typeof form.userId === "object" ? (form.userId as User) : null;
  const routine = Object.entries(form.dailyRoutine ?? {}).filter(([, v]) => v && String(v).trim());
  const medical = Object.entries(form.medicalHistory ?? {})
    // `thyroidDisorder` duplicates `thyroid`; menstrual history is its own row.
    .filter(([k, v]) => k !== "menstrualHistory" && k !== "thyroidDisorder" && on(v))
    .map(([k]) => humanise(k));
  const menstrual = String((form.medicalHistory ?? {}).menstrualHistory ?? "");
  const reasons = chosenLabels(form.reasonForVisit);
  const skin = chosenLabels(form.skinConcerns);
  const hair = chosenLabels(form.hairConcerns as Record<string, unknown>);
  const hairOther = (form.hairConcerns as Record<string, unknown> | undefined)?.others;
  const allergy = form.drugAllergies && !/^none/i.test(form.drugAllergies) ? form.drugAllergies : null;

  return (
    <div className="text-[14px] leading-relaxed">
      <div className="flex flex-wrap items-center gap-2">
        <Tag kind={form.status === "Approved" || form.status === "Reviewed" ? "ok" : form.status === "Rejected" ? "err" : "warn"}>{form.status}</Tag>
        <span className="text-ink3">Visit {fmtDate(form.dateOfVisit || form.createdAt)}</span>
        {guestCodeOf(guest) && <span className="font-mono text-[10.5px] text-ink3">{guestCodeOf(guest)}</span>}
      </div>

      <Block t="The guest">
        <Row k="Name" v={form.name ?? guest?.fullName} />
        <Row k="Date of birth" v={form.dateOfBirth ? fmtDate(form.dateOfBirth) : ""} />
        <Row k="Gender" v={form.gender} />
        <Row k="Marital status" v={form.maritalStatus} />
        {/* 0 is the model default, not an answer — only show a real count. */}
        <Row k="Children" v={form.numberOfChildren ? form.numberOfChildren : ""} />
        <Row k="Planning pregnancy" v={form.planningForPregnancy ? "Yes" : ""} />
        <Row k="LMP" v={form.lastMenstrualPeriod ? fmtDate(form.lastMenstrualPeriod) : ""} />
        <Row k="Heard about Zennara" v={form.referralSource} />
        <Row k="Referred by" v={form.referredBy} />
      </Block>

      <Block t="Reason for visit" empty={!reasons.length && !skin.length && !hair.length && !hairOther}>
        <Row k="Here for" v={reasons.join(", ")} />
        <Row k="Skin concerns" v={skin.join(", ")} />
        <Row k="Hair concerns" v={hair.filter((h) => h !== "Others").join(", ")} />
        <Row k="Other concerns" v={hairOther} />
      </Block>

      <Block
        t="Presenting complaint"
        empty={!form.symptomDuration && !form.previousTreatments && !form.currentMedications && !form.patientNotes
          && (!form.pregnancyStatus || form.pregnancyStatus === "not_applicable")}
      >
        <Row k="Going on for" v={form.symptomDuration} />
        <Row k="Already tried" v={form.previousTreatments} />
        <Row k="Currently taking" v={form.currentMedications} />
        {form.pregnancyStatus && form.pregnancyStatus !== "not_applicable" && (
          <div className="flex gap-2 border-b border-border py-2.5">
            <span className="w-[42%] shrink-0 text-ink3">Pregnancy</span>
            {/* Load-bearing: most lasers and peels and several drugs are
                contraindicated in pregnancy, so it reads as a warning. */}
            <span className="flex-1 font-semibold text-err">{humanise(form.pregnancyStatus)}</span>
          </div>
        )}
        <Row k="Anything else" v={form.patientNotes} />
      </Block>

      <Block t="Allergies & medical history" empty={!allergy && !form.otherAllergies && !medical.length && !menstrual}>
        <div className="flex gap-2 border-b border-border py-2.5">
          <span className="w-[42%] shrink-0 text-ink3">Drug allergies</span>
          <span className={`flex-1 ${allergy ? "font-semibold text-err" : "text-ink2"}`}>{allergy ?? "None reported"}</span>
        </div>
        <Row k="Other allergies" v={form.otherAllergies} />
        <Row k="Conditions" v={medical.join(", ")} />
        <Row k="Menstrual history" v={menstrual && menstrual !== "N/A" ? menstrual : ""} />
      </Block>

      <Block t="Daily routine" empty={!routine.length && !form.diet?.type}>
        {routine.map(([k, v]) => <Row key={k} k={humanise(k)} v={v} />)}
        <Row k="Diet" v={form.diet?.type} />
        <Row k="Water intake" v={form.diet?.waterIntakeLiters ? `${form.diet.waterIntakeLiters} litres/day` : ""} />
      </Block>

      <Block t="Recent activity" empty={!form.additionalInfo || !Object.keys(form.additionalInfo).length}>
        <Row k="New skincare this week" v={yesNo(form.additionalInfo, "newSkincareProducts")} />
        <Row k="Salon visit this week" v={yesNo(form.additionalInfo, "recentSalonVisit")} />
        <Row k="Past treatments / surgery" v={yesNo(form.additionalInfo, "pastTreatmentsSurgeries")} />
      </Block>

      {!!(form.photos ?? []).length && (
        <Block t="Photos the guest attached">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(form.photos ?? []).map((ph, i) => (
              <a key={i} href={ph.url} target="_blank" rel="noreferrer">
                <img src={ph.url} alt={ph.caption || "Guest photo"} className="h-24 w-24 rounded-xl border border-border object-cover" />
              </a>
            ))}
          </div>
        </Block>
      )}

      <Block t="Declaration">
        <Row k="Consent given" v={form.healthDataConsent?.accepted ? "Yes — health data consent (DPDPA 2023)" : "Not recorded"} />
        <Row k="Signed" v={form.clientSignature ? (form.clientSignature.split("|")[0] || "Signed") : ""} />
        <Row k="Submitted" v={form.createdAt ? fmtDateTime(form.createdAt) : ""} />
        <Row k="Dermatologist" v={form.doctorName} />
      </Block>
    </div>
  );
}

/** The same, in a modal — what the patient record and the consultation open. */
export function PreConsultModal({ form, open, onClose }: { form: PreConsultForm | null; open: boolean; onClose: () => void }) {
  if (!form) return null;
  return (
    <Modal open={open} onClose={onClose} title="Pre-consult form" wide>
      <PreConsultBody form={form} />
    </Modal>
  );
}
