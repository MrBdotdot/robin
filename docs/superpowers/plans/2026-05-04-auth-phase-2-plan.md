# Phase 2 Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the password gate with magic-link sign-in, introduce three-role memberships (admin / scorekeeper / participant), per-event scorekeeper assignment, an invite system with email + copy-link delivery, and tightened RLS — all delivered as a two-deploy cutover.

**Architecture:** Single-tenant. New tables `rr_memberships`, `rr_invites`, `rr_event_collaborators`. Helper SQL functions encapsulate role checks for RLS. Frontend uses Supabase magic-link auth, a `useMembership()` hook for role-aware gating, and a `/me` participant home that ships with empty placeholders pending sub-project 2.

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind, Supabase (Postgres + Auth + Edge Functions), React Router v6, sonner for toasts. Tests bootstrapped via vitest as part of Task 1.

**Spec:** [docs/superpowers/specs/2026-05-04-auth-phase-2-design.md](../specs/2026-05-04-auth-phase-2-design.md)

---

## File structure

**New files:**

```
migrations/
  migration-001-initial-schema.sql           (copy from old session output — D3 backfill)
  migration-002-rating-history.sql           (copy from old session output)
  migration-003-series-ratings.sql           (copy from old session output)
  migration-004-auth-phase-2.sql             (Task 3)
  migration-005-rls-tighten.sql              (Task 4)

src/lib/
  membership.ts                              (Task 7) — useMembership() hook
  permissions.ts                             (Task 8) — role-aware UI helpers
  __tests__/permissions.test.ts              (Task 8) — unit tests

src/components/
  AvatarMenu.tsx                             (Task 11) — top-right menu
  InviteSheet.tsx                            (Task 12) — admin sends invites
  AssignScorekeepersSheet.tsx                (Task 15) — per-event assignment

src/pages/
  Me.tsx                                     (Task 16) — participant home
  Invite.tsx                                 (Task 14) — /invite/:token redemption

supabase/functions/send-invite/
  index.ts                                   (Task 13) — Edge Function

vitest.config.ts                             (Task 1) — test config
src/test/setup.ts                            (Task 1) — test bootstrap
```

**Modified files:**

```
package.json                                 (Task 1) — add vitest devDeps + test script
src/lib/supabase.ts                          (Task 6) — flip persistSession to true
src/lib/auth.ts                              (Task 6) — magic-link rewrite
src/components/AuthGate.tsx                  (Task 9) — magic-link UI
src/components/AppShell.tsx                  (Task 11) — avatar menu + role-aware nav
src/types/database.ts                        (Task 5) — types for new tables
src/App.tsx                                  (Task 10) — /me, /invite/:token, redirects
src/pages/EventDetail.tsx                    (Task 15, 17) — scorekeeper section + edit chrome gating
src/pages/SeriesDetail.tsx                   (Task 18) — edit chrome gating
.env.local.example                           (Task 6) — drop VITE_APP_PASSWORD
```

---

## Phase A — Foundation

### Task 1: Bootstrap vitest

**Why:** Project has zero tests. Plan needs unit tests on permissions logic and the membership hook. Vitest is the obvious pick for a Vite project.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Install vitest + jsdom + testing-library**

```bash
npm install --save-dev vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: packages added to `package.json` devDependencies.

- [ ] **Step 2: Add test scripts to `package.json`**

Edit `package.json` and add to the `scripts` block:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "tsc -b --noEmit",
  "test": "vitest",
  "test:run": "vitest run",
  "test:ui": "vitest --ui"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Smoke test — write a trivial passing test**

Create `src/test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
npm run test:run
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/
git commit -m "chore: add vitest test framework"
```

---

### Task 2: Create migrations folder + backfill 001/002/003

**Why:** Spec D3 polish item — old migrations live outside the repo. Phase 2 wants them tracked alongside 004/005.

**Files:**
- Create: `migrations/migration-001-initial-schema.sql`
- Create: `migrations/migration-002-rating-history.sql`
- Create: `migrations/migration-003-series-ratings.sql`
- Create: `migrations/README.md`

- [ ] **Step 1: Locate the old migration SQL**

The migrations live in old session output folders or were applied directly via Supabase Studio. Two paths:

  a. If you have the original SQL, copy it into the three files above verbatim.
  b. If not, dump the current schema from your Supabase project: in Supabase Studio → Database → Schema → "Generate SQL" or via `pg_dump --schema-only`. Split by feature (initial / rating-history / series-ratings) using git history of `src/types/database.ts` as a guide for what was added when.

If unsure or unable to recover, write a single `migration-001-current-schema.sql` capturing today's state and skip the split. **Do not block Phase 2 on this** — D3 is polish, not load-bearing for Phase 2 functionality.

- [ ] **Step 2: Create `migrations/README.md`**

```markdown
# Migrations

SQL migrations for the Round Robin Supabase database, applied manually
in the Supabase SQL editor in numeric order.

| File | Adds |
|---|---|
| migration-001-initial-schema.sql | Core schema: rr_players, rr_pairs, rr_events, rr_event_players, rr_matches, rr_series |
| migration-002-rating-history.sql | rr_rating_history, rr_pair_rating_history |
| migration-003-series-ratings.sql | rr_series_ratings + series block in initial_rating_snapshot |
| migration-004-auth-phase-2.sql | rr_memberships, rr_invites, rr_event_collaborators, helper functions |
| migration-005-rls-tighten.sql | RLS policies for the three-role model (apply only after deploy 1 sign-in) |

## Applying

1. Open the SQL editor in Supabase Studio.
2. Run each new migration in numeric order, one at a time.
3. Verify with the `select` queries at the bottom of each file.
```

- [ ] **Step 3: Commit**

```bash
git add migrations/
git commit -m "chore(migrations): copy 001-003 into source-controlled migrations/ folder"
```

---

### Task 3: Migration 004 — new tables + helper functions

**Why:** Adds `rr_memberships`, `rr_invites`, `rr_event_collaborators`, the helper functions used by RLS, and the `lookup_invite` RPC.

**Files:**
- Create: `migrations/migration-004-auth-phase-2.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migration-004-auth-phase-2.sql
-- Adds the auth/membership/invite tables and helper functions.
-- RLS policies live in migration-005 so the bootstrap sign-in can run
-- against permissive policies first.

begin;

-- =========================================================================
-- Tables
-- =========================================================================

create table rr_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','scorekeeper','participant')),
  created_at  timestamptz not null default now()
);

create index rr_memberships_user_id_idx on rr_memberships (user_id);

create table rr_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null check (role in ('admin','scorekeeper','participant')),
  token       text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create index rr_invites_token_idx on rr_invites (token);
create index rr_invites_email_idx on rr_invites (email);

create table rr_event_collaborators (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_id    uuid not null references rr_events(id) on delete cascade,
  granted_by  uuid not null references auth.users(id),
  granted_at  timestamptz not null default now(),
  unique (user_id, event_id)
);

create index rr_event_collaborators_user_id_idx on rr_event_collaborators (user_id);
create index rr_event_collaborators_event_id_idx on rr_event_collaborators (event_id);

-- =========================================================================
-- Helper functions
-- =========================================================================

-- True if the calling user has any membership row.
create or replace function rr_is_member()
returns boolean language sql stable as $$
  select exists (select 1 from rr_memberships where user_id = auth.uid());
$$;

-- True if the calling user is an admin.
create or replace function rr_is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from rr_memberships
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- True if the calling user is a scorekeeper for the given event.
-- Existence of an rr_event_collaborators row is the source of truth;
-- we additionally require the user has the scorekeeper role to avoid
-- granting score-edit power to a stale collaborator row after a role change.
create or replace function rr_can_score(_event_id uuid)
returns boolean language sql stable as $$
  select rr_is_admin()
      or exists (
           select 1 from rr_event_collaborators ec
           join rr_memberships m on m.user_id = ec.user_id
           where ec.user_id = auth.uid()
             and ec.event_id = _event_id
             and m.role = 'scorekeeper'
         );
$$;

-- Phase 2 stub: returns false. Sub-project 2 (slim claim) replaces this
-- with claim-aware logic that joins rr_event_players on rr_players.claimed_by_user_id.
create or replace function rr_is_in_event(_event_id uuid)
returns boolean language sql stable as $$
  select false;
$$;

-- =========================================================================
-- RPC: anon-callable invite lookup by token (capability-style auth)
-- =========================================================================

