import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "@/components/AuthGate";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/toaster";
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="/events" element={<EventsList />} />
            <Route path="/events/new" element={<EventCreate />} />
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
      <Toaster />
    </BrowserRouter>
  );
}
