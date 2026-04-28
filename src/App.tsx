import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PasswordGate } from "@/components/PasswordGate";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/toaster";
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
      <PasswordGate>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/events" replace />} />
            <Route path="/events" element={<EventsList />} />
            <Route path="/events/new" element={<EventCreate />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/players" element={<PlayersList />} />
            <Route path="/players/pairs" element={<PairLeaderboard />} />
            <Route path="/players/:id" element={<PlayerProfile />} />
            <Route path="/series" element={<SeriesList />} />
            <Route path="/series/:id" element={<SeriesDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/events" replace />} />
          </Route>
        </Routes>
      </PasswordGate>
      <Toaster />
    </BrowserRouter>
  );
}