create or replace function lookup_invite(_token text)
returns table (
  id uuid,
  email text,
  role text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, email, role, expires_at, accepted_at
  from rr_invites
  where token = _token
  limit 1;
$$;

grant execute on function lookup_invite(text) to anon, authenticated;

-- =========================================================================
-- Verification
-- =========================================================================

-- After running, sanity-check:
select 'rr_memberships' as table_name, count(*) from rr_memberships
union all
select 'rr_invites', count(*) from rr_invites
union all
select 'rr_event_collaborators', count(*) from rr_event_collaborators;

-- Expected: all three return 0 rows.

commit;
```

- [ ] **Step 2: Apply against your dev Supabase**

Open Supabase Studio → SQL Editor. Paste the contents above. Run.

Expected: three new tables visible in Database → Tables. The verification select returns three rows, all with count 0.

- [ ] **Step 3: Spot-check helper functions**

Run in the SQL editor:

```sql
select rr_is_admin();        -- expect: false (no membership rows yet)
select rr_is_member();       -- expect: false
select rr_is_in_event(gen_random_uuid()); -- expect: false (stub)
```

- [ ] **Step 4: Commit**

```bash
git add migrations/migration-004-auth-phase-2.sql
git commit -m "feat(db): add rr_memberships, rr_invites, rr_event_collaborators + helpers (migration-004)"
```

---

### Task 4: Migration 005 — RLS tightening

**Why:** Replaces the permissive "anon: do anything" policies with three-role-aware policies on every `rr_*` table. Applied AFTER bootstrap sign-in (see Task 19 cutover).

**Files:**
- Create: `migrations/migration-005-rls-tighten.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migration-005-rls-tighten.sql
-- Tightens RLS across every rr_* table to use the three-role model.
-- IMPORTANT: apply only AFTER the owner has signed in via magic link
-- (so an admin membership row exists). Otherwise you lock yourself out.

begin;

-- =========================================================================
-- Drop old permissive policies. Names assumed from migration-001; adjust if
-- your policies are named differently. List them in Supabase Studio first
-- if unsure: select tablename, policyname from pg_policies where tablename like 'rr_%';
-- =========================================================================

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename like 'rr_%'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- =========================================================================
-- Helper macro pattern repeated below: each existing data table gets
-- read by admin/member-of-event/collaborator, and writes restricted to admin
-- (with rr_matches.update having the scorekeeper exception).
-- =========================================================================

-- ---- rr_players ----------------------------------------------------------
alter table rr_players enable row level security;

create policy rr_players_select on rr_players for select using (
  rr_is_admin()
  -- non-admin scope: self + co-players in events they're in.
  -- Phase 2 stub: rr_is_in_event returns false, so non-admins see nothing here.
  -- Sub-project 2 will replace rr_is_in_event and add a "self via claim" branch.
  or exists (
    select 1 from rr_event_players ep
    where ep.player_id = rr_players.id
      and rr_is_in_event(ep.event_id)
  )
);

create policy rr_players_insert on rr_players for insert with check (rr_is_admin());
create policy rr_players_update on rr_players for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_players_delete on rr_players for delete using (rr_is_admin());

-- ---- rr_pairs ------------------------------------------------------------
alter table rr_pairs enable row level security;

create policy rr_pairs_select on rr_pairs for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_event_players ep
    where (ep.player_id = rr_pairs.player_a_id or ep.player_id = rr_pairs.player_b_id)
      and rr_is_in_event(ep.event_id)
  )
);

create policy rr_pairs_insert on rr_pairs for insert with check (rr_is_admin());
create policy rr_pairs_update on rr_pairs for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_pairs_delete on rr_pairs for delete using (rr_is_admin());

-- ---- rr_events -----------------------------------------------------------
alter table rr_events enable row level security;

create policy rr_events_select on rr_events for select using (
  rr_is_admin()
  or rr_is_in_event(id)
  or exists (
    select 1 from rr_event_collaborators
    where event_id = rr_events.id and user_id = auth.uid()
  )
);

create policy rr_events_insert on rr_events for insert with check (rr_is_admin());
create policy rr_events_update on rr_events for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_events_delete on rr_events for delete using (rr_is_admin());

-- ---- rr_event_players ----------------------------------------------------
alter table rr_event_players enable row level security;

create policy rr_event_players_select on rr_event_players for select using (
  rr_is_admin()
  or rr_is_in_event(event_id)
  or exists (
    select 1 from rr_event_collaborators
    where event_id = rr_event_players.event_id and user_id = auth.uid()
  )
);

create policy rr_event_players_insert on rr_event_players for insert with check (rr_is_admin());
create policy rr_event_players_update on rr_event_players for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_event_players_delete on rr_event_players for delete using (rr_is_admin());

-- ---- rr_matches ----------------------------------------------------------
alter table rr_matches enable row level security;

create policy rr_matches_select on rr_matches for select using (
  rr_is_admin()
  or rr_is_in_event(event_id)
  or exists (
    select 1 from rr_event_collaborators
    where event_id = rr_matches.event_id and user_id = auth.uid()
  )
);

create policy rr_matches_insert on rr_matches for insert with check (rr_is_admin());

-- The scorekeeper exception lives only on update, and only on score-related
-- columns. Postgres RLS doesn't gate columns directly — we accept that any
-- update by a scorekeeper passes RLS, and rely on the frontend to limit edits
-- to score fields. (A trigger could enforce this, deferred — see open knobs.)
create policy rr_matches_update on rr_matches for update
  using (rr_can_score(event_id))
  with check (rr_can_score(event_id));

create policy rr_matches_delete on rr_matches for delete using (rr_is_admin());

-- ---- rr_series ----------------------------------------------------------
alter table rr_series enable row level security;

create policy rr_series_select on rr_series for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_events e
    where e.series_id = rr_series.id and rr_is_in_event(e.id)
  )
);

create policy rr_series_insert on rr_series for insert with check (rr_is_admin());
create policy rr_series_update on rr_series for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_series_delete on rr_series for delete using (rr_is_admin());

-- ---- rr_series_ratings ---------------------------------------------------
alter table rr_series_ratings enable row level security;

create policy rr_series_ratings_select on rr_series_ratings for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_event_players ep
    join rr_events e on e.id = ep.event_id
    where ep.player_id = rr_series_ratings.player_id
      and e.series_id = rr_series_ratings.series_id
      and rr_is_in_event(e.id)
  )
);

create policy rr_series_ratings_write on rr_series_ratings for all using (rr_is_admin()) with check (rr_is_admin());

-- ---- rr_rating_history + rr_pair_rating_history --------------------------
alter table rr_rating_history enable row level security;
create policy rr_rating_history_select on rr_rating_history for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_event_players ep
    where ep.player_id = rr_rating_history.player_id
      and rr_is_in_event(ep.event_id)
  )
);
create policy rr_rating_history_write on rr_rating_history for all using (rr_is_admin()) with check (rr_is_admin());

alter table rr_pair_rating_history enable row level security;
create policy rr_pair_rating_history_select on rr_pair_rating_history for select using (rr_is_admin());
create policy rr_pair_rating_history_write on rr_pair_rating_history for all using (rr_is_admin()) with check (rr_is_admin());

-- =========================================================================
-- Phase 2 tables
-- =========================================================================

-- rr_memberships: own row visible to self; admins see all; writes admin-only
alter table rr_memberships enable row level security;

create policy rr_memberships_select_self on rr_memberships for select using (
  user_id = auth.uid() or rr_is_admin()
);
create policy rr_memberships_insert_admin on rr_memberships for insert with check (rr_is_admin());
create policy rr_memberships_update_admin on rr_memberships for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_memberships_delete_admin on rr_memberships for delete using (rr_is_admin());

-- rr_invites: admin-only for direct table access. Anon redemption goes
-- through the lookup_invite RPC (security definer) defined in migration-004.
alter table rr_invites enable row level security;

create policy rr_invites_select_admin on rr_invites for select using (rr_is_admin());
create policy rr_invites_insert_admin on rr_invites for insert with check (rr_is_admin());
create policy rr_invites_update_admin on rr_invites for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_invites_delete_admin on rr_invites for delete using (rr_is_admin());

-- rr_event_collaborators: admin sees all; user sees own rows; writes admin-only
alter table rr_event_collaborators enable row level security;

create policy rr_event_collaborators_select on rr_event_collaborators for select using (
  user_id = auth.uid() or rr_is_admin()
);
create policy rr_event_collaborators_insert_admin on rr_event_collaborators for insert with check (rr_is_admin());
create policy rr_event_collaborators_update_admin on rr_event_collaborators for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_event_collaborators_delete_admin on rr_event_collaborators for delete using (rr_is_admin());

-- =========================================================================
-- Special-case: invite-acceptance must be able to insert a membership row
-- and update the invite (mark accepted_at). We expose this via a security
-- definer RPC instead of granting raw write access.
-- =========================================================================

