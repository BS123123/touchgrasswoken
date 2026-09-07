# Realmforge upgraded

## Systems in this build
- One persistent character slot per authenticated browser/account.
- The slot stays bound until the character dies twice.
- Second death permanently wipes the slot's level, EXP, weapon, skills and character data.
- After wipe, the website can create a fresh character again.
- 100 HP for players.
- M1 PvP damage and player kill EXP.
- Day/night cycle with limited Nightcrawler spawning.
- Ten skill slots using 1-9 and 0.
- Different skill ranges/hitboxes and gameplay effects: burn, slow, knockback, stun, shield, heal and dash.
- Simplified single-tone main menu: name, server dropdown, Join.

## Supabase
Run the original `supabase_upgrade.sql` first, then run `supabase_upgrade_v2.sql`.
Enable Anonymous Sign-Ins under Authentication > Providers > Anonymous.

The browser stores a random browser binding ID in localStorage. The database also stores it so the same authenticated browser can reopen its existing slot, while the account cannot create a second slot until the first one is wiped.

## Important production note
Combat and XP are still client-authoritative because this project uses Supabase Realtime broadcasts directly from the browser. For a public competitive game, move damage, death, EXP, mob state and slot-wipe decisions to a trusted server/Edge Function or dedicated game server.
