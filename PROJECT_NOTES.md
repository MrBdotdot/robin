# Round Robin — Project Notes

A working record of what's been built, the decisions behind it, and the
shape of the codebase as of this writing. Skim the table of contents,
jump to a section, or read it linearly to get oriented quickly.

## Contents

1. What this app is
2. Tech stack and the reasoning behind each piece
3. File / folder map
4. Database schema
5. Event lifecycle and modes
6. The scheduler — Berger, Americano, fixed-partners
7. Smart-scheduling toggles (back-to-back, recent matchups, refill, court split)
8. Rating engine (Glicko-2, live updates, snapshots)
9. Roster management and substitutions
10. Standings, knockout, and series
11. UI patterns and design system
12. Visual progression overview (chip strip, Berger grouping)
13. Decisions log — the noteworthy "we picked X because Y" calls
14. Known limitations and backlog
15. Deployment

---

## 1. What this app is

A mobile-first web app for running a round-robin tournament for any
racket sport (or really anything pairable). It supports singles, rotating
doubles (Americano), and fixed-partner doubles. It auto-generates the
schedule, tracks scores in real time, computes standings with
configurable tiebreakers, runs a knockout bracket if you want one,
groups events into a series for cumulative standings, and rolls Glicko-2
ratings across every event the player appears in. The whole thing is
gated behind a simple password so it can sit on a public URL without
being open.

The original use case was running pickup pickleball nights and weekend
tournaments without dragging Excel into it. That informed every UX
decision below — favor a single-handed mobile flow, score entry that's
fast on a phone court-side, and an admin who can fix the world (swap a
player out, add another round, override a result) without ceremony.

## 2. Tech stack and reasoning

**Frontend.** React 18 + Vite + TypeScript. Vite for fast HMR and a
trivial production bundle, React because the round-robin domain is
naturally state-heavy (live scoreboards, optimistic roster moves), and
TypeScript because we cared about catching schema drift between the
client types and the database.

**Styling.** Tailwind CSS with a small set of HSL design tokens defined
in `src/index.css`, plus shadcn-style component primitives (`Button`,
`Input`, `Sheet`, `Select`, etc.) hand-rolled in `src/components/ui/`.
The design tokens use HSL so we can tweak hue / saturation independently
when we wanted to push the palette toward the Pantone-inspired bold
look. We never installed shadcn's CLI — the components were small enough
to maintain by hand and we needed strict control over class composition
for the Pantone redesign.

**Database and API.** Supabase (Postgres + REST + RLS). We never wrote
a real backend — the React app talks straight to Supabase. RLS policies
keep the anon key from doing anything destructive in theory, though in
practice the app is protected by a client-side password gate (see
section 14 for what that means and what to fix before sharing widely).

**Routing.** React Router (client-side SPA). Vercel is configured via
`vercel.json` to rewrite all non-asset paths to `index.html` so deep
links work after a hard refresh.

**Toast notifications.** Sonner. Lightweight, looked good, no quibbles.

**Icons.** lucide-react.

**Fonts.** Inter for body, Archivo Black for display headings, JetBrains
Mono for tabular numerals. Loaded from Google Fonts in `index.html`.

## 3. File / folder map

