-- Realmforge v2 persistence / slot-lock upgrade
-- Run after the original Supabase upgrade script.

alter table public.player_slots
  add column if not exists browser_id text,
  add column if not exists slot_opened_at timestamptz,
  add column if not exists death_count integer not null default 0;

create unique index if not exists player_slots_browser_slot_idx
  on public.player_slots(browser_id) where browser_id is not null;

-- A browser/account can claim only one character slot. The same browser can
-- re-open its existing slot, but cannot switch to another slot until that
-- character is wiped.
create or replace function public.claim_player_slot(p_slot_id smallint, p_browser_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.player_slots;
  other_slot smallint;
begin
  if uid is null then return jsonb_build_object('ok',false,'error','Not authenticated.'); end if;
  if p_slot_id < 1 or p_slot_id > 10 then return jsonb_build_object('ok',false,'error','Invalid slot.'); end if;
  if p_browser_id is null or length(trim(p_browser_id)) < 8 then return jsonb_build_object('ok',false,'error','Invalid browser session.'); end if;

  select * into existing from public.player_slots where user_id=uid and slot_id=p_slot_id;
  if found then
    if existing.browser_id is null or existing.browser_id=p_browser_id then
      update public.player_slots set browser_id=p_browser_id, slot_opened_at=coalesce(slot_opened_at,now())
      where user_id=uid and slot_id=p_slot_id;
      return jsonb_build_object('ok',true,'slot_id',p_slot_id,'existing',true);
    end if;
    return jsonb_build_object('ok',false,'error','This character slot is already bound to another browser.');
  end if;

  select slot_id into other_slot from public.player_slots where user_id=uid limit 1;
  if other_slot is not null then
    return jsonb_build_object('ok',false,'error','This account already has a character slot. It must be wiped before another slot can be opened.');
  end if;

  insert into public.player_slots(user_id,slot_id,browser_id,slot_opened_at,death_count,slot_data)
  values(uid,p_slot_id,p_browser_id,now(),0,jsonb_build_object(
    'slotId',p_slot_id,'username','Wanderer','level',1,'exp',0,'expNext',100,
    'hp',100,'skills',jsonb_build_array('firebolt'),'weapon','Training Blade','deathCount',0
  ));
  return jsonb_build_object('ok',true,'slot_id',p_slot_id,'existing',false);
exception when unique_violation then
  return jsonb_build_object('ok',false,'error','This character slot is already open.');
end;
$$;

create or replace function public.wipe_player_slot(p_slot_id smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok',false,'error','Not authenticated.'); end if;
  delete from public.player_slots where user_id=uid and slot_id=p_slot_id;
  return jsonb_build_object('ok',true,'wiped',true,'slot_id',p_slot_id);
end;
$$;

grant execute on function public.claim_player_slot(smallint,text) to authenticated;
grant execute on function public.wipe_player_slot(smallint) to authenticated;

-- Keep RLS enabled. The RPCs above are security-definer and explicitly use auth.uid().
-- Character data remains tied to user_id, never to server_id.
