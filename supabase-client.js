// supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://hbszpgfwytfpehjdpnpq.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhic3pwZ2Z3eXRmcGVoamRwbnBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNTM2MDAsImV4cCI6MjA4NDYyOTYwMH0.IbYz2Ah-TR0ssQ_Yv5ycjrC8gcnJDzwJ8-XEXU6gL88';
export const supabase=SUPABASE_ANON_KEY?createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;
const FALLBACK_SERVERS=[
{id:'meadow',name:'Sunken Meadow',description:'starter world'},
{id:'ember-caves',name:'Ember Caves',description:'hard world'},
{id:'the-drift',name:'The Drift',description:'pvp world'}];

export async function fetchServers(){
 if(!supabase)return{servers:FALLBACK_SERVERS,live:false};
 const {data,error}=await supabase.from('servers').select('id,name,description').order('name');
 if(error||!data?.length)return{servers:FALLBACK_SERVERS,live:false};
 return{servers:data,live:true};
}

export async function ensureAuth(){
 if(!supabase)return null;
 const {data:{session}}=await supabase.auth.getSession();
 if(session?.user)return session.user;
 const {data,error}=await supabase.auth.signInAnonymously();
 return error?null:data.user;
}

export async function loadSlot(slotId=1){
 if(!supabase)return JSON.parse(localStorage.getItem(`realmforge_slot_${slotId}`)||'null');
 const user=await ensureAuth(); if(!user)return null;
 const {data}=await supabase.from('player_slots').select('slot_data').eq('user_id',user.id).eq('slot_id',slotId).maybeSingle();
 return data?.slot_data||null;
}
export async function saveSlot(slotData,slotId=1){
 const payload={slot_id:slotId,slot_data:slotData,updated_at:new Date().toISOString()};
 if(!supabase){localStorage.setItem(`realmforge_slot_${slotId}`,JSON.stringify(slotData));return;}
 const user=await ensureAuth();if(!user)return;
 await supabase.from('player_slots').upsert({...payload,user_id:user.id},{onConflict:'user_id,slot_id'});
}

export function joinWorldChannel(serverId,playerId,username,handlers){
 if(!supabase)return null;
 const channel=supabase.channel(`world:${serverId}`,{config:{presence:{key:playerId},broadcast:{self:false}}});
 channel.on('broadcast',{event:'pos'},({payload})=>handlers.onPeerMove?.(payload))
   .on('broadcast',{event:'combat'},({payload})=>handlers.onPeerCombat?.(payload))
   .on('presence',{event:'sync'},()=>handlers.onPresenceSync?.(channel.presenceState()))
   .on('presence',{event:'leave'},({key})=>handlers.onPeerLeave?.(key))
   .subscribe(async status=>{if(status==='SUBSCRIBED'){await channel.track({username,joinedAt:Date.now()});handlers.onSubscribed?.();}});
 return channel;
}
export function broadcastPosition(channel,id,x,y,facing,hp=100,maxHp=100){
 if(!channel)return;channel.send({type:'broadcast',event:'pos',payload:{id,x,y,facing,hp,maxHp}});
}
export function broadcastCombat(channel,payload){if(!channel)return;channel.send({type:'broadcast',event:'combat',payload});}
export function leaveWorldChannel(channel){if(channel&&supabase)supabase.removeChannel(channel);}