```
round-robin/
├── migration-001-initial-schema.sql    Eight rr_* tables + RLS policies
├── migration-002-series.sql            Adds rr_series + rr_events.series_id
├── seed-players.sql                    30 test players to populate the DB
├── PROJECT_NOTES.md                    (this file)
├── BACKLOG.md                          Deferred features
├── README.md                           Setup + Vercel deploy instructions
├── vercel.json                         SPA rewrite rule
├── .env.example                        Template for local env vars
├── .env.local                          (gitignored) Supabase keys + password
├── index.html                          Loads fonts and the React app
├── package.json                        Dependencies
├── tailwind.config.js                  Tailwind setup, font families, tokens
├── postcss.config.js
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts
└── src/
    ├── App.tsx                         Routes + providers
    ├── main.tsx                        React entry point
    ├── index.css                       Tailwind base + design tokens
    ├── vite-env.d.ts
    ├── components/
    │   ├── ui/                         Button, Input, Sheet, etc.
    │   ├── AppShell.tsx                Sidebar + bottom-nav frame
    │   ├── PasswordGate.tsx            Client-side password gate
    │   ├── EventCard.tsx               Card on the events list
    │   ├── MatchCard.tsx               Card on the schedule view
    │   ├── RoundNavigator.tsx          Prev/next + chip strip
    │   ├── ScoreSheet.tsx              Score entry sheet
    │   ├── score/                      Sub-components for ScoreSheet
    │   ├── EventEditSheet.tsx          Edit event metadata + settings
    │   ├── PlayerDetailSheet.tsx       Player drilldown from a roster row
    │   ├── PlayerPickerSheet.tsx       Pick existing players in the wizard
    │   ├── PlayerSwapSheet.tsx         Swap one player for another mid-event
    │   ├── MatchSubstituteSheet.tsx    Sub a player into one match only
    │   ├── RosterAddSheet.tsx          Add a player to a live event
    │   ├── DeleteEventSheet.tsx        Confirm cascading delete
    │   ├── CloneEventSheet.tsx         Duplicate an event
    │   ├── AssignEventsSheet.tsx       Bulk-assign events to a series
    │   ├── FinalizeEventSheet.tsx      Finalize and apply rating updates
    │   ├── StartKnockoutSheet.tsx      End RR, generate bracket
    │   ├── StandingsTable.tsx          Standings with tiebreakers
    │   ├── BracketView.tsx             Knockout bracket render
    │   └── RatingChart.tsx             Hand-rolled SVG line chart
    ├── lib/
    │   ├── auth.ts                     Password gate logic
    │   ├── supabase.ts                 Untyped Supabase client
    │   ├── utils.ts                    cn(), formatDate()
    │   ├── presets.ts                  Sport presets, tiebreaker labels
    │   ├── scheduler.ts                Berger, Americano, fixed-partners
    │   ├── scheduleSync.ts             Regenerate / append / push-to-back
    │   ├── glicko2.ts                  Pure Glicko-2 math
    │   ├── liveRatings.ts              Replay-based live rating recomputation
    │   ├── finalizeEvent.ts            Apply ratings on event end
    │   ├── standings.ts                computeStandings() + tiebreakers
    │   ├── bracket.ts                  Bracket layout / generation
    │   ├── startKnockout.ts            Generate bracket matches, advance winners
    │   ├── cloneEvent.ts               Event duplication
    │   └── export.ts                   CSV / JSON download helpers
    ├── pages/
    │   ├── EventsList.tsx
    │   ├── EventCreate.tsx             Wizard orchestration only
    │   ├── EventDetail.tsx             Main event hub (tabs, sheets, DnD roster)
    │   ├── PlayersList.tsx
    │   ├── PlayerProfile.tsx           Per-player tabs (still ~600 lines)
    │   ├── PairLeaderboard.tsx
    │   ├── SeriesList.tsx
    │   ├── SeriesDetail.tsx
    │   ├── Settings.tsx
    │   ├── Placeholder.tsx
    │   └── wizard/
    │       ├── types.ts                WizardState, STEPS, initialWizardState
    │       ├── FormField.tsx
    │       ├── Step1Basics.tsx
    │       ├── Step2Scoring.tsx
    │       ├── Step3Format.tsx
    │       ├── Step4Settings.tsx
    │       ├── Step5Players.tsx
    │       └── submit.ts               The full wizard → DB pipeline
    └── types/
        └── database.ts                 Hand-written types matching SQL schema
```

## 4. Database schema

Eight tables, all prefixed `rr_` (so they coexist with other Supabase
projects in a shared instance without colliding):

`rr_players` — one row per person who's ever played. Carries the
Glicko-2 singles and doubles ratings (`rating`, `rd`, `vol` for each)
plus aggregate `matches_played` and `last_played_at`.

`rr_pairs` — one row per ordered partnership. Used by Americano events
where a duo plays multiple matches together; carries pair-level Glicko
fields. Currently underused — pair ratings could feed back into seeding
later.

`rr_events` — the event row. Key fields: `mode` (`singles` |
`doubles_americano` | `doubles_partners`), `format` (`pure_rr` |
`rr_knockout` | `rr_final_bronze`), `scoring_template` (JSON, see
section 11), `config` (JSON: courts, tiebreakers, smart-scheduling
toggles, knockout depth, min rounds per player, etc.), `status`
(`draft` | `live` | `completed` | `archived`), and `series_id` for
optional series membership.

`rr_event_players` — join table between events and players. Carries
`seed`, `joined_at_round`, `withdrawn`, and an
`initial_rating_snapshot` JSON blob captured the moment the player
enters the event so live rating updates can replay from a stable
baseline (see section 8).

