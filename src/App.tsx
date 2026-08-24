import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { StoreProvider } from "./store";
import { Shell, HOME } from "./shell";
import { Tours } from "./tours";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { PatientDetail } from "./pages/reception";
import { MyDay, Consult, MyPatients, MyMonth, Availability, DoctorProfile } from "./pages/doctor";
import { Schedule } from "./pages/availability";

/**
 * One boundary per route, keyed on the path so navigating away from a screen
 * that errored clears the error rather than leaving it stuck.
 */
function Guarded({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>;
}

const page = (el: React.ReactNode) => <Guarded>{el}</Guarded>;

export default function App() {
  return (
    <StoreProvider>
      <Tours />
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to={HOME} replace />} />

          <Route path="/doctor/my-day" element={page(<MyDay />)} />
          <Route path="/doctor/consultation" element={page(<Consult />)} />
          <Route path="/doctor/my-patients" element={page(<MyPatients />)} />
          <Route path="/doctor/month" element={page(<MyMonth />)} />
          <Route path="/doctor/availability" element={page(<Availability />)} />
          {/* Which centres they work at vs. when they sit — two questions,
              two screens. Availability is the former, Schedule the latter. */}
          <Route path="/doctor/schedule" element={page(<Schedule />)} />
          <Route path="/doctor/profile" element={page(<DoctorProfile />)} />
          <Route path="/doctor/patient" element={page(<PatientDetail />)} />

          <Route path="*" element={<Navigate to={HOME} replace />} />
        </Routes>
      </Shell>
    </StoreProvider>
  );
}
