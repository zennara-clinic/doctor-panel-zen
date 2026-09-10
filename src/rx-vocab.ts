/**
 * Tap-to-pick vocabulary for the prescription builder.
 *
 * The consult room is a tablet held in one hand, often with gloves on. Every
 * value a dermatologist reaches for a hundred times a week is a chip; the free
 * text box stays for the hundred-and-first. Typing "Twice daily" into seven
 * fields per medicine is both slower and how "twice dialy" ends up on a
 * printed slip.
 */
export const DOSE_CHIPS = ["Pea-sized", "Thin layer", "3 drops", "1 ml", "2 finger lengths", "1 tablet", "2 tablets", "1 capsule", "1 sachet", "5 ml"];
export const FREQUENCY_CHIPS = ["Once daily", "Twice daily", "Three times daily", "Morning", "At night", "Alternate nights", "Twice weekly", "Once weekly", "As needed"];
export const DURATION_CHIPS = ["5 days", "1 week", "2 weeks", "4 weeks", "6 weeks", "8 weeks", "12 weeks", "3 months", "6 months", "Ongoing"];
export const TIMING_CHIPS = ["After food", "Before food", "Empty stomach", "Morning", "At night", "Before bed"];
export const INSTRUCTION_CHIPS = ["On dry scalp", "On damp skin", "Avoid eyes", "Avoid sun", "Not in pregnancy", "With a fatty meal", "Reapply every 3 hours", "Stop if irritation", "Shake well", "Do not apply to broken skin"];
export const FORM_CHIPS = ["Tablet", "Capsule", "Cream", "Gel", "Serum", "Lotion", "Ointment", "Foam", "Shampoo", "Solution", "Sachet", "Syrup"];
export const RX_CATEGORIES = ["Acne", "Melasma / pigmentation", "Hair fall", "Eczema / dermatitis", "Post-procedure", "Anti-ageing", "Rosacea", "Psoriasis", "General"];

/**
 * How long the guest should be nudged for a refill, derived from the duration
 * when the doctor does not set it. A course that has run out and not been
 * repeated is the single commonest reason dermatology treatment stalls.
 */
export function refillDaysFromDuration(duration?: string | null): number | null {
  const text = String(duration || "").trim().toLowerCase();
  if (!text || text === "ongoing") return null;
  const n = Number(text.match(/\d+/)?.[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (text.includes("month")) return n * 30;
  if (text.includes("week")) return n * 7;
  if (text.includes("day")) return n;
  return null;
}