`rr_matches` — every scheduled match. The interesting fields:
`stage` (`group_rr` | `knockout` | `bronze` | `final`), `round` (the
sub-round after court splitting), `court`, `side_a_player_ids` /
`side_b_player_ids` (string[] of UUIDs), `status`, `winner_side`,
`scores` (JSON keyed by scoring template), and `group_label`. We
repurposed `group_label` to carry the parent Berger round id so the chip
strip can visually group sub-rounds that came from the same logical
Berger round (see section 12).

`rr_rating_history` and `rr_pair_rating_history` — append-only logs of
every rating change with the event id, mode, and pre/post values. Used
by the rating chart on player profiles.

`rr_audit_log` — schema is in place for an eventual "what changed when"
audit trail. UI not surfaced yet.

`rr_series` — added in migration 002. Lets multiple events roll up into
a season or league with cumulative standings.

RLS policies allow the anon key to read and write everything for now —
this is the testing posture, not the deployed posture (see section 14).

## 5. Event lifecycle and modes

An event flows through `draft → live → completed`, with `archived` as a
manual end state. Creation goes through a five-step wizard:

1. **Basics** — name, sport (presets like Pickleball, Tennis, Padel, or
   custom), date, and mode.
2. **Scoring** — `win_loss`, `first_to_points` (with points-to and
   win-by), `best_of_sets` (sets, set-to, win-by), or `timed`. Stored as
   a discriminated-union JSON in `scoring_template`.
3. **Format** — round-robin only, RR + knockout, or RR + final + bronze.
   Knockout depth is a slider (1 = final only, 2 = SF+F, 3 = QF onward,
   4 = R16 onward).
4. **Settings** — courts, optional cap on group-play rounds, smart-
   scheduling toggles, seeding strategy (by rating, random, or in the
   order added), and tiebreaker order.
5. **Players** — type names or pick from existing players. Reorderable
   pre-event by drag handle when the seeding strategy is "in the order
   I added them."

The wizard ends by inserting the event row, looking up or creating
players, capturing rating snapshots, generating the initial schedule,
and flipping the event to `live`. All in one submit pipeline in
`src/pages/wizard/submit.ts`.

There are three modes:

- **Singles.** Each player faces every other player exactly once.
  Berger / circle method, N − 1 rounds.
- **Doubles Americano.** Partners rotate every round. We use the same
  Berger generator but treat it as producing partnership pairings, then
  pair partnerships into matches sequentially. Cleanest when player
  count is divisible by 4; for other counts the Berger algorithm
  rotates the leftover partnership / bye player fairly across rounds.
- **Doubles fixed partners** (added later in the project). Each player
  keeps the same partner the whole event. Players in adjacent positions
  in the seed order pair up; Berger then runs between pairs, so each
  pair plays every other pair exactly once.

## 6. The scheduler

Lives in `src/lib/scheduler.ts`. Key functions:

`bergerPairings(playerIds)` — the standard "circle" method. Fix the
first player, rotate the rest. Returns N − 1 rounds with `floor(N/2)`
pairings per round, with byes inserted when N is odd.

`generateSinglesSchedule` — wraps bergerPairings into match objects
(`sideA = [a]`, `sideB = [b]`).

`generateDoublesAmericano` — wraps bergerPairings to produce
partnerships, then pairs up consecutive partnerships into matches.

`generateDoublesFixedPartners` — splits players into adjacent pairs,
runs bergerPairings on the pair set, expands each pairing back into a
4-player match.

`assignCourts` — the most subtle piece. Each Berger round contains
`floor(N/2)` matches; when that exceeds available courts the round gets
split into multiple sub-rounds. The function emits sub-rounds with
court numbers `1..K` (where K ≤ numCourts), and crucially preserves
the original Berger round number on each output match as `bergerRound`
so the UI can visually group sub-rounds back together.

`assignCourts` also implements the smart-scheduling toggles described
in section 7.

`generateOneRotation` — shorter helper used when extending the schedule
with another round mid-event ("Play another round" button). Generates
just enough Berger rounds for every active player to play once more,
then truncates.

`generateScheduleForMode` — the entry point. Dispatches on event mode
and applies any `min_rounds_per_player` cap.

## 7. Smart-scheduling toggles

All four are stored as booleans in `EventConfig`:

**`avoid_back_to_back`** — when a Berger round splits into sub-rounds,
prefer matches whose players just rested over matches whose players
just played. The cost function tracks the most recent sub-round each
player appeared in; lower scores win.

