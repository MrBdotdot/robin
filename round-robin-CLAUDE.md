# Round Robin Tournament Web App

Web-based tournament scheduler for round-robin events with support for singles and doubles tournaments, Berger scheduling, and live match tracking.

Status: Built

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- Supabase (PostgreSQL)
- UI components via shadcn/ui (button, card, input, badge, toaster)

## Key Features

- **Event creation wizard** with mode selection: singles, rotating-partners doubles, or fixed-partners doubles
- **Berger scheduling** for round-robin tournaments with automatic court capacity sub-rounds
- **Live match tracking** with status badges (Up next, Playing, Done, Scheduled, Forfeit, Cancelled)
- **Chip strip UI** showing round progression with color-coded status and visual grouping
- **Fixed-partners mode** — pairs control order in Step 5; Berger runs between pairs; validation ensures even player count
- **Match management** — add/edit matches, set scores, refill courts
- **Event detail view** with locked settings display

## Recent Fixes

- Chip strip vertical clipping fixed with `py-2` padding on scroll container
- "Up next" badge now restricted to live-round matches; future rounds show "Scheduled"
- Chip strip shows Berger grouping with `ml-4` gap and horizontal dash indicators
- Fixed-partners doubles mode added with pairing logic and validation

## Key Files

- `src/App.tsx` — main router and app shell
- `src/lib/supabase.ts` — Supabase client config
- `src/lib/auth.ts` — authentication logic
- `src/components/EventCard.tsx` — card display for event list
- `src/pages/EventsList.tsx` — main events view
- `package.json` — dependencies (react-router-dom, @supabase/supabase-js)
- `.env.local` — Supabase project URL and API key

## Commands

```bash
npm install
npm run dev          # Start Vite dev server
npm run build        # Build for production
npm run preview      # Preview production build
```

## Environment

- **Project root** `C:\Users\Bee\Documents\round-robin`
- **Deployment** Vercel (auto-deploys on git push)
- **Database** Supabase (migrations in `migration-001-initial-schema.sql`)

## Where to Pick Up

Main active work is in the tournament logic and UI refinement. Recent sessions focused on match status badge accuracy and doubles-mode pairing. Next steps likely include match refill logic validation and additional UX polish on the chip strip grouping display.
