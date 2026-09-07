// game.js
import {
  fetchServers,
  joinWorldChannel,
  broadcastPosition,
  broadcastCombat,
  leaveWorldChannel
} from "./supabase-client.js";

// ============================================================
// 1. MENU
// ============================================================
const menuScreen = document.getElementById("menu-screen");
const gameScreen = document.getElementById("game-screen");
const usernameInput = document.getElementById("username");
const serverSelect = document.getElementById("server-select");
const serverStatus = document.getElementById("server-status");
const serverListEl = document.getElementById("server-list");
const playBtn = document.getElementById("play-btn");
const menuError = document.getElementById("menu-error");
const leaveBtn = document.getElementById("leave-btn");
const hudWorld = document.getElementById("hud-world");
const hudPlayers = document.getElementById("hud-players");

let servers = [];

async function loadServers() {
  const { servers: list, live } = await fetchServers();
  servers = list;
  serverSelect.innerHTML = list.map(
    (s) => `<option value="${s.id}">${s.name}</option>`
  ).join("");
  serverListEl.innerHTML = list.map(
    (s) => `<li><span>${s.name}</span><span class="server-players">${s.description ?? ""}</span></li>`
  ).join("");
  serverStatus.textContent = live
    ? "connected to Supabase"
    : "offline demo worlds (add your Supabase keys)";
  playBtn.disabled = list.length === 0;
}
loadServers();

playBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim() || "Wanderer";
  const serverId = serverSelect.value;
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    menuError.textContent = "pick a world first";
    return;
  }
  startGame(server, username);
});

leaveBtn.addEventListener("click", () => {
  stopGame();
  gameScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");
});

// ============================================================
// 2. WORLD
// ============================================================
const TILE = 32;
const MAP_ROWS = 20;
const MAP_COLS = 120;

function generateMap() {
  const map = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(0));
  const groundY = 13;

  for (let x = 0; x < MAP_COLS; x++) {
    const bump = Math.round(Math.sin(x * 0.15) * 2);
    const top = Math.max(1, Math.min(MAP_ROWS - 1, groundY + bump));

    for (let y = top; y < MAP_ROWS; y++) map[y][x] = 1;

    if (x % 11 === 0 && x > 5) {
      const py = top - 4;
      for (let px = x; px < x + 3 && px < MAP_COLS; px++) {
        if (py >= 0) map[py][px] = 1;
      }
    }
  }
  return map;
}

// ============================================================
// 3. GAME STATE
// ============================================================
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

let map;
let channel = null;
let playerId;
let running = false;
let rafId = null;

const peers = new Map();
const keys = { left: false, right: false, jump: false, guard: false };

const player = {
  x: TILE * 4,
  y: TILE * 5,
  w: 20,
  h: 30,
  vx: 0,
  vy: 0,
  onGround: false,
  facing: 1,
  speed: 180,
  jumpForce: 480,
  username: "Wanderer",

  // Combat state
  attackUntil: 0,
  attackCooldownUntil: 0,
  guardUntil: 0,
  parryUntil: 0,
  parryCooldownUntil: 0,
  guardBrokenUntil: 0,
};

const COMBAT = {
  attackDuration: 0.20,     // total attack animation
  attackCooldown: 0.38,
  attackRange: 38,
  attackHeight: 28,

  // F starts a short parry window. If the window ends, holding F becomes a normal block.
  parryWindow: 0.14,
  parryCooldown: 0.45,
  blockGuardBreakTime: 0.90,
  guardBreakStun: 0.65,
};

const GRAVITY = 1400;
const camera = { x: 0, y: 0 };

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);

// ============================================================
// 4. INPUT
// ============================================================
function handleKey(e, isDown) {
  const key = e.key.toLowerCase();

  if (["a", "arrowleft"].includes(key)) keys.left = isDown;
  if (["d", "arrowright"].includes(key)) keys.right = isDown;

  if (e.key === " " || key === "w" || e.key === "arrowup") {
    // Prevent a held jump key from repeatedly jumping after landing.
    if (isDown && !keys.jump) keys.jump = true;
    if (!isDown) keys.jump = false;
  }

  if (key === "f") {
    if (isDown && !keys.guard) startGuard();
    keys.guard = isDown;
  }

  // Do not let the browser scroll on gameplay keys.
  if ([" ", "arrowleft", "arrowright", "arrowup"].includes(key)) {
    e.preventDefault();
  }
}

window.addEventListener("keydown", (e) => {
  if (!running) return;
  handleKey(e, true);
});