**`avoid_recent_matchups`** — extends the same scoring with a per-pair
recency tracker (every unordered pair of players who shared a court).
Repeat partners or repeat opponents get penalized when there are still
fresh matchups to schedule first. Useful in Americano events where we
re-generate the schedule mid-event after a roster change.

**`fill_empty_courts`** — when a Berger round has fewer matches than
courts, pull idle players in for bonus matches. Idle players are
preferred; if there aren't enough idle bodies, the least-played
already-on-court players get tagged in. Trades off strict round-robin
fairness (some matchups will repeat) for keeping every court busy. Off
by default for fixed-partners mode because it would force pairs to
repeat opponents.

**`min_rounds_per_player`** — a hard cap on group-play rounds. Honored
by the schedule generator (truncates the output) and by the regenerator
(only fills up to the cap when a roster change forces a regen). Useful
for big rosters where a full N − 1 round-robin would take all weekend.

## 8. Rating engine

We picked Glicko-2 (Glickman 2012) over plain Elo because it tracks
rating volatility per player, which matters when the same player can
disappear for months between events. Pure math implementation in
`src/lib/glicko2.ts` — period update, expected score function, etc.

The interesting design choice is **live ratings**:

When a player joins an event, we capture an `initial_rating_snapshot`
on the `rr_event_players` row — their full Glicko state at that moment.
After every score change, `recomputeLiveRatings(eventId)` replays every
completed match in the event in order, starting from each player's
snapshot, and writes the resulting "live" rating back to `rr_players`.
This means:

- Mid-event ratings reflect what's actually happened so far, so seeding
  for later regens or future events stays accurate.
- Editing a past score recomputes everything cleanly (replay from the
  same snapshot).
- The expensive period-batched update at event end becomes a clean
  diff: snapshot → final live rating → write a history row.

`src/lib/finalizeEvent.ts` handles the snapshot-to-final diff, writes
`rr_rating_history` entries, marks the event `completed`, and stamps
`completed_at`.

## 9. Roster management and substitutions

Three escape hatches for "the roster doesn't match the schedule
anymore":

**Pre-event roster reorder.** Before any match is played, the roster
tab on the event detail page is drag-reorderable. Drop indicators use
cursor Y position vs. row midpoint to show "above" / "below" so the
final position is unambiguous (and you can drop below the last row).
DB writes are optimistic + parallel — the local state updates first,
seeds 1..N are written in a `Promise.all`, and we don't `loadAll()`
afterward (which would reset scroll and feel janky). On error we
revert and toast.

**Player swap.** `PlayerSwapSheet` lets you replace one player in the
event with any other player in the database (or a brand-new name).
Updates every future match that included the outgoing player and
schedules a regen via `regenerateFutureSchedule`.

**Match-level substitute.** `MatchSubstituteSheet` covers the "X
twisted an ankle, Y is filling in for this match" case. Updates only
the specified match, then calls `pushPlayerToBack` so the subbed-in
player gets shuffled to the end of their other future matches —
keeping the workload balanced across the rest of the event.

The schedule regenerator (`regenerateFutureSchedule`) preserves any
match that's `completed`, `in_progress`, or has a recorded score, and
replaces only the strictly-scheduled tail. New rounds are appended
after the kept tail with offset round numbers and Berger group ids.

## 10. Standings, knockout, and series

**Standings** are computed in `src/lib/standings.ts` from completed
matches. Tiebreakers run in user-configured order (default: wins → head-
to-head → point differential → points scored → points conceded). Each
tiebreaker is a comparator that returns 0 to fall through to the next.
`StandingsTable.tsx` renders it with column tooltips and an
`onPlayerClick` that opens the player detail sheet.

**Knockout.** The "End RR" sheet lets the user freeze the round-robin
and generate a bracket from the current standings. Bracket depth is
configurable (1–4), with seeds drawn 1 vs N, 2 vs N−1, etc. TBD slots
are placeholders ("Awaiting earlier-round winner") that resolve on the
fly via `advanceKnockoutWinners` whenever a knockout match's score is
saved. Optional bronze match for 3rd place.

**Series.** A series is a folder for events. The series detail page
shows cumulative standings (every player's wins / losses / point diff
across every event in the series) plus a list of member events. We
added a "Manage events" sheet that bulk-assigns standalone events
into the series — much faster than editing each event individually.
Endless mode (no end date) is supported for ongoing pickup leagues.

