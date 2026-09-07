// game.js
import { fetchServers, joinWorldChannel, broadcastPosition, leaveWorldChannel } from "./supabase-client.js";

// ============================================================
// 1. MENU SCREEN WIRING
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
  serverSelect.innerHTML = list
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join("");
  serverListEl.innerHTML = list
    .map(
      (s) => `<li><span>${s.name}</span><span class="server-players">${s.description ?? ""}</span></li>`
    )
    .join("");
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
// 2. WORLD DATA (simple tile grid - 0 empty, 1 solid ground)
// ============================================================
const TILE = 32;
const MAP_ROWS = 20;
const MAP_COLS = 120;

function generateMap() {
  const map = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(0));
  const groundY = 13;
  for (let x = 0; x < MAP_COLS; x++) {
    // rolling terrain height
    const bump = Math.round(Math.sin(x * 0.15) * 2);
    const top = groundY + bump;
    for (let y = top; y < MAP_ROWS; y++) map[y][x] = 1;
    // occasional floating platform
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

let map, channel, playerId, running = false, rafId = null;
const peers = new Map(); // id -> { x, y, facing, username }
const keys = { left: false, right: false, jump: false };

const player = {
  x: TILE * 4,
  y: TILE * 5,
  w: 20,
  h: 30,
  vx: 0,
  vy: 0,
  onGround: false,
  facing: 1,
  speed: 50,
  jumpForce: 480,
  username: "Wanderer",
};

const GRAVITY = 1400;
const camera = { x: 0, y: 0 };

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);

// ---------- input ----------
function handleKey(e, isDown) {
  if (["a", "arrowleft"].includes(e.key.toLowerCase())) keys.left = isDown;
  if (["d", "arrowright"].includes(e.key.toLowerCase())) keys.right = isDown;
  if (e.key === " " || e.key.toLowerCase() === "w" || e.key === "ArrowUp") keys.jump = isDown;
}
window.addEventListener("keydown", (e) => handleKey(e, true));
window.addEventListener("keyup", (e) => handleKey(e, false));

// ---------- tile collision helpers ----------
function isSolid(col, row) {
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return false;
  return map[row][col] === 1;
}

function moveAndCollide(entity, dx, dy) {
  // horizontal
  entity.x += dx;
  resolveAxis(entity, "x", dx);
  // vertical
  entity.y += dy;
  entity.onGround = false;
  resolveAxis(entity, "y", dy);
}

function resolveAxis(entity, axis, delta) {
  const left = Math.floor(entity.x / TILE);
  const right = Math.floor((entity.x + entity.w) / TILE);
  const top = Math.floor(entity.y / TILE);
  const bottom = Math.floor((entity.y + entity.h) / TILE);

  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      if (!isSolid(col, row)) continue;
      const tileTop = row * TILE;
      const tileLeft = col * TILE;

      if (axis === "x") {
        if (delta > 0) entity.x = tileLeft - entity.w;
        else if (delta < 0) entity.x = tileLeft + TILE;
        entity.vx = 0;
      } else {
        if (delta > 0) {
          entity.y = tileTop - entity.h;
          entity.onGround = true;
        } else if (delta < 0) {
          entity.y = tileTop + TILE;
        }
        entity.vy = 0;
      }
    }
  }
}

// ============================================================
// 4. GAME LOOP
// ============================================================
let lastTime = 0;
let broadcastTimer = 0;

function update(dt) {
  // horizontal input
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

  // jump
  if (keys.jump && player.onGround) {
    player.vy = -player.jumpForce;
    player.onGround = false;
  }

  // gravity
  player.vy += GRAVITY * dt;
  if (player.vy > 1200) player.vy = 1200;

  moveAndCollide(player, player.vx * dt, player.vy * dt);

  // camera follows player, clamped to map bounds
  const viewW = canvas.width;
  const viewH = canvas.height;
  camera.x = Math.max(0, Math.min(player.x - viewW / 2, MAP_COLS * TILE - viewW));
  camera.y = Math.max(0, Math.min(player.y - viewH / 2, MAP_ROWS * TILE - viewH));

  // throttle network broadcasts to ~15/sec
  broadcastTimer += dt;
  if (broadcastTimer > 1 / 15) {
    broadcastTimer = 0;
    broadcastPosition(channel, playerId, player.x, player.y, player.facing);
  }
}

function draw() {
  ctx.fillStyle = "#1a2233";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // parallax sky glow
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#26314a");
  grad.addColorStop(1, "#12101a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const startCol = Math.floor(camera.x / TILE);
  const endCol = Math.ceil((camera.x + canvas.width) / TILE);
  const startRow = Math.floor(camera.y / TILE);
  const endRow = Math.ceil((camera.y + canvas.height) / TILE);

  for (let row = Math.max(0, startRow); row < Math.min(MAP_ROWS, endRow); row++) {
    for (let col = Math.max(0, startCol); col < Math.min(MAP_COLS, endCol); col++) {
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

  // peers
  for (const [id, p] of peers) {
    drawCharacter(p.x - camera.x, p.y - camera.y, "#3a5a70", p.facing, p.username);
  }

  // local player
  drawCharacter(player.x - camera.x, player.y - camera.y, "#d98b3f", player.facing, player.username);
}

function drawCharacter(sx, sy, color, facing, label) {
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, player.w, player.h);
  // eye to show facing direction
  ctx.fillStyle = "#12101a";
  const eyeX = facing === 1 ? sx + player.w - 6 : sx + 2;
  ctx.fillRect(eyeX, sy + 6, 4, 4);
  // name tag
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
// 5. START / STOP
// ============================================================
function startGame(server, username) {
  map = generateMap();
  player.username = username;
  player.x = TILE * 4;
  player.y = TILE * 5;
  playerId = crypto.randomUUID();

  menuScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  hudWorld.textContent = server.name;
  resizeCanvas();

  channel = joinWorldChannel(server.id, playerId, username, {
    onPeerMove: (payload) => {
      peers.set(payload.id, payload);
      updatePlayerCount();
    },
    onPresenceSync: (state) => {
      // presence state doubles as the online-count source of truth
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
  leaveWorldChannel(channel);
  channel = null;
  peers.clear();
}

function updatePlayerCount() {
  hudPlayers.textContent = `${peers.size + 1} online`;
}