window.addEventListener("keyup", (e) => {
  if (!running) return;
  handleKey(e, false);
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0 && running) startAttack();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function startAttack() {
  const now = performance.now() / 1000;

  if (now < player.attackCooldownUntil || now < player.guardBrokenUntil) return;

  // Attacking cancels the current guard/parry.
  player.guardUntil = 0;
  player.parryUntil = 0;

  player.attackUntil = now + COMBAT.attackDuration;
  player.attackCooldownUntil = now + COMBAT.attackCooldown;

  broadcastCombat(channel, {
    id: playerId,
    type: "attack",
    facing: player.facing,
    at: now,
  });
}

function startGuard() {
  const now = performance.now() / 1000;

  if (now < player.parryCooldownUntil || now < player.guardBrokenUntil) return;

  player.parryUntil = now + COMBAT.parryWindow;
  player.guardUntil = now + 9999; // while F is held
  player.parryCooldownUntil = now + COMBAT.parryCooldown;

  broadcastCombat(channel, {
    id: playerId,
    type: "parry_start",
    facing: player.facing,
    at: now,
  });
}

function endGuard() {
  player.guardUntil = 0;
  player.parryUntil = 0;

  broadcastCombat(channel, {
    id: playerId,
    type: "guard_end",
    at: performance.now() / 1000,
  });
}

window.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "f" && running) endGuard();
});

// ============================================================
// 5. TILE COLLISION
// ============================================================
function isSolid(col, row) {
  // Outside the map is treated as solid. This prevents falling/walking
  // through the world edges.
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return true;
  return map[row][col] === 1;
}

function resolveHorizontal(entity, dx) {
  if (dx === 0) return;

  const top = Math.floor(entity.y / TILE);
  const bottom = Math.floor((entity.y + entity.h - 0.001) / TILE);

  if (dx > 0) {
    const right = Math.floor((entity.x + entity.w - 0.001) / TILE);
    for (let row = top; row <= bottom; row++) {
      if (isSolid(right, row)) {
        entity.x = right * TILE - entity.w;
        entity.vx = 0;
        return;
      }
    }
  } else {
    const left = Math.floor(entity.x / TILE);
    for (let row = top; row <= bottom; row++) {
      if (isSolid(left, row)) {
        entity.x = (left + 1) * TILE;
        entity.vx = 0;
        return;
      }
    }
  }
}

function resolveVertical(entity, dy) {
  entity.onGround = false;
  if (dy === 0) return;

  const left = Math.floor((entity.x + 0.001) / TILE);
  const right = Math.floor((entity.x + entity.w - 0.001) / TILE);

  if (dy > 0) {
    const bottom = Math.floor((entity.y + entity.h - 0.001) / TILE);
    for (let col = left; col <= right; col++) {
      if (isSolid(col, bottom)) {
        entity.y = bottom * TILE - entity.h;
        entity.vy = 0;
        entity.onGround = true;
        return;
      }
    }
  } else {
    const top = Math.floor(entity.y / TILE);
    for (let col = left; col <= right; col++) {
      if (isSolid(col, top)) {
        entity.y = (top + 1) * TILE;
        entity.vy = 0;
        return;
      }
    }
  }
}

function moveAndCollide(entity, dx, dy) {
  // Resolve one axis at a time. The old implementation could inspect
  // multiple tiles and overwrite a correct collision with another tile.
  entity.x += dx;
  resolveHorizontal(entity, dx);

  entity.y += dy;
  resolveVertical(entity, dy);

  // Hard clamp to the playable world.
  entity.x = Math.max(0, Math.min(entity.x, MAP_COLS * TILE - entity.w));
  entity.y = Math.max(0, Math.min(entity.y, MAP_ROWS * TILE - entity.h));
}

// Find a safe spawn directly above the terrain.
function findSpawn() {
  const preferredCol = 4;
  for (let radius = 0; radius < MAP_COLS / 2; radius++) {
    const candidates = radius === 0
      ? [preferredCol]
      : [preferredCol - radius, preferredCol + radius];

    for (const col of candidates) {
      if (col < 0 || col >= MAP_COLS) continue;

      for (let row = 1; row < MAP_ROWS; row++) {
        if (isSolid(col, row) && !isSolid(col, row - 1) && !isSolid(col, row - 2)) {
          return {
            x: col * TILE + (TILE - player.w) / 2,
            y: row * TILE - player.h - 0.01,
          };
        }
      }
    }
  }

  return { x: TILE * 4, y: TILE * 4 };
}

// ============================================================
// 6. COMBAT
// ============================================================
function isAttacking(p) {
  return p.attackUntil > performance.now() / 1000;
}

function isParrying(p) {
  return p.parryUntil > performance.now() / 1000;
}

function isBlocking(p) {
  return p.guardUntil > performance.now() / 1000 && !isParrying(p);
}