create or replace function accept_invite(_token text)
returns rr_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  inv rr_invites%rowtype;
  membership rr_memberships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invite';
  end if;

  select * into inv from rr_invites where token = _token;
  if not found then
    raise exception 'invite not found';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invite already accepted';
  end if;
  if inv.expires_at < now() then
    raise exception 'invite expired';
  end if;

  -- Idempotent: if user already has a membership, return it without altering role.
  select * into membership from rr_memberships where user_id = auth.uid();
  if found then
    update rr_invites set accepted_at = now() where id = inv.id;
    return membership;
  end if;

  insert into rr_memberships (user_id, role) values (auth.uid(), inv.role)
  returning * into membership;

  update rr_invites set accepted_at = now() where id = inv.id;
  return membership;
end;
$$;

grant execute on function accept_invite(text) to authenticated;

-- Bootstrap sign-in helper: idempotent membership creation for new sign-ins.
-- First user to call this (with no admin existing) becomes admin; rest become participants.
create or replace function bootstrap_membership()
returns rr_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  membership rr_memberships%rowtype;
  has_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select * into membership from rr_memberships where user_id = auth.uid();
  if found then
    return membership;
  end if;

  select exists (select 1 from rr_memberships where role = 'admin') into has_admin;

  insert into rr_memberships (user_id, role)
  values (auth.uid(), case when has_admin then 'participant' else 'admin' end)
  returning * into membership;

  return membership;
end;
$$;

grant execute on function bootstrap_membership() to authenticated;

commit;
```

- [ ] **Step 2: Do NOT apply yet**

This migration runs at deploy 2, after the bootstrap sign-in in deploy 1. The cutover order is in Task 19.

- [ ] **Step 3: Commit**

```bash
git add migrations/migration-005-rls-tighten.sql
git commit -m "feat(db): RLS policies for three-role auth (migration-005)"
```

---

### Task 5: Update database types

**Why:** Frontend code needs typed access to the new tables.

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Append type definitions**

Open `src/types/database.ts` and append:

```ts
// =========================================================================
// Phase 2 — auth, memberships, invites, scorekeeper assignment
// =========================================================================

export type Role = "admin" | "scorekeeper" | "participant";

export interface Membership {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_by: string;
  created_at: string;
}

/** Result of the lookup_invite RPC (subset of Invite, no token/created_by). */
export interface InviteLookup {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
}

export interface EventCollaborator {
  id: string;
  user_id: string;
  event_id: string;
  granted_by: string;
  granted_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add Role, Membership, Invite, EventCollaborator"
```

---

## Phase B — Auth core

### Task 6: Magic-link auth (rewrite `src/lib/auth.ts`)

**Why:** Replaces email/password with magic link. Flips Supabase client's session persistence on so users stay signed in across reloads.

**Files:**
- Modify: `src/lib/supabase.ts`
- Modify: `src/lib/auth.ts`
- Modify: `.env.local` (manual — drop `VITE_APP_PASSWORD`)

- [ ] **Step 1: Update `src/lib/supabase.ts`**

Replace the `auth` config block:

```ts
export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
```

`detectSessionInUrl: true` is the default but we're being explicit because magic-link flow round-trips through the URL hash.

- [ ] **Step 2: Rewrite `src/lib/auth.ts`**

```ts
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Magic-link auth wrappers. Phase 2: replaces email/password.
 *
 * Sign-in flow:
 *   1. User enters email, app calls signInWithMagicLink().
 *   2. Supabase emails them a one-time link.
 *   3. They click; the app loads with a session in the URL hash.
 *   4. supabase-js detects the session and fires onAuthStateChange.
 *   5. AuthGate's session subscription updates and renders children.
 */

type SessionState = Session | null | "loading";

export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>("loading");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return session;
}

