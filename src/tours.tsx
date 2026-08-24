/* React Joyride tours — one 5-7 step walkthrough per panel on first login,
   plus short feature tours inside complex modules. */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Joyride, { STATUS, type Step, type CallBackProps } from "react-joyride";
import { useStore } from "./store";

const styles = {
  options: {
    primaryColor: "#032F22",
    textColor: "#111714",
    backgroundColor: "#FFFFFF",
    arrowColor: "#FFFFFF",
    overlayColor: "rgba(3, 47, 34, 0.45)",
    zIndex: 200,
  },
  tooltip: { borderRadius: 16, fontFamily: "inherit", fontSize: 13.5, padding: 18 },
  buttonNext: { borderRadius: 10, fontWeight: 700, padding: "8px 16px" },
  buttonBack: { color: "#4F5853" },
};

const T = (target: string, title: string, content: string, placement?: Step["placement"]): Step =>
  ({ target, title, content, placement: placement ?? "auto", disableBeacon: true });
const C = (title: string, content: string): Step =>
  ({ target: "body", title, content, placement: "center", disableBeacon: true });

/* ---- panel walkthroughs (5–7 steps each) ---- */
const PANEL_TOURS: Record<string, Step[]> = {
  doctor: [
    C("Welcome, Dermatologist", "Your panel has exactly what a consult needs — today's guests, their full history, and your own schedule."),
    T("[data-tour=nav-my-day]", "My day", "Every guest booked with you today, with allergy flags where they matter. Click a row to open the consultation."),
    T("[data-tour=nav-consultation]", "Consultation", "Pick a guest, then everything happens on one screen — notes, dictation, sketch pad, prescription, treatment assignment."),
    T("[data-tour=nav-my-patients]", "My patients", "Everyone under your care, most recently seen first, with their next booking if one exists."),
    T("[data-tour=nav-schedule]", "Your schedule drives everything", "Set your usual week and mark leave on specific dates — the app, reception and booking slots all follow it. My centres, next to it, is where you sit."),
    T("[data-tour=nav-profile]", "Your app card", "Edit your bio, photo and expertise, preview the card, then publish — guests see it instantly."),
  ],
};

/* ---- feature tours inside complex modules (3–4 steps) ---- */
const MODULE_TOURS: Record<string, { key: string; steps: Step[] }> = {
  "/doctor/consultation": {
    key: "m-consult",
    steps: [
      T("[data-tour=dictate]", "Dictate, don't type", "Tap the mic on any field — Examination, Assessment or Plan — and speak. Words appear live as you talk."),
      T("[data-tour=plan-chips]", "Plans in two taps", "The common plans are chips — tap to build the plan without typing. The sketch pad is here too."),
      T("[data-tour=rx]", "Prescription from your pharmacy", "Type to search the clinic's product list and tap to add, or press Enter for free text. Download unlocks once you sign."),
      T("[data-tour=assign]", "Assign the treatment", "Search the live treatment catalogue and the Zen packages — what you assign appears on the therapist's tablet."),
    ],
  },
};

export function Tours() {
  const { role, loggedIn } = useStore();
  const loc = useLocation();
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tourKey, setTourKey] = useState("");

  useEffect(() => {
    if (!loggedIn) { setRun(false); return; }
    const panelKey = `tour-${role}`;
    if (!localStorage.getItem(panelKey)) {
      setSteps(PANEL_TOURS[role] ?? []); setTourKey(panelKey);
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
    const mod = MODULE_TOURS[loc.pathname];
    // The consultation tour points at the open-consult screen, not the guest picker.
    const consultWithoutGuest = loc.pathname === "/doctor/consultation" && !(loc.state as { bookingId?: string } | null)?.bookingId;
    if (mod && !consultWithoutGuest && !localStorage.getItem(mod.key)) {
      setSteps(mod.steps); setTourKey(mod.key);
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
    setRun(false);
  }, [role, loggedIn, loc.pathname]);

  const cb = (data: CallBackProps) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      if (tourKey) localStorage.setItem(tourKey, "1");
      setRun(false);
    }
  };

  return (
    <Joyride
      steps={steps} run={run} callback={cb}
      continuous showSkipButton showProgress
      disableScrolling={false}
      locale={{ back: "Back", close: "Close", last: "Done", next: "Next", skip: "Skip tour" }}
      styles={styles}
    />
  );
}
