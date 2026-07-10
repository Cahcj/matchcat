# MatchCat

MatchCat is a static FTC member dashboard for team 7305, Clague GearCats.

It uses the public FTCScout REST API to show:

- team information
- 7305-only game-year match list
- game year selector for 2023, 2024, 2025, 2026, and 2027
- 2026 maps to FTCScout season 2025, covering Royal Oak, Ann Arbor, Michigan State Championship-NW, and Troy MAYhem
- competition filters using FTCScout event names
- alliance station and teammates
- opponent team names, records, and 0-5 star ratings
- scores and record summaries
- local/offline ScoutingForms
- optional shared ScoutingForm cloud sync across phones

## Open Locally

Open `outputs/index.html` in a browser.

## Shared ScoutingForms Across Phones

MatchCat can sync ScoutingForms between phones with Supabase. Without these values, forms still save offline on one device only.

1. Create a Supabase project.
2. Run this SQL in the Supabase SQL editor:

```sql
create table public.scouting_forms (
  id text primary key,
  team_key text not null,
  game_key text not null,
  team_label text,
  game_label text,
  added_date text,
  motor_rpm text,
  robot_photo text,
  notes text,
  strokes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.scouting_forms enable row level security;

create policy "read scouting forms"
  on public.scouting_forms for select
  using (true);

create policy "add scouting forms"
  on public.scouting_forms for insert
  with check (true);

create policy "update scouting forms"
  on public.scouting_forms for update
  using (true)
  with check (true);

create policy "delete scouting forms"
  on public.scouting_forms for delete
  using (true);
```

3. Put the Supabase project URL and anon key in `cloud-config.js`.
4. Commit and push. New ScoutingForms will save locally first, then sync to the shared table so other phones can see them.

## Files

- `outputs/index.html`
- `outputs/styles.css`
- `outputs/app.js`
- `outputs/cloud-config.js`
- `outputs/matchcat-hero.png`
