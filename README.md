# Round Robin

Mobile-first round-robin tournament app. React + Vite + TypeScript + Tailwind, with a Supabase backend.

## Status

This is the initial scaffold. What's wired up:

- Password gate (default `415`)
- Mobile-first app shell with bottom nav (Events / Players / Settings)
- Events list page — loads from Supabase, with grouped sections by status, status badges, scheduled date display, and a prominent empty-state CTA
- Status accent colors and a pulsing "Live" badge
- Toast notifications via Sonner
- Routing scaffolded for: events list, event creation, event detail, players, settings (the last four are placeholders for now)

What's coming next: the event creation wizard, the schedule grid (rounds × courts), score entry, standings, the bracket view, and the rating engine.

## One-time setup

1. **Run the database migration.** Open your Supabase project's SQL editor (the one for this app, not Sherpa) and paste the contents of `migration-001-initial-schema.sql` (it lives next to this folder in `outputs/`). Click Run. You should see eight `rr_*` tables when you query `information_schema`.

2. **Install dependencies.** From inside the `round-robin/` folder:

   ```bash
   npm install
   ```

3. **Verify env vars.** A `.env.local` file has been created with your Supabase project URL, anon key, and the testing password. If you ever want to change the password or rotate keys, edit that file (it's gitignored).

4. **Start the dev server:**

   ```bash
   npm run dev
   ```

   Open the URL it prints (defaults to `http://localhost:5173`). Vite is configured to listen on all network interfaces, so any phone or tablet on the same wifi can also hit it via your machine's LAN IP — useful for mobile testing.

## Project layout

```
round-robin/
├── public/                    (will be added if static assets are needed)
├── src/
│   ├── components/
│   │   ├── ui/                primitive UI (Button, Card, Input, Badge, Toaster)
│   │   ├── AppShell.tsx       mobile-first app frame with bottom nav
│   │   ├── EventCard.tsx      event card used on the list
│   │   └── PasswordGate.tsx   simple password gate
│   ├── lib/
│   │   ├── auth.ts            password-gate logic, sessionStorage flag
│   │   ├── supabase.ts        typed Supabase client
│   │   └── utils.ts           cn() and formatDate()
│   ├── pages/
│   │   ├── EventsList.tsx     events list with grouped sections + empty state
│   │   └── Placeholder.tsx    "coming soon" fallback for unbuilt routes
│   ├── types/
│   │   └── database.ts        TypeScript types matching the SQL schema
│   ├── App.tsx                routing + providers
│   ├── main.tsx               entry point
│   ├── index.css              Tailwind + theme tokens
│   └── vite-env.d.ts          Vite env typings
├── .env.example               template
├── .env.local                 actual env (gitignored, includes your keys)
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
└── vite.config.ts
```

## Design choices baked in

- **Mobile-first.** Bottom nav on mobile, sidebar on desktop. All inputs ≥44px tall. Score entry will be a bottom sheet with big number steppers.
- **Status colors are theme tokens.** `live`, `completed`, `scheduled`, `forfeit` colors are defined in `index.css` as CSS variables and mapped into Tailwind in `tailwind.config.js`. Change them in one place if you want a different palette.
- **Glicko-2 ratings live on the player.** Singles and doubles are tracked separately. Pair-level ratings live on `rr_pairs`. The rating engine itself is not yet implemented.
- **Password gate is testing-grade.** Real auth before any public deployment should use Supabase Auth + tightened RLS policies.

## Deploying to Vercel

This app is a static SPA backed by Supabase, so Vercel is a good fit. There's a `vercel.json` in the repo that rewrites all non-asset paths to `index.html` so React Router routes survive a hard refresh.

**One-time setup:**

1. **Initialize git + push to GitHub** (if you haven't already):

   ```bash
   cd round-robin
   git init
   git add .
   git commit -m "Initial commit"
   ```

   Then create a new empty repo on GitHub and follow its "push an existing repository" instructions (`git remote add origin …` then `git push -u origin main`).

2. **Import the repo on Vercel.** Go to [vercel.com/new](https://vercel.com/new), pick the GitHub repo, and accept the defaults — Vercel will auto-detect Vite (build command `npm run build`, output `dist`).

3. **Set environment variables** in the Vercel project's Settings → Environment Variables. All three need to be set for Production (and ideally Preview too):

   - `VITE_SUPABASE_URL` — same value as in your local `.env.local`
   - `VITE_SUPABASE_ANON_KEY` — same value as in your local `.env.local`
   - `VITE_APP_PASSWORD` — the password you want gating the app (e.g. `415`)

4. **Deploy.** Click Deploy. Subsequent pushes to `main` will redeploy automatically.

**Alternative: deploy via Vercel CLI** without GitHub:

```bash
npm install -g vercel
vercel login
vercel               # first run links the project
vercel --prod        # deploys to production
```

You'll still need to set the three env vars from step 3 — either via the CLI (`vercel env add VITE_SUPABASE_URL`) or the Vercel dashboard.

**A note on Supabase RLS.** The current schema lets the anon key read/write everything (it's a single-user testing setup gated by a password the client checks). Before sharing the deployed URL widely, tighten RLS policies on the `rr_*` tables — or move to Supabase Auth.

## Next steps

When you're ready to keep building, the next pieces in priority order:

1. **Real auth.** Replace the client-side password gate with Supabase Auth and tighten RLS so the anon key alone can't read/write data.
2. **Player profile modularization.** `PlayerProfile.tsx` is still ~600 lines — split it into a folder under `pages/player/` with one tab per file.
3. **Match notes / event audit log.** Schema is already there (`rr_audit_log`); needs UI surfacing.
4. **Venue / display mode.** A simplified, large-text view of the current round for projecting on a venue screen.
