// supabase-client.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const FALLBACK_SERVERS = [
  { id: 'meadow', name: 'Sunken Meadow', description: 'gentle starter world' },
  {
    id: 'ember-caves',
    name: 'Ember Caves',
    description: 'hard mode, lava everywhere',
  },
  { id: 'the-drift', name: 'The Drift', description: 'pvp enabled' },
];

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
 * Position updates are sent as ephemeral "broadcast" events, not
 * written to the database - that keeps movement smooth and avoids
 * hammering Postgres with 30+ writes/sec per player. Presence is
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
