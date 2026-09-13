create table if not exists public.scouting_forms (
  id text primary key,
  team_key text not null,
  game_key text not null,
  team_label text not null default '',
  game_label text not null default '',
  added_date text not null default '',
  motor_rpm text not null default '',
  robot_photo text not null default '',
  notes text not null default '',
  strokes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.scouting_forms enable row level security;

drop policy if exists "MatchCat public read scouting forms" on public.scouting_forms;
drop policy if exists "MatchCat public insert scouting forms" on public.scouting_forms;
drop policy if exists "MatchCat public update scouting forms" on public.scouting_forms;
drop policy if exists "MatchCat public delete scouting forms" on public.scouting_forms;

create policy "MatchCat public read scouting forms"
  on public.scouting_forms
  for select
  to anon
  using (true);

create policy "MatchCat public insert scouting forms"
  on public.scouting_forms
  for insert
  to anon
  with check (true);

create policy "MatchCat public update scouting forms"
  on public.scouting_forms
  for update
  to anon
  using (true)
  with check (true);

create policy "MatchCat public delete scouting forms"
  on public.scouting_forms
  for delete
  to anon
  using (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.scouting_forms to anon;