function getAttackBox(attacker) {
  const y = attacker.y + 5;
  return attacker.facing === 1
    ? { x: attacker.x + attacker.w - 2, y, w: COMBAT.attackRange, h: COMBAT.attackHeight }
    : { x: attacker.x - COMBAT.attackRange + 2, y, w: COMBAT.attackRange, h: COMBAT.attackHeight };
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// Local client predicts combat against visible peers. The peer also
// receives the same event, so both sides can show the result.
function processLocalAttack() {
  const now = performance.now() / 1000;
  if (player.attackUntil <= 0 || player.attackUntil - now > COMBAT.attackDuration * 0.65) return;

  // Make sure one attack can only hit once.
  if (player.attackHit) return;
  player.attackHit = true;

  const hitbox = getAttackBox(player);

  for (const peer of peers.values()) {
    const target = {
      x: peer.x,
      y: peer.y,
      w: player.w,
      h: player.h,
    };

    if (!overlaps(hitbox, target)) continue;

    if (peer.parryUntil > now) {
      broadcastCombat(channel, {
        id: playerId,
        type: "parried",
        targetId: peer.id,
        at: now,
      });
    } else if (peer.guardUntil > now) {
      broadcastCombat(channel, {
        id: playerId,
        type: "guard_hit",
        targetId: peer.id,
        at: now,
      });
    } else {
      broadcastCombat(channel, {
        id: playerId,
        type: "hit",
        targetId: peer.id,
        at: now,
      });
    }
  }
}

function receiveCombat(payload) {
  if (!payload || payload.id === playerId) return;

  const peer = peers.get(payload.id);
  if (!peer) return;

  const now = performance.now() / 1000;

  if (payload.type === "attack") {
    peer.attackUntil = now + COMBAT.attackDuration;
    peer.attackHit = false;
    peer.facing = payload.facing ?? peer.facing;
    return;
  }

  if (payload.type === "parry_start") {
    peer.parryUntil = now + COMBAT.parryWindow;
    peer.guardUntil = now + 9999;
    peer.parryCooldownUntil = now + COMBAT.parryCooldown;
    return;
  }

  if (payload.type === "guard_end") {
    peer.guardUntil = 0;
    peer.parryUntil = 0;
    return;
  }

  if (payload.targetId !== playerId) return;

  if (payload.type === "parried") {
    // A successful parry interrupts the attacker and gives them a short stun.
    peer.guardBrokenUntil = now + COMBAT.guardBreakStun;
    peer.attackUntil = 0;
    peer.attackCooldownUntil = now + COMBAT.guardBreakStun;
    return;
  }

  if (payload.type === "guard_hit") {
    // Blocking an attack is safe, but repeated/poorly timed blocking is
    // punished by guard break. This makes the defender choose parry timing.
    player.guardBrokenUntil = now + COMBAT.guardBreakStun;
    player.guardUntil = 0;
    player.parryUntil = 0;
    return;
  }

  if (payload.type === "hit") {
    // Simple hit reaction for now. HP/damage can be added to the same event.
    player.guardBrokenUntil = now + 0.20;
  }
}

// ============================================================
// 7. UPDATE / DRAW
// ============================================================
let lastTime = 0;
let broadcastTimer = 0;

function update(dt) {
  const now = performance.now() / 1000;

  // Combat timers.
  if (player.attackUntil > 0 && now >= player.attackUntil) {
    player.attackUntil = 0;
    player.attackHit = false;
  }

  if (player.guardUntil > 0 && !keys.guard) endGuard();

  // Movement is disabled briefly after guard break/parry stun.
  const stunned = now < player.guardBrokenUntil;

  if (!stunned) {
    const accel = player.speed;

    if (keys.left && !keys.right) {
      player.vx = -accel;
      player.facing = -1;
    } else if (keys.right && !keys.left) {
      player.vx = accel;
      player.facing = 1;
    } else {
      player.vx = 0;
    }

    if (keys.jump && player.onGround && !isBlocking(player)) {
      player.vy = -player.jumpForce;
      player.onGround = false;
      keys.jump = false;
    }
  } else {
    player.vx = 0;
  }

  player.vy += GRAVITY * dt;
  if (player.vy > 1200) player.vy = 1200;

  moveAndCollide(player, player.vx * dt, player.vy * dt);

  // Check attacks after movement so the hitbox follows the current position.
  if (isAttacking(player)) processLocalAttack();

  const viewW = canvas.width;
  const viewH = canvas.height;
  camera.x = Math.max(0, Math.min(player.x - viewW / 2, Math.max(0, MAP_COLS * TILE - viewW)));
  camera.y = Math.max(0, Math.min(player.y - viewH / 2, Math.max(0, MAP_ROWS * TILE - viewH)));

  broadcastTimer += dt;
  if (broadcastTimer > 1 / 15) {
    broadcastTimer = 0;
    broadcastPosition(channel, playerId, player.x, player.y, player.facing);
  }
}

function draw() {
  ctx.fillStyle = "#1a2233";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#26314a");
  grad.addColorStop(1, "#12101a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const startCol = Math.max(0, Math.floor(camera.x / TILE) - 1);
  const endCol = Math.min(MAP_COLS, Math.ceil((camera.x + canvas.width) / TILE) + 1);
  const startRow = Math.max(0, Math.floor(camera.y / TILE) - 1);
  const endRow = Math.min(MAP_ROWS, Math.ceil((camera.y + canvas.height) / TILE) + 1);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      if (map[row][col] !== 1) continue;

      const sx = col * TILE - camera.x;
      const sy = row * TILE - camera.y;
      const isSurface = !isSolid(col, row - 1);

      ctx.fillStyle = isSurface ? "#5c8253" : "#4a3a2a";
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.strokeRect(sx, sy, TILE, TILE);
    }
  }

  for (const p of peers.values()) {
    drawCharacter(p.x - camera.x, p.y - camera.y, "#3a5a70", p.facing, p.username, p);
  }

  drawCharacter(player.x - camera.x, player.y - camera.y, "#d98b3f", player.facing, player.username, player);

  // Small combat status display.
  const now = performance.now() / 1000;
  let status = "";
  if (now < player.guardBrokenUntil) status = "GUARD BROKEN";
  else if (isParrying(player)) status = "PARRY";
  else if (isBlocking(player)) status = "BLOCK";
  else if (isAttacking(player)) status = "ATTACK";

  if (status) {
    ctx.font = "10px monospace";
    ctx.fillStyle = "#ead9b0";
    ctx.textAlign = "center";
    ctx.fillText(status, player.x - camera.x + player.w / 2, player.y - camera.y - 22);
  }
}

