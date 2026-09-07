// game.js - Realmforge multiplayer RPG upgrade
import {
  fetchServers, joinWorldChannel, broadcastPosition, broadcastCombat,
  leaveWorldChannel, loadSlot, saveSlot, claimSlot, wipeSlot
} from "./supabase-client.js";

const menuScreen=document.getElementById("menu-screen"), gameScreen=document.getElementById("game-screen");
const usernameInput=document.getElementById("username"), serverSelect=document.getElementById("server-select");
const serverStatus=document.getElementById("server-status"), serverListEl=document.getElementById("server-list");
const playBtn=document.getElementById("play-btn"), menuError=document.getElementById("menu-error");
const leaveBtn=document.getElementById("leave-btn"), hudWorld=document.getElementById("hud-world"), hudPlayers=document.getElementById("hud-players");
const canvas=document.getElementById("game-canvas"), ctx=canvas.getContext("2d");

let servers=[], map, channel=null, playerId, running=false, rafId=null, lastTime=0, broadcastTimer=0;
const peers=new Map(), mobs=new Map();
const keys={left:false,right:false,jump:false,guard:false};
const TILE=32, MAP_ROWS=20, MAP_COLS=120, GRAVITY=1400;
const WORLD={dayLength:240, nightStart:120, nightEnd:240, mobCap:5, mobSpawnEvery:18};
const COMBAT={m1Damage:20,attackDuration:.20,attackCooldown:.38,range:42,height:28,parryWindow:.14,parryCooldown:.45,guardBreak:.65};
const MOB={id:"nightcrawler",maxHp:80,damage:10,exp:35};
const SLOT_ID=1;
const SKILL_XP=100;
const SKILLS=[
{id:"firebolt",name:"Fire Bolt",element:"fire",damage:28,cooldown:3,range:150,width:150,height:34,effect:"burn",effectTime:2,description:"Ranged fire hit; burns for 4 seconds."},
{id:"iceburst",name:"Ice Burst",element:"ice",damage:22,cooldown:4,range:95,width:95,height:55,effect:"slow",effectTime:2,description:"Wide icy hit that slows."},
{id:"windslash",name:"Wind Slash",element:"wind",damage:32,cooldown:5,range:135,width:135,height:30,effect:"knockback",effectTime:.2,description:"Fast slash that pushes enemies away."},
{id:"heal",name:"Renew",element:"life",damage:0,heal:25,cooldown:8,effect:"heal",description:"Restore 25 HP."},
{id:"thunder",name:"Thunder",element:"lightning",damage:45,cooldown:10,range:80,width:80,height:70,effect:"stun",effectTime:.7,description:"Heavy close lightning strike."},
{id:"flamewave",name:"Flame Wave",element:"fire",damage:38,cooldown:9,range:190,width:190,height:65,effect:"burn",effectTime:3,description:"Large fire wave."},
{id:"frostguard",name:"Frost Guard",element:"ice",damage:0,cooldown:12,effect:"shield",effectTime:1.5,description:"Briefly blocks all damage."},
{id:"earthslam",name:"Earth Slam",element:"earth",damage:35,cooldown:8,range:100,width:100,height:80,effect:"stun",effectTime:.5,description:"Ground shockwave with stun."},
{id:"dash",name:"Wind Step",element:"wind",damage:0,cooldown:5,effect:"dash",effectTime:.25,description:"Dash and become briefly invulnerable."},
{id:"execute",name:"Execution",element:"void",damage:60,cooldown:14,range:70,width:70,height:45,effect:"knockback",effectTime:.25,description:"Very strong close strike."}
];

const player={x:0,y:0,w:20,h:30,vx:0,vy:0,onGround:false,facing:1,speed:180,jumpForce:480,username:"Wanderer",
 hp:100,maxHp:100,level:1,exp:0,expNext:100,skills:[],skillCooldowns:{},weapon:"Training Blade",deathCount:0,slotWiped:false,effects:{},
 attackUntil:0,attackCooldownUntil:0,attackHit:false,guardUntil:0,parryUntil:0,parryCooldownUntil:0,guardBrokenUntil:0,invulnUntil:0};
