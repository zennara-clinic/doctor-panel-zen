import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { StoreProvider } from "./store";
import { Shell, HOME } from "./shell";
import { Tours } from "./tours";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { PatientDetail } from "./pages/reception";
import { MyDay, Consult, MyPatients, MyMonth, Availability, DoctorProfile, ProductStock } from "./pages/doctor";
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


/** `/doctor/my-day` → `/dermatologist/my-day`, keeping query and router state. */
function LegacyDoctorPath() {
  const { page: sub } = useParams();
  const { search, state } = useLocation();
  return <Navigate to={`/dermatologist/${sub ?? "my-day"}${search}`} state={state} replace />;
}

export default function App() {
  return (
    <StoreProvider>
      <Tours />
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to={HOME} replace />} />

          <Route path="/dermatologist/my-day" element={page(<MyDay />)} />
          <Route path="/dermatologist/consultation" element={page(<Consult />)} />
          <Route path="/dermatologist/my-patients" element={page(<MyPatients />)} />
          <Route path="/dermatologist/month" element={page(<MyMonth />)} />
          <Route path="/dermatologist/availability" element={page(<Availability />)} />
          {/* Which centres they work at vs. when they sit — two questions,
              two screens. Availability is the former, Schedule the latter. */}
          <Route path="/dermatologist/schedule" element={page(<Schedule />)} />
          <Route path="/dermatologist/stock" element={page(<ProductStock />)} />
          <Route path="/dermatologist/profile" element={page(<DoctorProfile />)} />
          <Route path="/dermatologist/patient" element={page(<PatientDetail />)} />

          {/*
            The panel used to live under /doctor/*. The word does not appear
            anywhere a dermatologist can read it any more — including the
            address bar — but bookmarks, the tour's deep links and anything
            already pasted into a chat still point at the old paths, so they
            redirect rather than falling through to the catch-all.
          */}
          <Route path="/doctor/:page" element={<LegacyDoctorPath />} />
          <Route path="/doctor" element={<Navigate to={HOME} replace />} />

          <Route path="*" element={<Navigate to={HOME} replace />} />
        </Routes>
      </Shell>
    </StoreProvider>
  );
}