export async function signInWithMagicLink(email: string, redirectTo?: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectTo ?? window.location.origin,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
```

- [ ] **Step 3: Drop `VITE_APP_PASSWORD` from `.env.local`**

Manual step. Open `.env.local` and remove the `VITE_APP_PASSWORD=...` line. Update `.env.local.example` if it exists.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS. (The old `signIn`/`signUp` functions were exported; `AuthGate.tsx` imports them and will break — that's Task 9.)

If TypeScript errors here are only about `AuthGate.tsx` referencing the old `signIn`/`signUp`/`useSession` — that's expected and resolved in Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/supabase.ts
git commit -m "feat(auth): magic-link sign-in (replaces email/password)"
```

---

### Task 7: useMembership hook

**Why:** Single source of truth for "which role is this user?" Used by every gate in the UI.

**Files:**
- Create: `src/lib/membership.ts`
- Create: `src/lib/__tests__/membership.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/membership.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMembership } from "../membership";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";

const mockSession = (userId: string | null) => {
  (supabase.auth.getSession as any).mockResolvedValue({
    data: { session: userId ? { user: { id: userId } } : null },
  });
};

const mockMembershipRow = (role: string | null) => {
  (supabase.from as any).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: role ? { id: "m1", user_id: "u1", role, created_at: "now" } : null,
          error: null,
        }),
      }),
    }),
  });
};

describe("useMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no session", async () => {
    mockSession(null);
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership).toBeNull();
  });

  it("returns the membership row for a signed-in user", async () => {
    mockSession("u1");
    mockMembershipRow("admin");
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership?.role).toBe("admin");
  });

  it("returns null membership when user has no row yet", async () => {
    mockSession("u1");
    mockMembershipRow(null);
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm run test:run -- membership
```

Expected: FAIL ("Cannot find module '../membership'").

- [ ] **Step 3: Implement `src/lib/membership.ts`**

```ts
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Membership } from "@/types/database";

type Status = "loading" | "ready";
interface MembershipState {
  status: Status;
  membership: Membership | null;
}

/**
 * Subscribes to the current user's membership row. Returns null when
 * not signed in or when the user has no row yet (e.g. first sign-in
 * before bootstrap_membership has run).
 */
export function useMembership(): MembershipState {
  const [state, setState] = useState<MembershipState>({ status: "loading", membership: null });

  useEffect(() => {
    let active = true;

    const fetchMembership = async (userId: string | null) => {
      if (!userId) {
        if (active) setState({ status: "ready", membership: null });
        return;
      }
      const { data, error } = await supabase
        .from("rr_memberships")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        // RLS may block this for anon users; treat as "no membership".
        setState({ status: "ready", membership: null });
        return;
      }
      setState({ status: "ready", membership: (data as Membership | null) ?? null });
    };

    supabase.auth.getSession().then(({ data }) => {
      fetchMembership(data.session?.user.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      fetchMembership(session?.user.id ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Calls the bootstrap_membership RPC. Idempotent — safe to call on every sign-in.
 * First signed-in user with no admin existing becomes admin; everyone else becomes participant.
 */
export async function bootstrapMembership(): Promise<Membership> {
  const { data, error } = await supabase.rpc("bootstrap_membership");
  if (error) throw error;
  return data as Membership;
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- membership
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/membership.ts src/lib/__tests__/membership.test.tsx
git commit -m "feat(auth): useMembership hook + bootstrapMembership RPC wrapper"
```

---

### Task 8: Permissions helpers

**Why:** UI gating. `canCreateEvent`, `canScoreEvent`, `canSeeEvent` etc. — small pure functions used by every page.

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `src/lib/__tests__/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canCreateEvent,
  canEditEvent,
  canScoreEvent,
  canViewEditChrome,
  isAdmin,
  isScorekeeper,
  isParticipant,
} from "../permissions";
import type { Membership, EventCollaborator } from "@/types/database";

const m = (role: Membership["role"]): Membership => ({
  id: "m",
  user_id: "u",
  role,
  created_at: "",
});

describe("permissions", () => {
  describe("isAdmin / isScorekeeper / isParticipant", () => {
    it("admin", () => {
      expect(isAdmin(m("admin"))).toBe(true);
      expect(isAdmin(m("scorekeeper"))).toBe(false);
      expect(isAdmin(null)).toBe(false);
    });
    it("scorekeeper", () => {
      expect(isScorekeeper(m("scorekeeper"))).toBe(true);
      expect(isScorekeeper(m("admin"))).toBe(false);
    });
    it("participant", () => {
      expect(isParticipant(m("participant"))).toBe(true);
      expect(isParticipant(m("admin"))).toBe(false);
    });
  });

  describe("canCreateEvent", () => {
    it("admin only", () => {
      expect(canCreateEvent(m("admin"))).toBe(true);
      expect(canCreateEvent(m("scorekeeper"))).toBe(false);
      expect(canCreateEvent(m("participant"))).toBe(false);
      expect(canCreateEvent(null)).toBe(false);
    });
  });

  describe("canEditEvent", () => {
    it("admin only", () => {
      expect(canEditEvent(m("admin"))).toBe(true);
      expect(canEditEvent(m("scorekeeper"))).toBe(false);
    });
  });

  describe("canScoreEvent", () => {
    const collab = (userId: string, eventId: string): EventCollaborator => ({
      id: "c",
      user_id: userId,
      event_id: eventId,
      granted_by: "g",
      granted_at: "",
    });

    it("admin can score any event", () => {
      expect(canScoreEvent(m("admin"), "u", "e1", [])).toBe(true);
    });
    it("scorekeeper with collaborator row for the event", () => {
      expect(canScoreEvent(m("scorekeeper"), "u", "e1", [collab("u", "e1")])).toBe(true);
    });
    it("scorekeeper without collaborator row for the event", () => {
      expect(canScoreEvent(m("scorekeeper"), "u", "e1", [collab("u", "e2")])).toBe(false);
    });
    it("participant cannot score", () => {
      expect(canScoreEvent(m("participant"), "u", "e1", [collab("u", "e1")])).toBe(false);
    });
    it("no membership cannot score", () => {
      expect(canScoreEvent(null, "u", "e1", [])).toBe(false);
    });
  });

  describe("canViewEditChrome", () => {
    it("admin shows edit chrome", () => {
      expect(canViewEditChrome(m("admin"))).toBe(true);
    });
    it("non-admin hides edit chrome", () => {
      expect(canViewEditChrome(m("scorekeeper"))).toBe(false);
      expect(canViewEditChrome(m("participant"))).toBe(false);
      expect(canViewEditChrome(null)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm run test:run -- permissions
```

Expected: FAIL ("Cannot find module '../permissions'").

- [ ] **Step 3: Implement `src/lib/permissions.ts`**

```ts
import type { Membership, EventCollaborator } from "@/types/database";

export function isAdmin(m: Membership | null): boolean {
  return m?.role === "admin";
}

export function isScorekeeper(m: Membership | null): boolean {
  return m?.role === "scorekeeper";
}

export function isParticipant(m: Membership | null): boolean {
  return m?.role === "participant";
}

export function canCreateEvent(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canEditEvent(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canFinalizeEvent(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canEditRoster(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canSendInvites(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canAssignScorekeepers(m: Membership | null): boolean {
  return isAdmin(m);
}

/**
 * True iff the user can edit scores on a specific event. Admin always;
 * scorekeeper iff they have an EventCollaborator row for that event.
 */
export function canScoreEvent(
  m: Membership | null,
  userId: string,
  eventId: string,
  collaborators: EventCollaborator[]
): boolean {
  if (isAdmin(m)) return true;
  if (!isScorekeeper(m)) return false;
  return collaborators.some((c) => c.user_id === userId && c.event_id === eventId);
}

/** Convenience: should we show edit/finalize/add-match buttons on event detail pages? */
export function canViewEditChrome(m: Membership | null): boolean {
  return isAdmin(m);
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- permissions
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/__tests__/permissions.test.ts
git commit -m "feat(auth): permissions helpers (canCreateEvent, canScoreEvent, ...)"
```

---

### Task 9: AuthGate — magic-link UI

**Why:** Replace the password form with a single email field. The signed-in side calls `bootstrapMembership()` once on first render so the admin row gets created during deploy 1.

**Files:**
- Modify: `src/components/AuthGate.tsx`

- [ ] **Step 1: Replace `src/components/AuthGate.tsx`**

```tsx
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Lock, Mail } from "lucide-react";
import { signInWithMagicLink, useSession } from "@/lib/auth";
import { bootstrapMembership } from "@/lib/membership";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const session = useSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // Bootstrap the membership row on first sign-in. Idempotent.
  useEffect(() => {
    if (session && session !== "loading") {
      bootstrapMembership().catch((e) => {
        console.error("bootstrap_membership failed:", e);
      });
    }
  }, [session]);

  if (session === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/30 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (session) {
    return <>{children}</>;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Preserve invite token if user landed via /invite/:token
      const path = window.location.pathname;
      const redirectTo = path.startsWith("/invite/")
        ? `${window.location.origin}${path}`
        : window.location.origin;
      await signInWithMagicLink(email, redirectTo);
      setLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Round Robin
          </CardTitle>
          <CardDescription>
            {linkSent
              ? "Check your email for a sign-in link."
              : "Enter your email; we'll send you a one-time link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkSent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground">
              <Mail className="h-8 w-8 text-primary" />
              <p>
                We sent a link to <strong>{email}</strong>. Open it on this device
                to sign in.
              </p>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => {
                  setLinkSent(false);
                  setEmail("");
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={submitting || !email}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send me a link"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manually verify in dev server**

```bash
npm run dev
```

Then in your browser:

1. Sign out if signed in (or use an incognito window).
2. Navigate to the app — see the new magic-link form.
3. Submit your email. See "Check your email" state.
4. Open the email, click the link.
5. App loads signed in.

Verify in Supabase Studio: a row exists in `rr_memberships` with your `user_id` and `role = 'admin'`.

If this is your first sign-in after the migrations: the bootstrap RPC creates an admin row because no admin exists yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/AuthGate.tsx
git commit -m "feat(auth): magic-link UI in AuthGate"
```

---

## Phase C — Routing & shell

### Task 10: App.tsx — add /me, /invite/:token, role-aware redirects

**Why:** New routes for participant home and invite redemption. Default landing redirects depend on role.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `src/App.tsx`**

```tsx
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
```

Key changes:
- `/invite/:token` is registered *before* `AuthGate` so the redemption page can render its own auth form (with the token preserved as the redirect target).
- `index` route delegates to `HomeRedirect`, which sends admins to Dashboard and others to `/me`.
- `EventsList`, `EventCreate` are wrapped in `AdminOnly`.
- `EventDetail` is NOT admin-gated — non-admins still need read access to the event detail page when they're a scorekeeper or (post-claim) a participant in it. Edit chrome inside the page is gated by role separately (Task 17).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: FAIL — `Me` and `Invite` don't exist yet. That's fine; we create them in Task 14 and Task 16.

To unblock the lint, create stubs:

```bash
cat > src/pages/Me.tsx <<'EOF'
export default function Me() { return <div>Me — placeholder</div>; }
EOF
cat > src/pages/Invite.tsx <<'EOF'
export default function Invite() { return <div>Invite — placeholder</div>; }
EOF
```

Re-run `npm run lint` — should pass now.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/pages/Me.tsx src/pages/Invite.tsx
git commit -m "feat(routing): add /me, /invite/:token, role-aware redirects"
```

---

### Task 11: AppShell — avatar menu + role-aware nav

**Why:** Adds the top-right avatar menu (sign-out, settings, "Invite someone" admin-only). Hides admin-only nav entries from non-admins.

**Files:**
- Modify: `src/components/AppShell.tsx`
- Create: `src/components/AvatarMenu.tsx`

- [ ] **Step 1: Create `src/components/AvatarMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Settings as SettingsIcon, UserPlus, User as UserIcon } from "lucide-react";
import { useSession, signOut } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { isAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { InviteSheet } from "@/components/InviteSheet";

export function AvatarMenu() {
  const session = useSession();
  const { membership } = useMembership();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session || session === "loading") return null;
  const email = session.user.email ?? "";
  const initial = email.charAt(0).toUpperCase() || "?";

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
          aria-label="Account menu"
        >
          {initial}
        </button>
        {open && (
          <div
            className={cn(
              "absolute right-0 top-10 z-50 w-56 rounded-md border bg-popover p-1 shadow-lg"
            )}
          >
            <div className="px-3 py-2 text-xs text-muted-foreground">
              <div className="truncate font-medium text-foreground">{email}</div>
              <div className="text-[10px] uppercase tracking-wide">{membership?.role ?? "—"}</div>
            </div>
            <div className="my-1 h-px bg-border" />
            <Link
              to="/me"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <UserIcon className="h-4 w-4" />
              My profile
            </Link>
            {isAdmin(membership) && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setInviteOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <UserPlus className="h-4 w-4" />
                Invite someone
              </button>
            )}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <SettingsIcon className="h-4 w-4" />
              Settings
            </Link>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await signOut();
                window.location.href = "/";
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
```

Note: this imports `InviteSheet` from Task 12. To unblock TypeScript before Task 12 lands, create a stub:

```bash
cat > src/components/InviteSheet.tsx <<'EOF'
interface Props { open: boolean; onOpenChange: (open: boolean) => void; }
export function InviteSheet(_props: Props) { return null; }
EOF
```

- [ ] **Step 2: Update `src/components/AppShell.tsx`**

Modify the existing file. Specifically:

1. Import `AvatarMenu` and `useMembership`.
2. Filter `PRIMARY_NAV` and `SECONDARY_NAV` based on role.
3. Add `<AvatarMenu />` to the top-right of the header.

Inside the existing `AppShell` component, near the top:

```tsx
import { useMembership } from "@/lib/membership";
import { isAdmin } from "@/lib/permissions";
import { AvatarMenu } from "@/components/AvatarMenu";
```

And inside the component body (before the existing return):

```tsx
const { membership } = useMembership();
const showAdminNav = isAdmin(membership);

const primaryNav = showAdminNav ? PRIMARY_NAV : [{ to: "/me", label: "Home", icon: Home, end: true } as const];
const secondaryNav = showAdminNav ? SECONDARY_NAV : [{ to: "/settings", label: "Settings", icon: Settings } as const];
```

Replace `PRIMARY_NAV` and `SECONDARY_NAV` with `primaryNav` and `secondaryNav` in the JSX.

In the header section (look for the `h-14 items-center border-b` block in the desktop sidebar; mobile header is similar), add the AvatarMenu in the top-right. If the existing AppShell has a top header bar, append `<AvatarMenu />` there. If not (the current structure has the brand label in the sidebar with no top bar), add a top bar:

```tsx
<header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background px-4 md:hidden">
  <span className="font-display text-base uppercase tracking-tight">Round Robin</span>
  <AvatarMenu />
</header>
```

Plus, in the desktop sidebar's existing `h-14 items-center` brand block, add the avatar to the right side:

```tsx
<div className="flex h-14 items-center justify-between border-b px-5">
  <span className="font-display text-lg uppercase tracking-tight">Round Robin</span>
  <AvatarMenu />
</div>
```

If the existing structure doesn't accommodate this cleanly, refactor the brand row to use `justify-between` and place the avatar as the second child.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Manually verify in dev server**

```bash
npm run dev
```

Sign in. Click the avatar in the top-right. Verify:
- Email and role show in the menu header.
- "Invite someone" appears (you're admin).
- "Sign out" works.
- After sign-out, you land back on the magic-link form.

- [ ] **Step 5: Commit**

```bash
git add src/components/AvatarMenu.tsx src/components/AppShell.tsx
git commit -m "feat(shell): avatar menu + role-aware nav"
```

---

## Phase D — Invite system

### Task 12: InviteSheet — admin-only invite generator

**Why:** Admin's UI for generating invites with token + email + copy link.

**Files:**
- Modify: `src/components/InviteSheet.tsx` (replace stub)

- [ ] **Step 1: Replace `src/components/InviteSheet.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Copy, Check, Trash2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { Invite, Role } from "@/types/database";
import { formatDate } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRY_DAYS = 7;

function randomToken(): string {
  // 32 random bytes -> base64url-like; sufficient entropy for invite tokens.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function InviteSheet({ open, onOpenChange }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("participant");
  const [submitting, setSubmitting] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadInvites = async () => {
    const { data, error } = await supabase
      .from("rr_invites")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setInvites(data as Invite[]);
  };

  useEffect(() => {
    if (open) loadInvites();
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const token = randomToken();
      const expires_at = new Date(
        Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error } = await supabase.from("rr_invites").insert({
        email,
        role,
        token,
        expires_at,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success("Invite created");
      setEmail("");
      setRole("participant");
      await loadInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invite");
    } finally {
      setSubmitting(false);
    }
  };

  const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

  const onCopy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1500);
  };

  const onSendEmail = async (invite: Invite) => {
    try {
      const { error } = await supabase.functions.invoke("send-invite", {
        body: { invite_id: invite.id },
      });
      if (error) throw error;
      toast.success(`Email sent to ${invite.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send email");
    }
  };

  const onRevoke = async (invite: Invite) => {
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    const { error } = await supabase.from("rr_invites").delete().eq("id", invite.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Invite revoked");
    await loadInvites();
  };

  const pending = invites.filter((i) => !i.accepted_at);
  const accepted = invites.filter((i) => i.accepted_at);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Invite someone</SheetTitle>
        </SheetHeader>
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <Input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="participant">Participant</option>
            <option value="scorekeeper">Scorekeeper</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" disabled={submitting || !email} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate invite"}
          </Button>
        </form>

        {pending.length > 0 && (
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold">Pending</h3>
            {pending.map((i) => (
              <div key={i.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      <Badge variant="outline">{i.role}</Badge>
                      {" · expires "}
                      {formatDate(i.expires_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevoke(i)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Revoke invite"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onCopy(i.token)}
                    className="flex-1"
                  >
                    {copiedToken === i.token ? (
                      <>
                        <Check className="mr-1 h-3 w-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 h-3 w-3" />
                        Copy link
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSendEmail(i)}
                  >
                    <Mail className="mr-1 h-3 w-3" />
                    Email it
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {accepted.length > 0 && (
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold">Accepted</h3>
            {accepted.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-md border p-3 text-sm text-muted-foreground">
                <span>{i.email}</span>
                <Badge variant="outline">{i.role}</Badge>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manually verify in dev server**

Open the avatar menu → "Invite someone." Generate an invite. Verify:
- A row appears in the "Pending" list.
- "Copy link" copies the URL to clipboard.
- A row appears in `rr_invites` in Supabase Studio.
- "Email it" will fail until Task 13 lands the Edge Function — that's expected; toast should show the error.

- [ ] **Step 4: Commit**

```bash
git add src/components/InviteSheet.tsx
git commit -m "feat(invites): admin invite sheet with copy-link"
```

---

### Task 13: send-invite Edge Function

**Why:** Sends the invite email server-side. Supabase Edge Functions run with service-role credentials, so they can read invites without going through the lookup_invite RPC.

**Files:**
- Create: `supabase/functions/send-invite/index.ts`

- [ ] **Step 1: Verify Supabase CLI is installed**

```bash
supabase --version
```

If not installed, `npm install -g supabase` or download from https://github.com/supabase/cli/releases.

- [ ] **Step 2: Initialize functions structure if needed**

```bash
supabase init --workdir .
```

This creates `supabase/` if it doesn't exist. If it already does, this is a no-op.

- [ ] **Step 3: Create the function**

```bash
supabase functions new send-invite
```

This creates `supabase/functions/send-invite/index.ts` with a stub.

- [ ] **Step 4: Replace `supabase/functions/send-invite/index.ts`**

```ts
// Sends an invite email. Triggered by the InviteSheet "Email it" button.
//
// Body: { invite_id: string }
// Auth: requires the caller to be an admin member.
//
// Email is sent via Supabase's built-in Resend integration (default project sender).
// For custom SMTP, configure under Project Settings → Auth → SMTP Settings.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://round-robin.example.com";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // Verify the caller is signed in and an admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: membership } = await adminClient
    .from("rr_memberships")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "admin") {
    return new Response("forbidden", { status: 403 });
  }

  const { invite_id } = await req.json();
  if (!invite_id) return new Response("invite_id required", { status: 400 });

  const { data: invite, error: inviteErr } = await adminClient
    .from("rr_invites")
    .select("*")
    .eq("id", invite_id)
    .maybeSingle();
  if (inviteErr || !invite) return new Response("invite not found", { status: 404 });

  const inviteUrl = `${APP_URL}/invite/${invite.token}`;
  const subject = "You're invited to Round Robin";
  const html = `
    <p>Hi,</p>
    <p>You've been invited to join Round Robin as a <strong>${invite.role}</strong>.</p>
    <p><a href="${inviteUrl}">Accept your invite</a></p>
    <p>This link expires on ${new Date(invite.expires_at).toDateString()}.</p>
    <p>If you weren't expecting this, you can ignore this email.</p>
  `;

  // Use the Resend integration that Supabase ships with.
  // Documentation: https://supabase.com/docs/guides/functions/examples/send-emails
  // For the simplest path on a personal app, we call out to Resend's API directly.
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured. Set it in Supabase project secrets." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("INVITE_FROM_EMAIL") ?? "no-reply@example.com",
      to: invite.email,
      subject,
      html,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    return new Response(JSON.stringify({ error: `email send failed: ${text}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 5: Configure Resend in Supabase project**

Manual steps in Supabase Studio:
1. Sign up for a Resend account at resend.com (free tier is enough for personal use).
2. Verify a sender domain (or use Resend's `onboarding@resend.dev` for testing).
3. Create an API key.
4. In Supabase Studio → Project Settings → Edge Functions → Secrets, add:
   - `RESEND_API_KEY = <your key>`
   - `INVITE_FROM_EMAIL = no-reply@yourdomain.com` (or `onboarding@resend.dev` for testing)
   - `APP_URL = https://your-vercel-url.com` (or http://localhost:5173 in dev)

- [ ] **Step 6: Deploy the function**

```bash
supabase functions deploy send-invite
```

- [ ] **Step 7: Test from the browser**

Open the InviteSheet, generate a fresh invite, click "Email it." Expected: success toast. Check the recipient's inbox.

If it fails:
- 500 with "RESEND_API_KEY not configured" → secrets not set on the project.
- 502 with "email send failed" → Resend rejected (check API key, sender domain).
- 401/403 → caller isn't recognized as admin.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/send-invite/
git commit -m "feat(invites): send-invite Edge Function (Resend integration)"
```

---

### Task 14: Invite redemption page

**Why:** The page at `/invite/:token` that handles all four states (signed-out / signed-in non-member / signed-in member / expired-or-used).

**Files:**
- Modify: `src/pages/Invite.tsx` (replace stub)

- [ ] **Step 1: Replace `src/pages/Invite.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { signInWithMagicLink, useSession } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { supabase } from "@/lib/supabase";
import type { InviteLookup } from "@/types/database";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; invite: InviteLookup }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_used" };

export default function Invite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const { status: memStatus, membership } = useMembership();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Look up invite on mount.
  useEffect(() => {
    if (!token) {
      setLoad({ kind: "not_found" });
      return;
    }
    supabase
      .rpc("lookup_invite", { _token: token })
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setLoad({ kind: "not_found" });
          return;
        }
        const invite = data[0] as InviteLookup;
        if (invite.accepted_at) setLoad({ kind: "already_used" });
        else if (new Date(invite.expires_at) < new Date()) setLoad({ kind: "expired" });
        else {
          setLoad({ kind: "loaded", invite });
          setEmail(invite.email);
        }
      });
  }, [token]);

  // If signed in + has membership: redirect to home (admins to /, others to /me).
  useEffect(() => {
    if (session === "loading" || memStatus === "loading") return;
    if (session && membership && load.kind === "loaded") {
      // Already a member of the tenant — accept the invite anyway to mark it used,
      // then redirect to home.
      (async () => {
        await supabase.rpc("accept_invite", { _token: token });
        toast.info("You're already a member.");
        navigate(membership.role === "admin" ? "/" : "/me", { replace: true });
      })();
    }
  }, [session, memStatus, membership, load.kind, token, navigate]);

  const onSubmitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signInWithMagicLink(email, `${window.location.origin}/invite/${token}`);
      setLinkSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send link");
    } finally {
      setSubmitting(false);
    }
  };

  const onAccept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const { error } = await supabase.rpc("accept_invite", { _token: token });
      if (error) throw error;
      toast.success("Welcome to Round Robin");
      // Re-fetch membership after accept; navigate home.
      navigate(load.kind === "loaded" && load.invite.role === "admin" ? "/" : "/me", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setAccepting(false);
    }
  };

  // Render states.
  if (load.kind === "loading" || session === "loading" || memStatus === "loading") {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Centered>
    );
  }

  if (load.kind === "not_found") {
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Invite not found
            </CardTitle>
            <CardDescription>
              This invite link doesn't match anything we have on record. Ask the admin who sent it for a fresh link.
            </CardDescription>
          </CardHeader>
        </Card>
      </Centered>
    );
  }

  if (load.kind === "expired" || load.kind === "already_used") {
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              {load.kind === "expired" ? "Invite expired" : "Invite already used"}
            </CardTitle>
            <CardDescription>
              {load.kind === "expired"
                ? "This invite link has expired."
                : "This invite has already been accepted."}
              {" "}Ask the admin to send you a fresh one.
            </CardDescription>
          </CardHeader>
        </Card>
      </Centered>
    );
  }

  // Loaded + valid.
  const invite = load.invite;

  if (!session) {
    // Sign-in form, prefilled with the invited email.
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>You're invited</CardTitle>
            <CardDescription>
              Join Round Robin as <Badge variant="outline">{invite.role}</Badge>. Enter your email and we'll send you a one-time sign-in link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linkSent ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground">
                <Mail className="h-8 w-8 text-primary" />
                <p>
                  Check <strong>{email}</strong> for a sign-in link. Open it on this device to continue accepting the invite.
                </p>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={onSubmitEmail}>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" className="w-full" disabled={submitting || !email}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send me a link"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </Centered>
    );
  }

  // Signed in, no membership yet → show Accept button.
  return (
    <Centered>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Almost there
          </CardTitle>
          <CardDescription>
            Accept this invite to join Round Robin as <Badge variant="outline">{invite.role}</Badge>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onAccept} disabled={accepting} className="w-full">
            {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept invite"}
          </Button>
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manually verify in dev server**

Test all four states:

a. **Bogus token:** visit `/invite/abc123`. Expect "Invite not found."
b. **Valid token, signed out:** generate an invite via the InviteSheet, copy the link, sign out, paste the link. Expect "You're invited" form with email prefilled.
c. **Valid token, signed in non-member:** generate invite for a different email; sign out; sign in via magic link with that other email; you'll land on `/me` with no membership. Now manually navigate to `/invite/<token>`. Expect "Almost there" Accept button. Click — verify a row gets added to `rr_memberships`.
d. **Valid token, already member:** repeat (c) but for an existing member. Expect a brief "you're already a member" toast and redirect to home.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Invite.tsx
git commit -m "feat(invites): redemption page at /invite/:token"
```

---

## Phase E — Scorekeeper assignment

### Task 15: AssignScorekeepersSheet + EventDetail integration

**Why:** Per-event scorekeeper assignment (Approach 2). Admin opens the sheet from the event detail page to add/remove scorekeepers.

**Files:**
- Create: `src/components/AssignScorekeepersSheet.tsx`
- Modify: `src/pages/EventDetail.tsx`

- [ ] **Step 1: Create `src/components/AssignScorekeepersSheet.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { EventCollaborator, Membership } from "@/types/database";

interface Props {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange?: () => void;
}

interface MemberWithEmail extends Membership {
  email: string | null;
}

export function AssignScorekeepersSheet({ eventId, open, onOpenChange, onChange }: Props) {
  const [scorekeepers, setScorekeepers] = useState<MemberWithEmail[]>([]);
  const [collaborators, setCollaborators] = useState<EventCollaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // user_id being toggled

  const load = async () => {
    setLoading(true);
    // Fetch scorekeepers (memberships joined with auth.users for email).
    // auth.users isn't directly queryable; use admin RPC if needed.
    // For now: select memberships, then fetch emails via the auth admin endpoint via an Edge Function (deferred — Phase 2.1 polish).
    // Pragmatic shortcut: rely on a `rr_memberships` view that joins auth.users — see Task 15 step 2.
    const { data: m, error: mErr } = await supabase
      .from("rr_memberships_with_email")
      .select("*")
      .eq("role", "scorekeeper");
    const { data: c, error: cErr } = await supabase
      .from("rr_event_collaborators")
      .select("*")
      .eq("event_id", eventId);
    if (mErr || cErr) {
      toast.error(mErr?.message ?? cErr?.message ?? "Could not load");
      setLoading(false);
      return;
    }
    setScorekeepers((m as MemberWithEmail[]) ?? []);
    setCollaborators((c as EventCollaborator[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
  }, [open, eventId]);

  const isAssigned = (userId: string) =>
    collaborators.some((c) => c.user_id === userId);

  const toggle = async (userId: string) => {
    setSaving(userId);
    try {
      if (isAssigned(userId)) {
        const { error } = await supabase
          .from("rr_event_collaborators")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", userId);
        if (error) throw error;
        setCollaborators((prev) => prev.filter((c) => c.user_id !== userId));
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("not signed in");
        const { data, error } = await supabase
          .from("rr_event_collaborators")
          .insert({ event_id: eventId, user_id: userId, granted_by: user.id })
          .select()
          .single();
        if (error) throw error;
        setCollaborators((prev) => [...prev, data as EventCollaborator]);
      }
      onChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Scorekeepers for this event</SheetTitle>
        </SheetHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : scorekeepers.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No members have the scorekeeper role yet. Invite someone with the scorekeeper role from the avatar menu.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {scorekeepers.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{m.email ?? "(unknown)"}</div>
                  <div className="text-xs text-muted-foreground">scorekeeper</div>
                </div>
                <input
                  type="checkbox"
                  checked={isAssigned(m.user_id)}
                  disabled={saving === m.user_id}
                  onChange={() => toggle(m.user_id)}
                />
              </label>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Add the `rr_memberships_with_email` view**

The frontend can't query `auth.users` directly. Add a view that joins memberships to user emails:

Add to `migrations/migration-004-auth-phase-2.sql` (or as a follow-up `migration-004a-views.sql` if 004 is already applied):

```sql
create or replace view rr_memberships_with_email as
select m.id, m.user_id, m.role, m.created_at, u.email
from rr_memberships m
left join auth.users u on u.id = m.user_id;

-- Grant via RLS on the underlying memberships table; views inherit RLS from base tables.
grant select on rr_memberships_with_email to authenticated;
```

If migration-004 is already applied, run only this snippet in the SQL editor. If not yet applied, append it to the file before applying.

- [ ] **Step 3: Wire into `src/pages/EventDetail.tsx`**

Open the file and find a sensible place near the top of the rendered event detail (e.g., near the existing "settings" or "configuration" section). Add a "Scorekeepers" section visible to admins only:

```tsx
import { useState } from "react";
import { useMembership } from "@/lib/membership";
import { canAssignScorekeepers } from "@/lib/permissions";
import { AssignScorekeepersSheet } from "@/components/AssignScorekeepersSheet";
import { Users } from "lucide-react";

// Inside the component body:
const { membership } = useMembership();
const [scorekeepersOpen, setScorekeepersOpen] = useState(false);
const [collabRefreshKey, setCollabRefreshKey] = useState(0);

// In the JSX, near event metadata:
{canAssignScorekeepers(membership) && (
  <section className="rounded-md border p-4">
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" /> Scorekeepers
        </h3>
        <p className="text-xs text-muted-foreground">
          Assigned scorekeepers can enter scores on this event.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => setScorekeepersOpen(true)}>
        Manage
      </Button>
    </div>
  </section>
)}

<AssignScorekeepersSheet
  eventId={eventId}
  open={scorekeepersOpen}
  onOpenChange={setScorekeepersOpen}
  onChange={() => setCollabRefreshKey((k) => k + 1)}
/>
```

(Adapt to whatever variable name the existing EventDetail uses for the event ID — usually `id` from `useParams`.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Manual verification**

In dev:
1. As admin, invite a friend with scorekeeper role.
2. Have them accept (or simulate by manually inserting a `rr_memberships` row in Studio with `role = 'scorekeeper'`).
3. Open an event you own as admin.
4. Verify "Scorekeepers" section is visible. Click Manage.
5. Verify the sheet shows your scorekeeper(s).
6. Toggle one on → verify a row appears in `rr_event_collaborators`.
7. Toggle off → verify it's deleted.

- [ ] **Step 6: Commit**

```bash
git add src/components/AssignScorekeepersSheet.tsx src/pages/EventDetail.tsx migrations/migration-004-auth-phase-2.sql
git commit -m "feat(scorekeepers): per-event assignment sheet"
```

---

## Phase F — Participant home + read-only gating

### Task 16: Participant home `/me`

**Why:** Where scorekeepers and participants land. Phase 2 ships with placeholders; sub-projects 2 and 3 wire data into the empty sections.

**Files:**
- Modify: `src/pages/Me.tsx` (replace stub)

- [ ] **Step 1: Replace `src/pages/Me.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Loader2, Mail, ShieldCheck, Trophy, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { supabase } from "@/lib/supabase";
import type { EventCollaborator } from "@/types/database";

export default function Me() {
  const session = useSession();
  const { status, membership } = useMembership();
  const [collabs, setCollabs] = useState<EventCollaborator[]>([]);
  const [loadingCollabs, setLoadingCollabs] = useState(true);

  useEffect(() => {
    if (!session || session === "loading") return;
    supabase
      .from("rr_event_collaborators")
      .select("*")
      .eq("user_id", session.user.id)
      .then(({ data }) => {
        setCollabs((data as EventCollaborator[]) ?? []);
        setLoadingCollabs(false);
      });
  }, [session]);

  if (session === "loading" || status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return null; // AuthGate should prevent this

  const email = session.user.email ?? "—";
  const role = membership?.role ?? "—";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {email}
          </CardTitle>
          <CardDescription>
            <Badge variant="outline">{role}</Badge>
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Network rating placeholder (filled in by sub-project 3). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Network rating
          </CardTitle>
          <CardDescription>Your rating against the friends you actually play with.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Coming soon — once you've been linked to your player profile and played some matches against other members, your network rating will show up here.
          </p>
        </CardContent>
      </Card>

      {/* Events you've played in (filled in by sub-project 2). */}
      <Card>
        <CardHeader>
          <CardTitle>Events you've played in</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            We haven't linked you to a player yet. Ask an admin to link your account to your player profile so your match history can show here.
          </p>
        </CardContent>
      </Card>

      {/* Series you've played in (filled in by sub-project 2). */}
      <Card>
        <CardHeader>
          <CardTitle>Series you've played in</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Same as above — show up here once you're linked to a player.
          </p>
        </CardContent>
      </Card>

      {/* Scorekeeper assignments (visible only if you have any). */}
      {role === "scorekeeper" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Events you can score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCollabs ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : collabs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assignments yet. The admin will let you know when there's an event for you to score.
              </p>
            ) : (
              <ul className="space-y-2">
                {collabs.map((c) => (
                  <li key={c.id} className="rounded border p-2 text-sm">
                    <a href={`/events/${c.event_id}`} className="font-medium hover:underline">
                      Event {c.event_id.slice(0, 8)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="text-center text-xs text-muted-foreground">
        <Mail className="mr-1 inline h-3 w-3" />
        Need help? Ask the admin who invited you.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manual verification**

Sign in as a scorekeeper or participant (use a different email than your admin one). Verify:
- `/me` renders with the right email and role.
- Network rating section shows the "coming soon" copy.
- Empty events/series sections show.
- For scorekeepers with assignments: the assignments section lists them.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Me.tsx
git commit -m "feat(participants): /me participant home page"
```

---

### Task 17: Gate edit chrome on EventDetail

**Why:** Hide admin-only buttons (Edit, Finalize, Add match, Cancel match, roster DnD) from non-admins. Score editing for scorekeepers is gated separately.

**Files:**
- Modify: `src/pages/EventDetail.tsx`

- [ ] **Step 1: Identify edit chrome locations**

Open `src/pages/EventDetail.tsx`. Look for:
- Edit/settings buttons or links
- "Add match" buttons
- "Cancel match" actions
- "Finalize event" button
- Roster drag-and-drop / "Edit roster" / swap-player sheet trigger
- Score input components on individual matches

- [ ] **Step 2: Add gating helpers**

At the top of the component:

```tsx
import { useMembership } from "@/lib/membership";
import { canEditEvent, canFinalizeEvent, canEditRoster, canScoreEvent, isAdmin } from "@/lib/permissions";
import { useEffect, useState } from "react";
import type { EventCollaborator } from "@/types/database";
import { useSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// In the component body, after `id` is read from useParams:
const { membership } = useMembership();
const session = useSession();
const [eventCollabs, setEventCollabs] = useState<EventCollaborator[]>([]);

useEffect(() => {
  if (!id) return;
  supabase
    .from("rr_event_collaborators")
    .select("*")
    .eq("event_id", id)
    .then(({ data }) => setEventCollabs((data as EventCollaborator[]) ?? []));
}, [id]);

const userId = session && session !== "loading" ? session.user.id : "";
const showEditChrome = isAdmin(membership);
const showRosterEdit = canEditRoster(membership);
const showFinalize = canFinalizeEvent(membership);
const canScore = id ? canScoreEvent(membership, userId, id, eventCollabs) : false;
```

- [ ] **Step 3: Wrap edit-only UI in conditionals**

For each piece of edit chrome you identified in Step 1, wrap in `{showEditChrome && ( ... )}` (or `showRosterEdit` / `showFinalize` for the more specific gates).

For score-input components on individual matches: pass `canScore` as a `disabled` (or `readOnly`) prop. If the score-input component doesn't accept that yet, accept the prop and gate the form-submit handler:

```tsx
// in the score input component:
<Button onClick={canScore ? onSave : undefined} disabled={!canScore}>Save</Button>
```

The exact set of edits depends on the existing structure of EventDetail — which has many sections. Apply the gates everywhere a write or edit is initiated. The lint will not catch missing gates (it'll still compile); manual verification in Step 5 is what catches them.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Manual verification**

Test all three roles on the same event:

| Role | Edit settings | Add match | Finalize | Edit roster | Score input |
|---|---|---|---|---|---|
| Admin | ✓ visible | ✓ visible | ✓ visible | ✓ visible | ✓ enabled |
| Scorekeeper assigned | ✗ hidden | ✗ hidden | ✗ hidden | ✗ hidden | ✓ enabled |
| Scorekeeper not assigned | ✗ hidden | ✗ hidden | ✗ hidden | ✗ hidden | ✗ disabled |
| Participant | ✗ hidden | ✗ hidden | ✗ hidden | ✗ hidden | ✗ disabled |

Verify each cell. If any "edit chrome" leaks through for non-admins, find and gate it.

- [ ] **Step 6: Commit**

```bash
git add src/pages/EventDetail.tsx
git commit -m "feat(perms): gate event-detail edit chrome on role"
```

---

### Task 18: Gate edit chrome on SeriesDetail

**Why:** Same pattern as Task 17, applied to series detail page.

**Files:**
- Modify: `src/pages/SeriesDetail.tsx`

- [ ] **Step 1: Identify edit chrome on SeriesDetail**

Open `src/pages/SeriesDetail.tsx`. Look for:
- "Edit series" / settings buttons
- "Assign events" sheet / "Add event" actions
- "Archive series" / "Delete" actions
- Anything that mutates series state

- [ ] **Step 2: Add gating**

At the top of the component:

```tsx
import { useMembership } from "@/lib/membership";
import { isAdmin } from "@/lib/permissions";

// In the component body:
const { membership } = useMembership();
const showEditChrome = isAdmin(membership);
```

Wrap each edit element in `{showEditChrome && ( ... )}`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Manual verification**

Sign in as participant; navigate to `/series/:id` for a series. Verify:
- Standings render normally.
- Ratings tab renders normally.
- No "Edit," "Assign events," or other admin actions are visible.

Then sign in as admin and verify all edit chrome reappears.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SeriesDetail.tsx
git commit -m "feat(perms): gate series-detail edit chrome on role"
```

---

## Phase G — Cutover

### Task 19: Production cutover runbook

**Why:** This is the deployment procedure. Two deploys, with a sign-in between them. The plan expects you to follow this in production.

**Files:** None (runbook only).

- [ ] **Step 1: Pre-deploy checklist**

- [ ] All tasks 1–18 are committed on a single branch.
- [ ] `npm run lint` passes.
- [ ] `npm run test:run` passes.
- [ ] `npm run build` succeeds.
- [ ] Resend account configured + Edge Function secrets set in Supabase.
- [ ] You have access to Supabase Studio's SQL editor.
- [ ] You can deploy to Vercel (or your hosting target).

- [ ] **Step 2: Apply migration-004 against production Supabase**

In Supabase Studio → SQL Editor, paste and run `migrations/migration-004-auth-phase-2.sql`.

Verify in the verification select at the bottom: 3 rows (all count = 0).

Spot-check helpers:
```sql
select rr_is_admin(); -- false
select rr_is_member(); -- false
```

- [ ] **Step 3: Configure Supabase Auth**

In Supabase Studio → Authentication → Providers:
- Enable "Email" provider.
- Under "Email" → "Magic Link," ensure it's enabled.
- Optionally, disable "Email + Password" (since we're going magic-link-only).

- [ ] **Step 4: Deploy frontend (deploy 1)**

Push your branch. Vercel auto-deploys. Wait for build to succeed.

- [ ] **Step 5: Sign in once as the owner**

Open the deployed URL. Submit your email. Click the magic link in your inbox.

Verify in Supabase Studio:
```sql
select * from rr_memberships;
```

Expected: one row with your `user_id` and `role = 'admin'`.

If this row says `role = 'participant'`, something went wrong — most likely an admin row already existed (e.g., from manual testing). Update it manually:

```sql
update rr_memberships set role = 'admin' where user_id = '<your auth user id>';
```

- [ ] **Step 6: Apply migration-005 against production Supabase**

In Supabase Studio → SQL Editor, paste and run `migrations/migration-005-rls-tighten.sql`.

This drops permissive policies and applies tight ones. After this runs, anonymous users get nothing from any rr_* table.

- [ ] **Step 7: Verify post-tightening**

In a fresh incognito window, visit the deployed URL. Without signing in, the magic-link form should appear. With the dev tools network tab open, verify that no rr_* table queries succeed without authentication.

Sign in as the owner. Verify the dashboard renders with all your existing events/series/players visible.

- [ ] **Step 8: Test invite flow end-to-end**

- Generate an invite for a second email you control (use a friend's address or a personal alt).
- Click "Email it." Confirm the email arrives.
- Open the link in a fresh browser. Sign in with the magic link from that email.
- Click "Accept invite." Verify a `rr_memberships` row appears with the correct role.
- Verify routing — admin → `/`, others → `/me`.

- [ ] **Step 9: Test scorekeeper assignment**

- Have your second account be a scorekeeper.
- As admin, open an event detail page. Open the Scorekeepers sheet. Add the scorekeeper.
- As the scorekeeper, sign in and navigate to that event. Verify scores can be entered.
- Try a different event the scorekeeper isn't assigned to. Verify scores are read-only.

- [ ] **Step 10: Rollback procedure (only if needed)**

If anything misbehaves badly post-deploy 2, you can roll back the RLS without losing data:

```sql
-- Drop all the tight policies. The bootstrap RPCs and tables stay; only RLS reverts.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename like 'rr_%'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Optional: re-enable permissive access while you debug.
-- (Replace with whatever your migration-001 originally did.)
```

- [ ] **Step 11: Communicate to existing users (you)**

Update PROJECT_NOTES.md and CLAUDE.md to reflect the new auth state. Move the auth section from "backlog" / "known limitations" to "shipped." Note the cutover date and the open knobs (sub-projects 2 and 3 still pending).

```bash
git add PROJECT_NOTES.md CLAUDE.md
git commit -m "docs: note Phase 2 auth shipped"
```

- [ ] **Step 12: Open follow-up issues**

Spawn issues / TODOs for:
- Sub-project 2 (slim claim flow) — unblocks `rr_is_in_event` and the participant view's data.
- Sub-project 3 (network rating) — fills the placeholder on `/me`.
- Score-column trigger — currently scorekeepers can update non-score fields on `rr_matches` because Postgres RLS is row-level not column-level. Add a `before update` trigger to reject scorekeeper updates that change non-score columns.
- Admin email field on members — the Scorekeepers sheet relies on the `rr_memberships_with_email` view; check if you want to surface emails in other admin views too.

---

## Self-review checklist

After implementation, verify these spec requirements have a corresponding task:

- [x] 3 roles (admin/scorekeeper/participant) — Task 3 (table check), Task 8 (helpers), Task 11 (UI gating)
- [x] Single-tenant, no `tenant_id` columns — Task 3
- [x] Magic-link auth, drops password — Task 6, Task 9
- [x] `rr_memberships` — Task 3
- [x] `rr_invites` with 7-day expiry default — Task 3, Task 12
- [x] `rr_event_collaborators` (per-event scorekeepers) — Task 3, Task 15
- [x] Helper functions (`rr_is_admin`, `rr_is_member`, `rr_can_score`, `rr_is_in_event` stub) — Task 3
- [x] `lookup_invite` RPC for anon redemption — Task 3
- [x] `accept_invite` RPC — Task 4
- [x] `bootstrap_membership` RPC (first-user-becomes-admin) — Task 4, Task 9 (called from AuthGate)
- [x] RLS rewrite for all rr_* tables — Task 4
- [x] Magic-link UI — Task 9
- [x] `useMembership()` hook — Task 7
- [x] Permissions helpers — Task 8
- [x] Avatar menu (sign-out, settings, "Invite someone") — Task 11
- [x] Role-aware nav — Task 11
- [x] App.tsx role-aware redirects — Task 10
- [x] Invite sheet (admin) — Task 12
- [x] Email-send Edge Function — Task 13
- [x] Invite redemption page — Task 14
- [x] Scorekeeper assignment sheet — Task 15
- [x] Participant home `/me` — Task 16
- [x] Read-only event/series for non-admins — Task 17, Task 18
- [x] Two-deploy cutover — Task 19
- [x] D3 polish (migrations folder) — Task 2
- [x] `shouldCreateUser: true` explicit — Task 6

Open knobs from the spec, defaulted in this plan:
- Invite expiry: 7 days (`DEFAULT_EXPIRY_DAYS = 7` in Task 12).
- Track invite creator: yes (`created_by` column in Task 3).
- Two-deploy cutover: yes (Task 19).
- Email-send: Edge Function (Task 13), Resend integration.
- Default Supabase sender for invite emails: Task 13 step 5.

Known holes that are deliberate, not bugs:
- `rr_is_in_event` is stubbed to return false. Sub-project 2 replaces it.
- `/me` shows empty events/series sections. Sub-project 2 fills them.
- "Network rating" card on `/me` is placeholder copy. Sub-project 3 fills it.
- Scorekeeper RLS doesn't column-gate `rr_matches.update` (any column can be edited by an assigned scorekeeper). Mitigation: trigger added in a Phase 2.1 follow-up; flagged in Task 19 step 12.