const camera={x:0,y:0};

function generateMap(){const m=Array.from({length:MAP_ROWS},()=>new Array(MAP_COLS).fill(0));const groundY=13;
 for(let x=0;x<MAP_COLS;x++){const top=Math.max(2,Math.min(MAP_ROWS-1,groundY+Math.round(Math.sin(x*.15)*2)));for(let y=top;y<MAP_ROWS;y++)m[y][x]=1;
  if(x%11===0&&x>5){const py=top-4;for(let px=x;px<x+3&&px<MAP_COLS;px++)if(py>=0)m[py][px]=1;}}return m;}
function isSolid(c,r){return r<0||r>=MAP_ROWS||c<0||c>=MAP_COLS||map[r][c]===1;}
function resolveH(e,dx){if(!dx)return;const t=Math.floor(e.y/TILE),b=Math.floor((e.y+e.h-.001)/TILE);
 if(dx>0){const c=Math.floor((e.x+e.w-.001)/TILE);for(let r=t;r<=b;r++)if(isSolid(c,r)){e.x=c*TILE-e.w;e.vx=0;return;}}
 else{const c=Math.floor(e.x/TILE);for(let r=t;r<=b;r++)if(isSolid(c,r)){e.x=(c+1)*TILE;e.vx=0;return;}}}
function resolveV(e,dy){e.onGround=false;if(!dy)return;const l=Math.floor((e.x+.001)/TILE),r=Math.floor((e.x+e.w-.001)/TILE);
 if(dy>0){const row=Math.floor((e.y+e.h-.001)/TILE);for(let c=l;c<=r;c++)if(isSolid(c,row)){e.y=row*TILE-e.h;e.vy=0;e.onGround=true;return;}}
 else{const row=Math.floor(e.y/TILE);for(let c=l;c<=r;c++)if(isSolid(c,row)){e.y=(row+1)*TILE;e.vy=0;return;}}}
function move(e,dx,dy){e.x+=dx;resolveH(e,dx);e.y+=dy;resolveV(e,dy);e.x=Math.max(0,Math.min(e.x,MAP_COLS*TILE-e.w));e.y=Math.max(0,Math.min(e.y,MAP_ROWS*TILE-e.h));}
function findSpawn(col=4){for(let radius=0;radius<MAP_COLS/2;radius++){for(const c of (radius?[col-radius,col+radius]:[col]))if(c>=0&&c<MAP_COLS)for(let r=1;r<MAP_ROWS;r++)if(isSolid(c,r)&&!isSolid(c,r-1)&&!isSolid(c,r-2))return{x:c*TILE+6,y:r*TILE-player.h-.01};}return{x:128,y:300};}

