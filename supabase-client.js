// Supabase persistence + one-slot-per-browser locking.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://hbszpgfwytfpehjdpnpq.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhic3pwZ2Z3eXRmcGVoamRwbnBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNTM2MDAsImV4cCI6MjA4NDYyOTYwMH0.IbYz2Ah-TR0ssQ_Yv5ycjrC8gcnJDzwJ8-XEXU6gL88';
export const supabase=SUPABASE_ANON_KEY?createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;
const FALLBACK_SERVERS=[{id:'meadow',name:'Sunken Meadow',description:'starter world'},{id:'ember-caves',name:'Ember Caves',description:'hard world'},{id:'the-drift',name:'The Drift',description:'pvp world'}];
let currentUser=null;

export async function fetchServers(){
 if(!supabase)return{servers:FALLBACK_SERVERS,live:false};
 const {data,error}=await supabase.from('servers').select('id,name,description').order('name');
 if(error||!data?.length)return{servers:FALLBACK_SERVERS,live:false}; return{servers:data,live:true};
}
export async function ensureAuth(){
 if(!supabase)return null;
 if(currentUser)return currentUser;
 const {data:{session}}=await supabase.auth.getSession();
 if(session?.user){currentUser=session.user;return currentUser;}
 const {data,error}=await supabase.auth.signInAnonymously(); currentUser=error?null:data?.user||null; return currentUser;
}
export async function claimSlot(slotId=1){
 if(!supabase)return {ok:true,slotId};
 const user=await ensureAuth(); if(!user)return{ok:false,error:'Authentication failed.'};
 const browserId=localStorage.getItem('realmforge_browser_id')||crypto.randomUUID(); localStorage.setItem('realmforge_browser_id',browserId);
 const {data,error}=await supabase.rpc('claim_player_slot',{p_slot_id:slotId,p_browser_id:browserId});
 if(error)return{ok:false,error:error.message}; return data||{ok:false,error:'Could not claim slot.'};
}
export async function loadSlot(slotId=1){
 if(!supabase)return JSON.parse(localStorage.getItem(`realmforge_slot_${slotId}`)||'null');
 const user=await ensureAuth(); if(!user)return null;
 const {data}=await supabase.from('player_slots').select('slot_data').eq('user_id',user.id).eq('slot_id',slotId).maybeSingle();
 return data?.slot_data||null;
}
export async function saveSlot(slotData,slotId=1){
 if(!supabase){localStorage.setItem(`realmforge_slot_${slotId}`,JSON.stringify(slotData));return;}
 const user=await ensureAuth();if(!user)return;
 await supabase.from('player_slots').upsert({user_id:user.id,slot_id:slotId,slot_data:slotData,updated_at:new Date().toISOString()},{onConflict:'user_id,slot_id'});
}
export async function wipeSlot(slotId=1){
 if(!supabase){localStorage.removeItem(`realmforge_slot_${slotId}`);return{ok:true};}
 const user=await ensureAuth();if(!user)return{ok:false};
 const {data,error}=await supabase.rpc('wipe_player_slot',{p_slot_id:slotId}); return error?{ok:false,error:error.message}:data;
}
export function joinWorldChannel(serverId,playerId,username,handlers){
 if(!supabase)return null;
 const channel=supabase.channel(`world:${serverId}`,{config:{presence:{key:playerId},broadcast:{self:false}}});
 channel.on('broadcast',{event:'pos'},({payload})=>handlers.onPeerMove?.(payload)).on('broadcast',{event:'combat'},({payload})=>handlers.onPeerCombat?.(payload)).on('presence',{event:'sync'},()=>handlers.onPresenceSync?.(channel.presenceState())).on('presence',{event:'leave'},({key})=>handlers.onPeerLeave?.(key)).subscribe(async status=>{if(status==='SUBSCRIBED'){await channel.track({username,joinedAt:Date.now()});handlers.onSubscribed?.();}}); return channel;
}
export function broadcastPosition(channel,id,x,y,facing,hp=100,maxHp=100){if(channel)channel.send({type:'broadcast',event:'pos',payload:{id,x,y,facing,hp,maxHp}});}
export function broadcastCombat(channel,payload){if(channel)channel.send({type:'broadcast',event:'combat',payload});}
export function leaveWorldChannel(channel){if(channel&&supabase)supabase.removeChannel(channel);}
