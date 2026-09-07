-- Realmforge / Supabase upgrade
-- Run this entire script in Supabase SQL Editor.
-- IMPORTANT: enable Anonymous Sign-Ins in Authentication > Providers > Anonymous.

create extension if not exists pgcrypto;

create table if not exists public.servers (
  id text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into public.servers(id,name,description) values
('meadow','Sunken Meadow','starter world'),
('ember-caves','Ember Caves','hard world'),
('the-drift','The Drift','pvp world')
on conflict (id) do nothing;

create table if not exists public.skills (
  id text primary key,
  name text not null,
  element text not null,
  damage integer not null default 0,
  heal integer not null default 0,
  cooldown numeric not null default 1,
  unlock_level integer not null,
  description text
);

insert into public.skills(id,name,element,damage,heal,cooldown,unlock_level,description) values
('firebolt','Fire Bolt','fire',28,0,3,1,'A quick ranged fire attack.'),
('iceburst','Ice Burst','ice',22,0,4,2,'An icy strike.'),
('windslash','Wind Slash','wind',32,0,5,3,'A fast cutting wind wave.'),
('heal','Renew','life',0,25,8,4,'Restore 25 health.'),
('thunder','Thunder','lightning',45,0,10,5,'A heavy lightning strike.'),
('flamewave','Flame Wave','fire',38,0,9,6,'A stronger fire wave.'),
('frostguard','Frost Guard','ice',0,0,12,7,'Become invulnerable briefly.'),
('earthslam','Earth Slam','earth',35,0,8,8,'A close earth shockwave.'),
('dash','Wind Step','wind',0,0,5,9,'Dash forward and gain brief invulnerability.'),
('execute','Execution','void',60,0,14,10,'A powerful finishing strike.')
on conflict (id) do update set
name=excluded.name,element=excluded.element,damage=excluded.damage,heal=excluded.heal,
cooldown=excluded.cooldown,unlock_level=excluded.unlock_level,description=excluded.description;

create table if not exists public.weapons (
  id text primary key,
  name text not null,
  m1_damage integer not null,
  description text
);

insert into public.weapons(id,name,m1_damage,description) values
('training_blade','Training Blade',20,'Starter weapon.')
on conflict (id) do update set m1_damage=excluded.m1_damage;

create table if not exists public.mobs (
  id text primary key,
  name text not null,
  max_health integer not null,
  damage integer not null,
  exp_reward integer not null,
  night_only boolean not null default true
);

insert into public.mobs(id,name,max_health,damage,exp_reward,night_only) values
('nightcrawler','Nightcrawler',80,10,35,true)
on conflict (id) do update set max_health=excluded.max_health,damage=excluded.damage,exp_reward=excluded.exp_reward;

-- Persistent character slots belong to the authenticated user, NOT to a server.
-- A slot can therefore enter any server and keep its level, EXP, skills and weapon.
create table if not exists public.player_slots (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_id smallint not null check (slot_id between 1 and 10),
  slot_data jsonb not null default jsonb_build_object(
    'username','Wanderer',
    'level',1,
    'exp',0,
    'expNext',100,
    'hp',100,
    'skills',jsonb_build_array('firebolt'),
    'weapon','Training Blade'
  ),
  updated_at timestamptz not null default now(),
  primary key(user_id,slot_id)
);

alter table public.servers enable row level security;
alter table public.skills enable row level security;
alter table public.weapons enable row level security;
alter table public.mobs enable row level security;
alter table public.player_slots enable row level security;

drop policy if exists "servers readable" on public.servers;
create policy "servers readable" on public.servers for select to anon, authenticated using (true);

drop policy if exists "skills readable" on public.skills;
create policy "skills readable" on public.skills for select to anon, authenticated using (true);

drop policy if exists "weapons readable" on public.weapons;
create policy "weapons readable" on public.weapons for select to anon, authenticated using (true);

drop policy if exists "mobs readable" on public.mobs;
create policy "mobs readable" on public.mobs for select to anon, authenticated using (true);

drop policy if exists "own slots read" on public.player_slots;
create policy "own slots read" on public.player_slots for select to authenticated using (auth.uid()=user_id);

drop policy if exists "own slots insert" on public.player_slots;
create policy "own slots insert" on public.player_slots for insert to authenticated with check (auth.uid()=user_id);

drop policy if exists "own slots update" on public.player_slots;
create policy "own slots update" on public.player_slots for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- Helpful indexes
create index if not exists player_slots_updated_idx on public.player_slots(updated_at);

-- Security note:
-- Realtime movement/combat in this prototype is client-authoritative.
-- For a competitive PvP game, move damage/XP/death validation into a
-- Supabase Edge Function or dedicated game server before launch.