## 11. UI patterns and design system

**Mobile-first.** Bottom nav on mobile, sidebar on desktop. All inputs
are 44px minimum tap target. Score entry is a bottom sheet with big
number steppers, not inline forms.

**Sheet over modal.** Almost every secondary flow (edit event, swap
player, finalize, delete confirm, clone, knockout start, score entry)
is a `Sheet` — a slide-up from the bottom on mobile, a side panel on
desktop. One pattern, many uses, predictable mental model.

**Palette.** Pantone-inspired tokens defined in HSL in `index.css`:

- Cloud Dancer (canvas) — soft warm cream
- Darkest Hour (ink) — near-black
- Blue Violet (brand / primary)
- Sun Glare (accent / live status)
- Exuberant Orange (destructive / forfeit)

Every text-on-fill pair was checked for WCAG AA contrast. The "Jump
to current round" link in the round navigator was originally yellow on
cream — failed AA badly — and got restyled as a primary-color pill
with an explicit focus ring.

**Typography.** Archivo Black for `<h1>` (display), Inter for body,
JetBrains Mono for tabular numbers. Body weight bumped to 500 for
heavier-than-default text that holds up against the bold visual system.
Base font size set to 18px for readability over 16px default.

**Bento cards** (`bento-card` utility). White on cream with a clear
border, no drop shadow. Reads as "lifted" through contrast alone, which
prints cleanly and looks good in dark mode.

**Status colors as design tokens.** Live, scheduled, completed,
forfeit, draft each have a paired bg + foreground token. Status badges
read these tokens so changing the palette in one place updates the
whole app.

## 12. Visual progression overview

The `RoundNavigator` started life as prev/next chevrons with a row of
tiny dots underneath. The dots were illegible and didn't communicate
state — every round looked the same. So they got upgraded to a chip
strip with three new behaviors:

**Per-round status color.** Live round = Sun Glare. Past or fully-done
= muted neutral. Future = neutral white. Final round (after the event
ends) = Darkest Hour. Status doesn't depend on which round you're
viewing — the live round is yellow whether or not your cursor is
on it.

**Selection ring.** A `ring-2 ring-primary ring-offset-2` on whichever
chip you're currently viewing, plus a slight `scale-[1.05]` lift.
Selection and status are visually orthogonal: if you're viewing the
live round, the chip is yellow with a ring. If you're viewing a past
round, the chip is muted with a ring. If you're viewing a future
round, the chip is white with a ring. The ring always tells you which
one you're on.

**Per-round progress.** Each chip shows `done/total` (e.g. `2/4`) for
in-progress rounds, or a `✓` once the round is fully resolved. A line
above the strip aggregates: `12 of 32 matches done · 2 in progress`.
On long events you can scan the strip and see exactly where the
bottleneck is.

**Berger sub-round grouping.** When a Berger round gets split because
you don't have enough courts, the resulting sub-rounds are now visually
tied together: a horizontal dash on the left edge of any chip that
continues a Berger group, plus a wider gap between unrelated groups.
There's also a contextual line under "Round 5 of 12" that reads
something like "Set 1 of 2 (split for court count)" so the relationship
is named, not just visual. For events created before we started
persisting `group_label`, the chip strip falls back to a heuristic:
two consecutive rounds whose player sets are completely disjoint must
be sub-rounds of the same Berger round (in Berger no player plays
twice in one round).

**Auto-scroll.** Whenever the active chip changes (prev/next, jump-to-
current, or direct chip click), the strip smoothly scrolls to keep the
active chip centered. Even on a 30-round event you never lose the
cursor.

## 13. Decisions log

A few places where the path wasn't obvious:

**Untyped Supabase client.** We tried generic-typing the client with a
hand-written `Database` type, but `@supabase/supabase-js` v2.105 added
stricter shape requirements (every table needs a `Relationships`
field, `__InternalSupabase` metadata, etc.). The maintenance cost of
keeping a hand-written `Database` valid wasn't worth it. The client is
typed as `SupabaseClient` (no generic), and call sites cast row results
to our own `EventRow`, `Player`, etc. types. We get type safety on the
shape we read; we lose autocomplete on column names in
`.from(...).select(...)`. Acceptable trade for a personal project.

**JSON columns over wide schemas.** `scoring_template` and `config`
are JSON because the shape varies by event type and adding columns
per scoring template would have ballooned the schema. Cost: occasional
TypeScript pain casting `scores: unknown` to the right shape at read
time. Benefit: schema changes are zero-migration.