function drawCharacter(sx, sy, color, facing, label, state) {
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, player.w, player.h);

  // Face direction.
  ctx.fillStyle = "#12101a";
  const eyeX = facing === 1 ? sx + player.w - 6 : sx + 2;
  ctx.fillRect(eyeX, sy + 6, 4, 4);

  // Combat visuals.
  const now = performance.now() / 1000;
  if (isBlocking(state)) {
    ctx.strokeStyle = "#ead9b0";
    ctx.lineWidth = 3;
    ctx.strokeRect(sx - 3, sy - 3, player.w + 6, player.h + 6);
  }

  if (isParrying(state)) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 5, sy - 5, player.w + 10, player.h + 10);
  }

  if (isAttacking(state)) {
    const box = getAttackBox(state);
    ctx.fillStyle = "rgba(217,139,63,0.35)";
    ctx.fillRect(box.x - (player.x - sx), box.y - (player.y - sy), box.w, box.h);
  }

  if (state.guardBrokenUntil && state.guardBrokenUntil > now) {
    ctx.fillStyle = "#8a3636";
    ctx.fillRect(sx - 4, sy - 10, player.w + 8, 4);
  }

  ctx.font = "10px monospace";
  ctx.fillStyle = "#ead9b0";
  ctx.textAlign = "center";
  ctx.fillText(label ?? "", sx + player.w / 2, sy - 6);
}

function loop(time) {
  if (!running) return;
  const dt = Math.min((time - lastTime) / 1000, 1 / 30);
  lastTime = time;
  update(dt);
  draw();
  rafId = requestAnimationFrame(loop);
}

// ============================================================
// 8. START / STOP
// ============================================================
function startGame(server, username) {
  map = generateMap();

  player.username = username;
  playerId = crypto.randomUUID();

  const spawn = findSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.attackUntil = 0;
  player.attackCooldownUntil = 0;
  player.guardUntil = 0;
  player.parryUntil = 0;
  player.parryCooldownUntil = 0;
  player.guardBrokenUntil = 0;

  menuScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  hudWorld.textContent = server.name;
  resizeCanvas();

  channel = joinWorldChannel(server.id, playerId, username, {
    onPeerMove: (payload) => {
      const old = peers.get(payload.id) || {};
      peers.set(payload.id, { ...old, ...payload });
      updatePlayerCount();
    },
    onPeerCombat: receiveCombat,
    onPresenceSync: (state) => {
      hudPlayers.textContent = `${Object.keys(state).length} online`;
    },
    onPeerLeave: (id) => {
      peers.delete(id);
      updatePlayerCount();
    },
  });

  running = true;
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stopGame() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);

  if (keys.guard) endGuard();
  keys.left = false;
  keys.right = false;
  keys.jump = false;
  keys.guard = false;

  leaveWorldChannel(channel);
  channel = null;
  peers.clear();
}

function updatePlayerCount() {
  hudPlayers.textContent = `${peers.size + 1} online`;
}