function resizeCanvas(){canvas.width=innerWidth;canvas.height=innerHeight;} addEventListener("resize",resizeCanvas);
function now(){return performance.now()/1000;}
function overlaps(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function attackBox(a){return a.facing===1?{x:a.x+a.w-2,y:a.y+5,w:COMBAT.range,h:COMBAT.height}:{x:a.x-COMBAT.range+2,y:a.y+5,w:COMBAT.range,h:COMBAT.height};}
function isParrying(p){return p.parryUntil>now();} function isBlocking(p){return p.guardUntil>now()&&!isParrying(p);}
function isNight(){const t=(Date.now()/1000)%WORLD.dayLength;return t>=WORLD.nightStart;}
function cycleText(){const t=(Date.now()/1000)%WORLD.dayLength;return t<WORLD.nightStart?"DAY":"NIGHT";}

function gainExp(amount,reason){player.exp+=amount;while(player.exp>=player.expNext){player.exp-=player.expNext;player.level++;player.expNext=Math.floor(player.expNext*1.25);const newSkill=SKILLS[player.level-1];if(newSkill&&!player.skills.includes(newSkill.id))player.skills.push(newSkill.id);broadcastCombat(channel,{id:playerId,type:"levelup",level:player.level});}saveProgress();}
function saveProgress(){return saveSlot({slotId:SLOT_ID,username:player.username,level:player.level,exp:player.exp,expNext:player.expNext,hp:player.hp,skills:player.skills,weapon:player.weapon,deathCount:player.deathCount},SLOT_ID);}
async function loadProgress(){const d=await loadSlot(SLOT_ID);if(d){player.username=d.username||player.username;player.level=d.level||1;player.exp=d.exp||0;player.expNext=d.expNext||100;player.skills=Array.isArray(d.skills)?d.skills:SKILLS.slice(0,player.level).map(s=>s.id);player.weapon=d.weapon||"Training Blade";player.deathCount=d.deathCount||0;}return d;}
function applyEffect(target,type,duration){if(!target.effects)target.effects={};target.effects[type]=Math.max(target.effects[type]||0,now()+duration);}
function hasEffect(target,type){return (target.effects?.[type]||0)>now();}

async function damagePlayer(amount,sourceId,type="hit"){const t=now();if(t<player.invulnUntil||t<player.guardBrokenUntil)return;if(player.hp<=0)return;player.hp=Math.max(0,player.hp-amount);player.invulnUntil=t+.25;if(player.hp===0){player.deathCount++;broadcastCombat(channel,{id:playerId,type:"death",sourceId,deathCount:player.deathCount});if(player.deathCount>=2){player.slotWiped=true;await wipeSlot(SLOT_ID);player.hp=0;running=false;menuError.textContent="Your second death wiped this character slot.";gameScreen.classList.add("hidden");menuScreen.classList.remove("hidden");usernameInput.disabled=false;usernameInput.value="";playBtn.disabled=true;return;}player.hp=100;const sp=findSpawn();player.x=sp.x;player.y=sp.y;}saveProgress();}
function damagePeer(peer,amount,source,type="hit",skill=null){broadcastCombat(channel,{id:playerId,type:"damage",targetId:peer.id,amount,source,kind:type,skill,at:now()});}

function startAttack(){const t=now();if(t<player.attackCooldownUntil||t<player.guardBrokenUntil)return;player.guardUntil=player.parryUntil=0;player.attackUntil=t+COMBAT.attackDuration;player.attackCooldownUntil=t+COMBAT.attackCooldown;player.attackHit=false;
 broadcastCombat(channel,{id:playerId,type:"attack",facing:player.facing,at:t});}
function startGuard(){const t=now();if(t<player.parryCooldownUntil||t<player.guardBrokenUntil)return;player.parryUntil=t+COMBAT.parryWindow;player.guardUntil=t+9999;player.parryCooldownUntil=t+COMBAT.parryCooldown;
 broadcastCombat(channel,{id:playerId,type:"parry_start",facing:player.facing,at:t});}
function endGuard(){player.guardUntil=player.parryUntil=0;broadcastCombat(channel,{id:playerId,type:"guard_end",at:now()});}

function processAttack(){if(player.attackHit||!isAttacking(player))return;const t=now();if(player.attackUntil-t>COMBAT.attackDuration*.65)return;player.attackHit=true;const hb=attackBox(player);
 for(const peer of peers.values()){if(!overlaps(hb,peer))continue;if(peer.parryUntil>t){broadcastCombat(channel,{id:playerId,type:"parried",targetId:peer.id,at:t});}
  else if(peer.guardUntil>t){broadcastCombat(channel,{id:playerId,type:"guard_hit",targetId:peer.id,amount:COMBAT.m1Damage,at:t});}
  else damagePeer(peer,COMBAT.m1Damage,playerId,"m1");}
 for(const m of mobs.values())if(!m.dead&&overlaps(hb,m)){m.hp-=COMBAT.m1Damage;broadcastCombat(channel,{id:playerId,type:"mob_damage",mobId:m.id,amount:COMBAT.m1Damage,at:t});if(m.hp<=0)killMob(m);}}
function isAttacking(p){return p.attackUntil>now();}
function skillHitbox(s){const x=player.facing===1?player.x+player.w:player.x-s.width;return{x,y:player.y+(player.h-s.height)/2,w:s.width,h:s.height};}
function applySkillHit(target,s){if(hasEffect(target,"shield"))return false;const t=now();if(target.parryUntil>t)return false;if(target.guardUntil>t){broadcastCombat(channel,{id:playerId,type:"guard_hit",targetId:target.id,amount:s.damage,skill:s.id,at:t});return false;}return true;}
function castSkill(slot){const idx=slot-1;if(idx<0||idx>=10)return;const id=player.skills[idx];const s=SKILLS.find(x=>x.id===id);if(!s)return;const t=now();if((player.skillCooldowns[id]||0)>t)return;player.skillCooldowns[id]=t+s.cooldown;if(id==="heal"){player.hp=Math.min(100,player.hp+(s.heal||0));broadcastCombat(channel,{id:playerId,type:"skill",skill:id});saveProgress();return;}if(id==="dash"){move(player,player.facing*90,0);player.invulnUntil=t+(s.effectTime||.25);broadcastCombat(channel,{id:playerId,type:"skill",skill:id,x:player.x,y:player.y});return;}if(id==="frostguard"){applyEffect(player,"shield",s.effectTime);player.invulnUntil=t+s.effectTime;broadcastCombat(channel,{id:playerId,type:"skill",skill:id});return;}const hb=skillHitbox(s);for(const p of peers.values()){if(!overlaps(hb,p))continue;if(!applySkillHit(p,s))continue;damagePeer(p,s.damage,playerId,s.element,s.id);broadcastCombat(channel,{id:playerId,type:"effect",targetId:p.id,effect:s.effect,effectTime:s.effectTime,skill:s.id});}for(const m of mobs.values())if(!m.dead&&overlaps(hb,m)){if(hasEffect(m,"shield"))continue;m.hp-=s.damage||0;if(s.effect)applyEffect(m,s.effect,s.effectTime||0);if(s.effect==="stun")m.stunUntil=t+s.effectTime;m.lastHitBy=playerId;broadcastCombat(channel,{id:playerId,type:"mob_damage",mobId:m.id,amount:s.damage,skill:s.id,effect:s.effect,effectTime:s.effectTime,at:t});if(m.hp<=0)killMob(m);}broadcastCombat(channel,{id:playerId,type:"skill",skill:id});}
function killMob(m){if(m.dead)return;m.dead=true;gainExp(MOB.exp,"mob");broadcastCombat(channel,{id:playerId,type:"mob_kill",mobId:m.id,exp:MOB.exp});}
function spawnMobs(dt){if(!isNight())return;spawnMobs.timer=(spawnMobs.timer||0)+dt;if(spawnMobs.timer<WORLD.mobSpawnEvery||mobs.size>=WORLD.mobCap)return;spawnMobs.timer=0;
 const col=20+Math.floor(Math.random()*(MAP_COLS-40));let row=1;for(;row<MAP_ROWS&& !isSolid(col,row);row++);if(row>=MAP_ROWS)return;
 const id=`${serverId}-${Math.floor(Date.now()/1000)}-${Math.random().toString(36).slice(2,6)}`;
 mobs.set(id,{id,x:col*TILE,y:row*TILE-26,w:22,h:26,vx:0,vy:0,hp:MOB.maxHp,maxHp:MOB.maxHp,damage:MOB.damage,dead:false,attackAt:0,effects:{},stunUntil:0});
 broadcastCombat(channel,{id:playerId,type:"mob_spawn",mob:{id,x:col*TILE,y:row*TILE-26,hp:MOB.maxHp,maxHp:MOB.maxHp}});
}
let serverId="";
function updateMobs(dt){for(const m of mobs.values()){if(m.dead)continue;if(hasEffect(m,"burn")&&now()>=(m.nextBurn||0)){m.nextBurn=now()+.75;m.hp=Math.max(0,m.hp-4);m.lastHitBy=playerId;if(m.hp<=0){killMob(m);continue;}}if(now()<(m.stunUntil||0))continue;const dx=player.x-m.x;if(Math.abs(dx)<420){m.vx=Math.sign(dx)*(hasEffect(m,"slow")?28:55);m.facing=Math.sign(dx)||1;if(overlaps(m,player)&&now()>m.attackAt){m.attackAt=now()+1.1;
   if(isParrying(player))broadcastCombat(channel,{id:playerId,type:"mob_parried",targetId:playerId,mobId:m.id});else if(isBlocking(player)){player.guardBrokenUntil=now()+COMBAT.guardBreak;player.guardUntil=player.parryUntil=0;}else damagePlayer(m.damage,m.id,"mob");}}
 m.vy+=GRAVITY*dt;move(m,m.vx*dt,m.vy*dt);}}
function receiveCombat(p){if(!p||p.id===playerId)return;const peer=peers.get(p.id);
 if(p.type==="mob_spawn"&&p.mob){if(!mobs.has(p.mob.id))mobs.set(p.mob.id,{...p.mob,w:22,h:26,damage:10,dead:false,attackAt:0});return;}
 if(p.type==="mob_damage"){const m=mobs.get(p.mobId);if(m&&!m.dead){m.hp-=p.amount;if(p.effect)applyEffect(m,p.effect,p.effectTime||0);m.lastHitBy=p.id;if(m.hp<=0)m.dead=true;}return;}
 if(!peer)return;const t=now();
 if(p.type==="attack"){peer.attackUntil=t+COMBAT.attackDuration;peer.attackHit=false;peer.facing=p.facing??peer.facing;return;}
 if(p.type==="parry_start"){peer.parryUntil=t+COMBAT.parryWindow;peer.guardUntil=t+9999;return;}
 if(p.type==="guard_end"){peer.guardUntil=peer.parryUntil=0;return;}
 if(p.targetId!==playerId)return;
 if(p.type==="damage"){damagePlayer(p.amount,p.source,p.kind);return;}
 if(p.type==="effect"){if(p.targetId===playerId&&p.effect)applyEffect(player,p.effect,p.effectTime||0);return;}
 if(p.type==="death"){if(p.sourceId===playerId)gainExp(50,"player");return;}
 if(p.type==="parried"){peer.guardBrokenUntil=t+COMBAT.guardBreak;peer.attackUntil=0;return;}
 if(p.type==="guard_hit"){player.guardBrokenUntil=t+COMBAT.guardBreak;player.guardUntil=player.parryUntil=0;return;}
 if(p.type==="levelup")return;
}
function handleKey(e,down){const k=e.key.toLowerCase();if(["a","arrowleft"].includes(k))keys.left=down;if(["d","arrowright"].includes(k))keys.right=down;
 if(e.key===" "||k==="w"||k==="arrowup"){if(down&&!keys.jump)keys.jump=true;if(!down)keys.jump=false;}
 if(k==="f"){if(down&&!keys.guard)startGuard();keys.guard=down;} if(k>="1"&&k<="9"&&down)castSkill(+k);if(k==="0"&&down)castSkill(10);
 if([" ","arrowleft","arrowright","arrowup"].includes(k))e.preventDefault();}
addEventListener("keydown",e=>{if(running)handleKey(e,true)});addEventListener("keyup",e=>{if(running)handleKey(e,false)});
canvas.addEventListener("mousedown",e=>{if(e.button===0&&running)startAttack()});canvas.addEventListener("contextmenu",e=>e.preventDefault());
addEventListener("keyup",e=>{if(e.key.toLowerCase()==="f"&&running)endGuard()});

function update(dt){const t=now();if(player.attackUntil&&t>=player.attackUntil){player.attackUntil=0;player.attackHit=false}if(!keys.guard&&player.guardUntil)endGuard();
 const stunned=t<player.guardBrokenUntil;if(!stunned){if(keys.left&&!keys.right){player.vx=-player.speed;player.facing=-1}else if(keys.right&&!keys.left){player.vx=player.speed;player.facing=1}else player.vx=0;
  if(keys.jump&&player.onGround&&!isBlocking(player)){player.vy=-player.jumpForce;player.onGround=false;keys.jump=false;}}
 else player.vx=0;player.vy=Math.min(1200,player.vy+GRAVITY*dt);move(player,player.vx*dt,player.vy*dt);if(isAttacking(player))processAttack();spawnMobs(dt);updateMobs(dt);
 camera.x=Math.max(0,Math.min(player.x-innerWidth/2,Math.max(0,MAP_COLS*TILE-innerWidth)));camera.y=Math.max(0,Math.min(player.y-innerHeight/2,Math.max(0,MAP_ROWS*TILE-innerHeight)));
 broadcastTimer+=dt;if(broadcastTimer>1/15){broadcastTimer=0;broadcastPosition(channel,playerId,player.x,player.y,player.facing,player.hp,player.maxHp);}
 document.getElementById("hud-time").textContent=cycleText();document.getElementById("hud-hp").textContent=`HP ${player.hp}/100`;document.getElementById("hud-level").textContent=`LV ${player.level} · EXP ${player.exp}/${player.expNext} · DEATHS ${player.deathCount}/2`;}
function drawCharacter(sx,sy,color,facing,label,state){ctx.fillStyle=color;ctx.fillRect(sx,sy,20,30);ctx.fillStyle="#111";ctx.fillRect(facing===1?sx+14:sx+2,sy+6,4,4);
 const t=now();if(isBlocking(state)){ctx.strokeStyle="#eee";ctx.lineWidth=3;ctx.strokeRect(sx-3,sy-3,26,36)}if(isParrying(state)){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(sx-5,sy-5,30,40)}
 if(isAttacking(state)){const b=attackBox(state);ctx.fillStyle="rgba(255,190,80,.3)";ctx.fillRect(b.x-(state.x-sx),b.y-(state.y-sy),b.w,b.h)}
 ctx.font="10px monospace";ctx.fillStyle="#ead9b0";ctx.textAlign="center";ctx.fillText(label||"",sx+10,sy-6);
 ctx.fillStyle="#421d1d";ctx.fillRect(sx-4,sy-16,28,4);ctx.fillStyle="#62d06b";const hp=Math.max(0,Math.min(1,(state.hp??100)/(state.maxHp??100)));ctx.fillRect(sx-4,sy-16,28*hp,4);}
function drawMob(m){const sx=m.x-camera.x,sy=m.y-camera.y;ctx.fillStyle="#7b4b39";ctx.fillRect(sx,sy,m.w,m.h);ctx.fillStyle="#f0c36b";ctx.fillRect(sx+(m.facing===-1?3:15),sy+6,4,4);ctx.fillStyle="#421d1d";ctx.fillRect(sx-4,sy-8,30,4);ctx.fillStyle="#e36c58";ctx.fillRect(sx-4,sy-8,30*Math.max(0,m.hp/m.maxHp),4);}
function draw(){const night=isNight();ctx.fillStyle=night?"#080d1c":"#26314a";ctx.fillRect(0,0,canvas.width,canvas.height);
 const g=ctx.createLinearGradient(0,0,0,canvas.height);g.addColorStop(0,night?"#111936":"#4e80b0");g.addColorStop(1,night?"#05060c":"#b0c9d9");ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);
 const sc=Math.max(0,Math.floor(camera.x/TILE)-1),ec=Math.min(MAP_COLS,Math.ceil((camera.x+canvas.width)/TILE)+1),sr=Math.max(0,Math.floor(camera.y/TILE)-1),er=Math.min(MAP_ROWS,Math.ceil((camera.y+canvas.height)/TILE)+1);
 for(let r=sr;r<er;r++)for(let c=sc;c<ec;c++)if(map[r][c]){const sx=c*TILE-camera.x,sy=r*TILE-camera.y;ctx.fillStyle=!isSolid(c,r-1)?"#5c8253":"#4a3a2a";ctx.fillRect(sx,sy,TILE,TILE);}
 for(const m of mobs.values())if(!m.dead)drawMob(m);for(const p of peers.values())drawCharacter(p.x-camera.x,p.y-camera.y,"#3a5a70",p.facing,p.username,p);
 drawCharacter(player.x-camera.x,player.y-camera.y,"#d98b3f",player.facing,player.username,player);
 ctx.font="12px monospace";ctx.textAlign="left";ctx.fillStyle="#ead9b0";ctx.fillText(`${cycleText()} · mobs ${[...mobs.values()].filter(m=>!m.dead).length}/${WORLD.mobCap}`,12,canvas.height-34);
 ctx.fillText(`M1 ${COMBAT.m1Damage} dmg · F parry/block · 1-${Math.min(10,player.skills.length)} skills`,12,canvas.height-16);
}
function loop(time){if(!running)return;const dt=Math.min((time-lastTime)/1000,1/30);lastTime=time;update(dt);draw();rafId=requestAnimationFrame(loop)}