**Live ratings replay from snapshot.** Considered live-updating ratings
incrementally as scores come in. Rejected because edits to past scores
would have required tracking "which scores have been applied." Replay
from snapshot is O(N) per recompute but N is tiny (one event's worth
of matches), and the code is dramatically simpler.

**Optimistic state for roster reorder.** First version was "update DB
then reload everything." Reloads reset scroll and felt awful. Switched
to optimistic local state + parallel `Promise.all` writes + revert-on-
error. This is the only place the app does optimistic updates; for
everything else the latency is low enough that loading state is fine.

**Berger sub-round tracking via `group_label`.** Considered a schema
migration to add a dedicated `berger_round` column. Decided to repurpose
the existing-but-unused `group_label` column instead (it was originally
intended for "Group A / Group B" RR splits, which we don't use). One
fewer migration; the column already had a string type and a sensible
name. The fallback heuristic for old events (disjoint player sets =
same Berger round) means we don't have to backfill.

**Pantone-inspired palette over a generic neutral.** The first version
used a muted gray palette and felt forgettable. The Pantone redesign
made the live state genuinely pop (Sun Glare yellow against cream is
hard to ignore) and gave the brand a recognizable feel. We kept WCAG AA
contrast checks for every paired text + background.

**Five-step wizard, not a single-screen form.** The wizard could be
one long scroll. We split it because the decisions cluster naturally
(basics, then scoring, then format, then settings, then players) and
each step has its own affordances — the scoring step has totally
different controls from the format step. Splitting also lets us
disable "Next" until the current step is valid, which is much cleaner
than scattering validation across one giant form.

**Click-and-drag roster reorder, not arrow buttons.** First version
had up/down arrows next to each row. Tested at 25 players and the
arrows felt prehistoric. HTML5 drag-and-drop was the obvious upgrade,
with the cursor-position drop-zone math (above midpoint = land above,
below midpoint = land below) making the interaction unambiguous even
at the bottom of the list.

**"Up next" reserved for the live round.** Originally every scheduled
match showed an "Up next" badge — across all future rounds. That
diluted the meaning. Now "Up next" only appears on scheduled matches
in the live round (the matches that will physically be played as soon
as a court frees up). Matches in future rounds get a quieter
"Scheduled" outline badge.

**Password gate over real auth.** Single client-side password check
because the app's audience for now is "me and my friends" and Supabase
Auth would have meant per-user RLS, account creation flows, and a real
backend layer. Tracked as the #1 thing to fix before sharing the URL
broadly.

## 14. Known limitations and backlog

**Auth.** The password gate is testing-grade. Anyone who opens DevTools
can bypass it and the anon key has full read/write on every table.
Before sharing the deployed URL more widely, switch to Supabase Auth
and tighten RLS policies to per-user scoping.

**`PlayerProfile.tsx` is monolithic.** Still around 600 lines with
Events / H2H / Partners / Recent / Rating tabs all in one file. Should
be split into `pages/player/` with one tab per file, mirroring how the
wizard was extracted.

**Audit log UI.** The `rr_audit_log` table exists but nothing reads
or writes it yet. Would surface "what changed mid-event" for shared
events.

**Venue display mode.** A simplified large-text view of the current
round for projecting on a venue screen. Designed but not built.

**Pair-level ratings underused.** `rr_pairs` and
`rr_pair_rating_history` exist but the seeding logic doesn't read
pair ratings yet.

**Match notes.** Per-match free-text notes (injuries, retirement,
unusual circumstances). Not implemented.

**Real-time updates.** Multiple admins editing the same event
simultaneously will overwrite each other. Supabase Realtime
subscriptions would fix this; not currently set up.

## 15. Deployment

Lives on Vercel as a static SPA backed by Supabase. The repo root has a
`vercel.json` with a single rewrite rule that sends every non-asset
path to `index.html` so React Router routes survive a hard refresh.

Three environment variables need to be set on Vercel for the build to
work:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_PASSWORD`

These come from your local `.env.local` and need to be added under
Vercel's Settings → Environment Variables (for Production at minimum;
ideally Preview too). Pushing to `main` triggers an auto-redeploy if
the project is GitHub-connected; otherwise you can run `vercel --prod`
from the project directory to deploy via the CLI.

The full setup walkthrough lives in `README.md` under "Deploying to
Vercel."
