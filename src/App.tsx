import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "@/components/AuthGate";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/toaster";
import { useMembership } from "@/lib/membership";
import { isAdmin } from "@/lib/permissions";
import Dashboard from "@/pages/Dashboard";
import EventsList from "@/pages/EventsList";
import EventCreate from "@/pages/EventCreate";
import EventDetail from "@/pages/EventDetail";
import PlayersList from "@/pages/PlayersList";
import PlayerProfile from "@/pages/PlayerProfile";
import PairLeaderboard from "@/pages/PairLeaderboard";
import SeriesList from "@/pages/SeriesList";
import SeriesDetail from "@/pages/SeriesDetail";
import Settings from "@/pages/Settings";
import Me from "@/pages/Me";
import Invite from "@/pages/Invite";

/** Redirect to / if admin, /me otherwise. Used as the index route. */
function HomeRedirect() {
  const { status, membership } = useMembership();
  if (status === "loading") return null;
  return isAdmin(membership) ? <Dashboard /> : <Navigate to="/me" replace />;
}

/** Block non-admins from admin-only routes. Renders the children for admin, else redirects to /me. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { status, membership } = useMembership();
  if (status === "loading") return null;
  if (!isAdmin(membership)) return <Navigate to="/me" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Invite redemption is allowed when not signed in (it shows its own form). */}
        <Route path="/invite/:token" element={<Invite />} />
        <Route
          path="*"
          element={
            <AuthGate>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<HomeRedirect />} />
                  <Route path="/me" element={<Me />} />
                  <Route
                    path="/events"
                    element={
                      <AdminOnly>
                        <EventsList />
                      </AdminOnly>
                    }
                  />
                  <Route
                    path="/events/new"
                    element={
                      <AdminOnly>
                        <EventCreate />
                      </AdminOnly>
                    }
                  />
                  <Route path="/events/:id" element={<EventDetail />} />
                  <Route path="/players" element={<PlayersList />} />
                  <Route path="/players/pairs" element={<PairLeaderboard />} />
                  <Route path="/players/:id" element={<PlayerProfile />} />
                  <Route path="/series" element={<SeriesList />} />
                  <Route path="/series/:id" element={<SeriesDetail />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </AuthGate>
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