async function loadServers(){const r=await fetchServers();servers=r.servers;serverSelect.innerHTML=servers.map(s=>`<option value="${s.id}">${s.name}</option>`).join("");serverStatus.textContent=r.live?"connected":"offline/demo";playBtn.disabled=!servers.length;try{const d=await loadSlot(SLOT_ID);if(d?.username){usernameInput.value=d.username;usernameInput.disabled=true;playBtn.disabled=!servers.length;serverStatus.textContent+=" · character slot already active";}}catch(e){}}
loadServers();
playBtn.addEventListener("click",async()=>{const server=servers.find(s=>s.id===serverSelect.value);if(!server)return;menuError.textContent="";const claim=await claimSlot(SLOT_ID);if(!claim.ok){menuError.textContent=claim.error||"This slot is already in use.";return;}const name=usernameInput.value.trim();if(!name){menuError.textContent="Choose a name first.";return;}await startGame(server,name);});
leaveBtn.addEventListener("click",()=>{stopGame();gameScreen.classList.add("hidden");menuScreen.classList.remove("hidden")});
async function startGame(server,username){map=generateMap();serverId=server.id;const saved=await loadProgress();player.username=saved?.username||username;playerId=crypto.randomUUID();player.hp=100;const sp=findSpawn();Object.assign(player,{x:sp.x,y:sp.y,vx:0,vy:0,onGround:true,attackUntil:0,attackCooldownUntil:0,guardUntil:0,parryUntil:0,guardBrokenUntil:0,slotWiped:false});menuScreen.classList.add("hidden");gameScreen.classList.remove("hidden");hudWorld.textContent=server.name;resizeCanvas();channel=joinWorldChannel(server.id,playerId,player.username,{onPeerMove:p=>{if(p.id===playerId)return;const old=peers.get(p.id)||{w:20,h:30,hp:100,maxHp:100,effects:{}};peers.set(p.id,{...old,...p});updatePlayerCount()},onPeerCombat:receiveCombat,onPresenceSync:s=>{hudPlayers.textContent=`${Object.keys(s).length} online`},onPeerLeave:id=>{peers.delete(id);updatePlayerCount()}});running=true;lastTime=performance.now();rafId=requestAnimationFrame(loop);saveProgress();}
function stopGame(){running=false;if(rafId)cancelAnimationFrame(rafId);if(keys.guard)endGuard();leaveWorldChannel(channel);channel=null;peers.clear();mobs.clear();saveProgress().catch(()=>{});}
function updatePlayerCount(){hudPlayers.textContent=`${peers.size+1} online`;}
