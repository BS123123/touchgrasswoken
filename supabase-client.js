// supabase-client.js
// ---------------------------------------------------------------
// All Supabase wiring lives here. game.js and index.html never
// talk to Supabase directly - they import from this file.
// ---------------------------------------------------------------

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Your project URL (from the Supabase dashboard) - fixed, not an env var.
const SUPABASE_URL = 'https://hbszpgfwytfpehjdpnpq.supabase.co';

// The anon/public key is safe to ship to the browser, but Vite still
// requires it to come through import.meta.env with a VITE_ prefix -
// process.env does not exist in browser code. See the .env note below.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhic3pwZ2Z3eXRmcGVoamRwbnBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNTM2MDAsImV4cCI6MjA4NDYyOTYwMH0.IbYz2Ah-TR0ssQ_Yv5ycjrC8gcnJDzwJ8-XEXU6gL88';

const isConfigured = !!SUPABASE_ANON_KEY;

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Fallback worlds used only if the anon key is missing, so the
// template still runs standalone instead of crashing.
const FALLBACK_SERVERS = [
  { id: 'meadow', name: 'Sunken Meadow', description: 'gentle starter world' },
  { id: 'ember-caves', name: 'Ember Caves', description: 'hard mode, lava everywhere' },
  { id: 'the-drift', name: 'The Drift', description: 'pvp enabled' },
];

/**
 * Reads rows from a "servers" table:
 *   id text primary key, name text, description text
 * Falls back to a static list if the anon key isn't set yet.
 */
export async function fetchServers() {
  if (!supabase) return { servers: FALLBACK_SERVERS, live: false };

  const { data, error } = await supabase
    .from('servers')
    .select('id, name, description')
    .order('name', { ascending: true });

  if (error || !data || data.length === 0) {
    return { servers: FALLBACK_SERVERS, live: false };
  }
  return { servers: data, live: true };
}

/**
 * Opens (or reuses) a realtime channel scoped to one server/world.
 * Position updates travel as ephemeral "broadcast" events, not
 * database writes - that keeps movement smooth and avoids
 * hammering Postgres with 15+ writes/sec per player. Presence is
 * used only to know who is currently online.
 */
export function joinWorldChannel(serverId, playerId, username, handlers) {
  if (!supabase) return null; // offline / solo mode

  const channel = supabase.channel(`world:${serverId}`, {
    config: { presence: { key: playerId }, broadcast: { self: false } },
  });

  channel
    .on('broadcast', { event: 'pos' }, ({ payload }) => {
      handlers.onPeerMove?.(payload);
    })
    .on('presence', { event: 'sync' }, () => {
      handlers.onPresenceSync?.(channel.presenceState());
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      handlers.onPeerLeave?.(key);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ username, joinedAt: Date.now() });
        handlers.onSubscribed?.();
      }
    });

  return channel;
}

export function broadcastPosition(channel, playerId, x, y, facing) {
  if (!channel) return;
  channel.send({
    type: 'broadcast',
    event: 'pos',
    payload: { id: playerId, x, y, facing },
  });
}

export function leaveWorldChannel(channel) {
  if (channel) supabase.removeChannel(channel);
}