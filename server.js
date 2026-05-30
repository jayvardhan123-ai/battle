const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 7860;

// Serve static front-end assets
app.use(express.static(path.join(__dirname, 'public')));

// Global state
const rooms = new Map(); // RoomCode -> RoomObject
const socketToRoom = new Map(); // SocketID -> RoomCode

// Room default parameters
const MAP_WIDTH = 3600;
const MAP_HEIGHT = 2700;
const PLAYER_RADIUS = 24;
const BASE_SPEED = 280; // pixels per second
const DASH_SPEED = 900; // pixels per second
const DASH_DURATION = 150; // ms
const DASH_COOLDOWN = 1200; // ms
const PARRY_DURATION = 450; // ms (slightly wider parry active window for smooth online parries)
const PARRY_COOLDOWN = 1200; // ms (faster, more dynamic parry cooldown)
const ATTACK_STARTUP = 80; // ms (delay before active hit window)
const ATTACK_ACTIVE = 100; // ms (hit detection active)
const ATTACK_RECOVERY = 150; // ms (can't move/attack)
const ATTACK_COOLDOWN = 600; // ms
const ATTACK_RANGE = 75; // pixels
const ATTACK_ARC = Math.PI / 2.2; // ~80 degrees arc

// Generate a random unique room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

// Helper to get opponent ID
function getOpponentId(room, id) {
  const ids = Object.keys(room.players);
  return ids.find(pId => pId !== id) || null;
}

// Start match countdown
function startCountdown(room) {
  room.state = 'COUNTDOWN';
  room.timer = 3;
  room.roundWinner = null;
  
  // Reset safe zone radius for the round
  room.safeZoneRadius = 1800;
  room.elapsedTime = 0;
  
  // Reset player states for the round
  const playerIds = Object.keys(room.players);
  playerIds.forEach((id, idx) => {
    const player = room.players[id];
    player.isDead = false;
    player.isDashing = false;
    player.isParrying = false;
    player.isAttacking = false;
    player.dashTimer = 0;
    player.parryTimer = 0;
    player.attackTimer = 0;
    player.dashCooldownTimer = 0;
    player.parryCooldownTimer = 0;
    player.attackCooldownTimer = 0;
    
    // Custom Interactive Map & Item states
    player.hasShield = false;
    player.shieldCooldownTimer = 0;
    player.invulnerableTimer = 0;
    player.speedBoostTimer = 0;
    player.teleportCooldown = 0;
    
    // Symmetrical 4-corner spawn gates based on connected indices
    if (idx === 0) {
      player.x = 300;
      player.y = MAP_HEIGHT / 2;
    } else if (idx === 1) {
      player.x = MAP_WIDTH - 300;
      player.y = MAP_HEIGHT / 2;
    } else if (idx === 2) {
      player.x = MAP_WIDTH / 2;
      player.y = 300;
    } else {
      player.x = MAP_WIDTH / 2;
      player.y = MAP_HEIGHT - 300;
    }
    player.vx = 0;
    player.vy = 0;
  });

  io.to(room.id).emit('roomState', getRoomPayload(room));

  const cdInterval = setInterval(() => {
    if (!rooms.has(room.id) || room.state !== 'COUNTDOWN') {
      clearInterval(cdInterval);
      return;
    }

    room.timer--;
    if (room.timer <= 0) {
      clearInterval(cdInterval);
      startRound(room);
    } else {
      io.to(room.id).emit('countdown', room.timer);
    }
  }, 1000);
}

// Start active playing round
function startRound(room) {
  room.state = 'PLAYING';
  room.timer = 90; // Boosted to 90 seconds to increase play time with storm warning delay
  room.elapsedTime = 0;
  room.safeZoneRadius = 1800;
  io.to(room.id).emit('roomState', getRoomPayload(room));

  // Match Timer interval
  room.timerInterval = setInterval(() => {
    if (!rooms.has(room.id) || room.state !== 'PLAYING') {
      clearInterval(room.timerInterval);
      return;
    }
    room.timer--;
    
    // Broadcast dynamic storm warnings during the first 20 seconds of play
    const roundedElapsed = Math.floor(room.elapsedTime);
    if (roundedElapsed <= 20) {
      const warningSecs = 20 - roundedElapsed;
      io.to(room.id).emit('stormWarning', warningSecs);
    }
    
    if (room.timer <= 0) {
      // Sudden death or draw on timeout
      clearInterval(room.timerInterval);
      endRound(room, null, 'Timeout! Round Draw.');
    } else {
      io.to(room.id).emit('timer', room.timer);
    }
  }, 1000);
}

// Check alive players and resolve Last-Man-Standing round ends
function checkRoundState(room, lastKillReason) {
  if (room.state !== 'PLAYING') return;
  const alivePlayers = Object.values(room.players).filter(p => !p.isDead);
  if (alivePlayers.length === 1) {
    const winner = alivePlayers[0];
    endRound(room, winner.id, lastKillReason || `${winner.username} is the last survivor!`);
  } else if (alivePlayers.length === 0) {
    endRound(room, null, 'Simultaneous elimination! Round Draw.');
  }
}

// End a round due to a kill or timeout
function endRound(room, winnerId, reason) {
  if (room.state !== 'PLAYING') return;
  
  clearInterval(room.timerInterval);
  room.state = 'ROUND_OVER';
  room.roundWinner = winnerId;
  
  if (winnerId) {
    room.scores[winnerId] = (room.scores[winnerId] || 0) + 1;
  }
  
  const payload = getRoomPayload(room);
  payload.endReason = reason;
  
  io.to(room.id).emit('roundOver', payload);

  // Check if someone won the match (best of bestOf options)
  let matchWinner = null;
  const targetWins = Math.ceil((room.bestOf || 3) / 2);
  Object.keys(room.scores).forEach(id => {
    if (room.scores[id] >= targetWins) {
      matchWinner = id;
    }
  });

  setTimeout(() => {
    if (!rooms.has(room.id)) return;
    
    if (matchWinner) {
      room.state = 'GAME_OVER';
      room.matchWinner = matchWinner;
      io.to(room.id).emit('roomState', getRoomPayload(room));
    } else {
      startCountdown(room);
    }
  }, 3500); // 3.5s delay to allow player death effects & slow-mo to complete
}

// Compress room payload for delivery
function getRoomPayload(room) {
  return {
    id: room.id,
    state: room.state,
    players: room.players,
    scores: room.scores,
    roundWinner: room.roundWinner,
    matchWinner: room.matchWinner,
    timer: room.timer,
    safeZoneRadius: room.safeZoneRadius !== undefined ? room.safeZoneRadius : 1800,
    hostId: room.hostId,
    bestOf: room.bestOf || 3,
    shrinkSpeed: room.shrinkSpeed || 'normal'
  };
}

// Main 60Hz Physics update loop per room
function updateRoomPhysics(room, dt) {
  const playerIds = Object.keys(room.players);
  if (playerIds.length < 1 && room.state !== 'LOBBY') {
    // If someone disconnected, put back in lobby
    room.state = 'LOBBY';
    if (room.physicsInterval) clearInterval(room.physicsInterval);
    if (room.timerInterval) clearInterval(room.timerInterval);
    io.to(room.id).emit('roomState', getRoomPayload(room));
    return;
  }

  // Allow physics updates during COUNTDOWN and PLAYING states
  if (room.state !== 'PLAYING' && room.state !== 'COUNTDOWN') return;

  const isPlaying = room.state === 'PLAYING';

  if (isPlaying) {
    // Handle Safe Zone collapsing with a 20-second warning lock
    room.elapsedTime += dt;
    
    const warningDelay = 20; // 20 seconds storm warning pause
    let shrinkDuration = 55; // Slower, gradual stable shrink duration to increase play time
    if (room.shrinkSpeed === 'fast') shrinkDuration = 35;
    else if (room.shrinkSpeed === 'slow') shrinkDuration = 70;

    if (room.elapsedTime <= warningDelay) {
      room.safeZoneRadius = 1800; // Locked stationary at borders during warning
    } else {
      const activeShrinkTime = room.elapsedTime - warningDelay;
      const shrinkProgress = Math.min(1, activeShrinkTime / shrinkDuration);
      room.safeZoneRadius = 1800 - shrinkProgress * (1800 - 150); // Slow gradual shrink
    }
  }

  playerIds.forEach(id => {
    const player = room.players[id];
    if (player.isDead) return;

    // Cooldown & Interactive State reductions
    if (player.dashCooldownTimer > 0) player.dashCooldownTimer -= dt * 1000;
    if (player.parryCooldownTimer > 0) player.parryCooldownTimer -= dt * 1000;
    if (player.attackCooldownTimer > 0) player.attackCooldownTimer -= dt * 1000;
    if (player.shieldCooldownTimer > 0) player.shieldCooldownTimer -= dt * 1000;
    if (player.invulnerableTimer > 0) player.invulnerableTimer -= dt * 1000;
    if (player.teleportCooldown > 0) player.teleportCooldown -= dt * 1000;

    // State timer reductions
    if (player.isDashing) {
      player.dashTimer -= dt * 1000;
      if (player.dashTimer <= 0) {
        player.isDashing = false;
      }
    }



    let speed = BASE_SPEED;
    let moveX = 0;
    let moveY = 0;

    // Parse input queue or current active inputs
    if (player.inputs) {
      const inputs = player.inputs;
      if (isPlaying) {
        if (inputs.w) moveY -= 1;
        if (inputs.s) moveY += 1;
        if (inputs.a) moveX -= 1;
        if (inputs.d) moveX += 1;
      }
      player.angle = inputs.angle || 0;

      // Combat triggers are ONLY active during PLAYING state
      if (isPlaying) {
        // Handle Dash Trigger (with 80ms network grace period)
        if (inputs.dash && !player.isDashing && player.dashCooldownTimer <= 80) {
          player.isDashing = true;
          player.dashTimer = DASH_DURATION;
          player.dashCooldownTimer = DASH_COOLDOWN;
          // Dash direction: inputs vector or angle direction
          let dx = moveX;
          let dy = moveY;
          if (dx === 0 && dy === 0) {
            dx = Math.cos(player.angle);
            dy = Math.sin(player.angle);
          }
          const len = Math.sqrt(dx*dx + dy*dy);
          player.dashDirX = dx / (len || 1);
          player.dashDirY = dy / (len || 1);
          io.to(room.id).emit('effect', { type: 'dash', playerId: id });
        }

        // Handle Shield Trigger (with 80ms network grace period)
        if (inputs.shield && !player.hasShield && player.shieldCooldownTimer <= 80 && !player.isDashing) {
          player.hasShield = true;
          player.shieldCooldownTimer = 10000; // 10 seconds cooldown
          io.to(room.id).emit('effect', { type: 'shield_activate', playerId: id });
        }

        // Handle Attack Trigger (with 80ms network grace period)
        if (inputs.attack && !player.isAttacking && player.attackCooldownTimer <= 80 && !player.isDashing) {
          player.isAttacking = true;
          player.attackStage = 'STARTUP';
          player.attackTimer = ATTACK_STARTUP;
          player.attackCooldownTimer = ATTACK_COOLDOWN;
          io.to(room.id).emit('effect', { type: 'slash_trigger', playerId: id, angle: player.angle });
        }
      }
    }

    // Apply movement velocities (always active during countdown & playing)
    if (player.isDashing) {
      player.vx = player.dashDirX * DASH_SPEED;
      player.vy = player.dashDirY * DASH_SPEED;
    } else {
      // Normal 8-way movement normalization
      let activeSpeed = BASE_SPEED;
      if (moveX !== 0 || moveY !== 0) {
        const len = Math.sqrt(moveX * moveX + moveY * moveY);
        player.vx = (moveX / len) * activeSpeed;
        player.vy = (moveY / len) * activeSpeed;
      } else {
        player.vx = 0;
        player.vy = 0;
      }
    }

    // Apply position updates with boundary collision bounds
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (player.x < PLAYER_RADIUS) player.x = PLAYER_RADIUS;
    if (player.x > MAP_WIDTH - PLAYER_RADIUS) player.x = MAP_WIDTH - PLAYER_RADIUS;
    if (player.y < PLAYER_RADIUS) player.y = PLAYER_RADIUS;
    if (player.y > MAP_HEIGHT - PLAYER_RADIUS) player.y = MAP_HEIGHT - PLAYER_RADIUS;

    // Authoritative Circular Solid Storm Boundary Wall (Blocks player movements like a solid round barrier)
    const sDx = player.x - 1800;
    const sDy = player.y - 1350;
    const sDist = Math.sqrt(sDx*sDx + sDy*sDy);
    const maxRadius = room.safeZoneRadius - PLAYER_RADIUS;
    if (sDist > maxRadius) {
      const angle = Math.atan2(sDy, sDx);
      player.x = 1800 + Math.cos(angle) * maxRadius;
      player.y = 1350 + Math.sin(angle) * maxRadius;
    }

    // Authoritative Solid Obstacle collisions (Central & Mini Pillars push-out)
    const obstacles = [
      { x: 1800, y: 1350, r: 100 }, // Central Pillar
      { x: 900, y: 600, r: 32 },    // Mini Pillar 1
      { x: 900, y: 2100, r: 32 },   // Mini Pillar 2
      { x: 2700, y: 600, r: 32 },   // Mini Pillar 3
      { x: 2700, y: 2100, r: 32 }   // Mini Pillar 4
    ];

    obstacles.forEach(obs => {
      const dx = player.x - obs.x;
      const dy = player.y - obs.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const minDist = obs.r + PLAYER_RADIUS;
      if (dist < minDist) {
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        player.x = obs.x + nx * minDist;
        player.y = obs.y + ny * minDist;
      }
    });

    // Portals and combat effects are ONLY processed when actively playing
    if (isPlaying) {
      // Interactive Portals Overlaps Checking
      const portalA = { x: 600, y: 2100 };
      const portalB = { x: 3000, y: 600 };

      let portalDx = player.x - portalA.x;
      let portalDy = player.y - portalA.y;
      let portalD = Math.sqrt(portalDx*portalDx + portalDy*portalDy);
      if (portalD < 28 && player.teleportCooldown <= 0) {
        player.x = portalB.x;
        player.y = portalB.y;
        player.teleportCooldown = 1500; // 1.5 second portal cooldown
        io.to(room.id).emit('effect', {
          type: 'teleport',
          playerId: id,
          fromX: portalA.x,
          fromY: portalA.y,
          toX: portalB.x,
          toY: portalB.y
        });
      } else {
        portalDx = player.x - portalB.x;
        portalDy = player.y - portalB.y;
        portalD = Math.sqrt(portalDx*portalDx + portalDy*portalDy);
        if (portalD < 28 && player.teleportCooldown <= 0) {
          player.x = portalA.x;
          player.y = portalA.y;
          player.teleportCooldown = 1500;
          io.to(room.id).emit('effect', {
            type: 'teleport',
            playerId: id,
            fromX: portalB.x,
            fromY: portalB.y,
            toX: portalA.x,
            toY: portalA.y
          });
        }
      }

      // Additional Portal Pair for map size spacing
      const portalC = { x: 600, y: 600 };
      const portalD_pad = { x: 3000, y: 2100 };

      let portalC_Dx = player.x - portalC.x;
      let portalC_Dy = player.y - portalC.y;
      let portalC_D = Math.sqrt(portalC_Dx*portalC_Dx + portalC_Dy*portalC_Dy);
      if (portalC_D < 28 && player.teleportCooldown <= 0) {
        player.x = portalD_pad.x;
        player.y = portalD_pad.y;
        player.teleportCooldown = 1500;
        io.to(room.id).emit('effect', {
          type: 'teleport',
          playerId: id,
          fromX: portalC.x,
          fromY: portalC.y,
          toX: portalD_pad.x,
          toY: portalD_pad.y
        });
      } else {
        let portalD_Dx = player.x - portalD_pad.x;
        let portalD_Dy = player.y - portalD_pad.y;
        let portalD_D = Math.sqrt(portalD_Dx*portalD_Dx + portalD_Dy*portalD_Dy);
        if (portalD_D < 28 && player.teleportCooldown <= 0) {
          player.x = portalC.x;
          player.y = portalC.y;
          player.teleportCooldown = 1500;
          io.to(room.id).emit('effect', {
            type: 'teleport',
            playerId: id,
            fromX: portalD_pad.x,
            fromY: portalD_pad.y,
            toX: portalC.x,
            toY: portalC.y
          });
        }
      }

      // Handle Attack Updates & Active Hitbox Checking
      if (player.isAttacking) {
        player.attackTimer -= dt * 1000;
        if (player.attackStage === 'STARTUP' && player.attackTimer <= 0) {
          // Transition to ACTIVE state
          player.attackStage = 'ACTIVE';
          player.attackTimer = ATTACK_ACTIVE;
          
          // Execute active hit detection
          checkAttackHits(room, id);
        } else if (player.attackStage === 'ACTIVE' && player.attackTimer <= 0) {
          // Transition to RECOVERY state
          player.attackStage = 'RECOVERY';
          player.attackTimer = ATTACK_RECOVERY;
        } else if (player.attackStage === 'RECOVERY' && player.attackTimer <= 0) {
          // Complete attack
          player.isAttacking = false;
        }
      }

      // Check Safe Zone touch instant elimination (Only lethal once storm actively shrinks in PLAYING state)
      const warningDelay = 20;
      const isStormLethal = room.state === 'PLAYING' && room.elapsedTime > warningDelay;
      
      const centerX = 1800;
      const centerY = 1350;
      const sDx = player.x - centerX;
      const sDy = player.y - centerY;
      const sDist = Math.sqrt(sDx*sDx + sDy*sDy);
      if (isStormLethal && sDist > room.safeZoneRadius) {
        player.isDead = true;
        io.to(room.id).emit('effect', {
          type: 'kill_strike',
          killerId: 'STORM',
          victimId: id,
          x: player.x,
          y: player.y
        });
        checkRoundState(room, `${player.username} disintegrated in the storm!`);
      }
    }

    // Reset inputs triggers to avoid sticky action states
    if (player.inputs) {
      player.inputs.dash = false;
      player.inputs.attack = false;
      player.inputs.shield = false;
    }
  });

  // Broadcast positions and storm safe zone radius at 60Hz
  io.to(room.id).emit('sync', room.players);
  io.to(room.id).emit('stormSync', room.safeZoneRadius);
}

// Authoritative hitbox collision detection
function checkAttackHits(room, attackerId) {
  const attacker = room.players[attackerId];
  const playerIds = Object.keys(room.players);

  playerIds.forEach(targetId => {
    if (targetId === attackerId) return;
    const target = room.players[targetId];
    if (target.isDead) return;

    // Calculate distance between attacker and target
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // If within maximum slash reach
    if (dist <= ATTACK_RANGE + PLAYER_RADIUS) {
      // Calculate angular check to verify if opponent falls inside the slash cone
      const angleToTarget = Math.atan2(dy, dx);
      let angleDiff = Math.abs(angleToTarget - attacker.angle);
      
      // Normalize angle difference to [0, Math.PI]
      if (angleDiff > Math.PI) {
        angleDiff = 2 * Math.PI - angleDiff;
      }

      if (angleDiff <= ATTACK_ARC / 2) {
        // Absolute clean hit! Target dies unless shielded!
        if (target.hasShield && !(target.invulnerableTimer > 0)) {
          // Pop shield instead of death!
          target.hasShield = false;
          target.invulnerableTimer = 700; // 700ms invulnerable buffer
          io.to(room.id).emit('effect', {
            type: 'shield_pop',
            playerId: targetId,
            x: target.x,
            y: target.y
          });
        } else if (!(target.invulnerableTimer > 0)) {
          target.isDead = true;
          io.to(room.id).emit('effect', { 
            type: 'kill_strike', 
            killerId: attackerId, 
            victimId: targetId,
            x: target.x,
            y: target.y
          });
          checkRoundState(room, `${attacker.username} sliced ${target.username}!`);
        }
      }
    }
  });
}

// Socket.IO event registrations
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create new room lobby
  socket.on('createRoom', ({ username, color }) => {
    const code = generateRoomCode();
    const room = {
      id: code,
      state: 'LOBBY',
      hostId: socket.id,
      bestOf: 3,
      shrinkSpeed: 'normal',
      players: {
        [socket.id]: {
          id: socket.id,
          username: username || 'Player 1',
          color: color || '#00f0ff',
          x: 300,
          y: MAP_HEIGHT / 2,
          vx: 0,
          vy: 0,
          angle: 0,
          isDead: false,
          isDashing: false,
          isParrying: false,
          isAttacking: false,
          dashCooldownTimer: 0,
          parryCooldownTimer: 0,
          attackCooldownTimer: 0,
          shieldCooldownTimer: 0,
          hasShield: false,
          invulnerableTimer: 0,
          speedBoostTimer: 0,
          teleportCooldown: 0
        }
      },
      scores: {},
      roundWinner: null,
      matchWinner: null,
      timer: 0,
      timerInterval: null,
      physicsInterval: null
    };

    room.scores[socket.id] = 0;
    rooms.set(code, room);
    socketToRoom.set(socket.id, code);

    socket.join(code);
    socket.emit('roomCreated', { code, roomState: getRoomPayload(room) });
    console.log(`Room created: ${code} by ${username} (${socket.id})`);
  });

  // Join existing room lobby
  socket.on('joinRoom', ({ username, code, color }) => {
    const cleanCode = code ? code.trim().toUpperCase() : '';
    const room = rooms.get(cleanCode);

    if (!room) {
      socket.emit('errorMsg', 'Room not found.');
      return;
    }

    if (Object.keys(room.players).length >= 4) {
      socket.emit('errorMsg', 'Room is full (max 4 players).');
      return;
    }

    if (room.state !== 'LOBBY') {
      socket.emit('errorMsg', 'Match already in progress.');
      return;
    }

    // Ensure joining player color is unique among all current players
    let pColor = color || '#ff0055';
    const defaultColors = ['#ff0055', '#00f0ff', '#00ff66', '#fffb00', '#ff6600', '#b026ff'];
    const takenColors = Object.values(room.players).map(p => p.color);
    if (takenColors.includes(pColor)) {
      pColor = defaultColors.find(c => !takenColors.includes(c)) || '#ff0055';
    }

    // Add player to lobby
    room.players[socket.id] = {
      id: socket.id,
      username: username || 'Player 2',
      color: pColor,
      x: MAP_WIDTH - 300,
      y: MAP_HEIGHT / 2,
      vx: 0,
      vy: 0,
      angle: 0,
      isDead: false,
      isDashing: false,
      isParrying: false,
      isAttacking: false,
      dashCooldownTimer: 0,
      parryCooldownTimer: 0,
      attackCooldownTimer: 0,
      shieldCooldownTimer: 0,
      hasShield: false,
      invulnerableTimer: 0,
      speedBoostTimer: 0,
      teleportCooldown: 0
    };
    room.scores[socket.id] = 0;
    socketToRoom.set(socket.id, cleanCode);
    socket.join(cleanCode);

    console.log(`Player joined room ${cleanCode}: ${username} (${socket.id})`);

    // Broadcast room join update
    io.to(cleanCode).emit('roomState', getRoomPayload(room));
  });

  // Quick Play matchmaking logic
  socket.on('quickPlay', ({ username, color }) => {
    // Find any room that is in LOBBY state and has space (less than 4 players)
    let lobbyRoom = null;
    for (const [code, r] of rooms.entries()) {
      const count = Object.keys(r.players).length;
      if (r.state === 'LOBBY' && count >= 1 && count < 4) {
        lobbyRoom = r;
        break;
      }
    }

    if (lobbyRoom) {
      // Join existing room
      socket.emit('matchFound', { action: 'join', code: lobbyRoom.id });
    } else {
      // Create a brand new room
      const newCode = generateRoomCode();
      const room = {
        id: newCode,
        state: 'LOBBY',
        hostId: socket.id,
        bestOf: 3,
        shrinkSpeed: 'normal',
        players: {
          [socket.id]: {
            id: socket.id,
            username: username || 'CyberSlayer',
            color: color || '#00f0ff',
            x: 300,
            y: MAP_HEIGHT / 2,
            vx: 0,
            vy: 0,
            angle: 0,
            isDead: false,
            isDashing: false,
            isParrying: false,
            isAttacking: false,
            dashCooldownTimer: 0,
            parryCooldownTimer: 0,
            attackCooldownTimer: 0,
            shieldCooldownTimer: 0,
            hasShield: false,
            invulnerableTimer: 0,
            speedBoostTimer: 0,
            teleportCooldown: 0
          }
        },
        scores: {},
        roundWinner: null,
        matchWinner: null,
        timer: 0,
        timerInterval: null,
        physicsInterval: null
      };

      room.scores[socket.id] = 0;
      rooms.set(newCode, room);
      socketToRoom.set(socket.id, newCode);

      socket.join(newCode);
      socket.emit('roomCreated', { code: newCode, roomState: getRoomPayload(room) });
      console.log(`QuickPlay created room: ${newCode} by ${username}`);
    }
  });

  // Receive client inputs
  socket.on('input', (inputs) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players[socket.id];
    if (player && !player.isDead) {
      if (!player.inputs) {
        player.inputs = inputs;
      } else {
        // Accumulate discrete triggers (OR logic) between server ticks to prevent input dropouts
        const accumulatedDash = player.inputs.dash || inputs.dash;
        const accumulatedAttack = player.inputs.attack || inputs.attack;
        const accumulatedShield = player.inputs.shield || inputs.shield;
        
        player.inputs = inputs;
        
        player.inputs.dash = accumulatedDash;
        player.inputs.attack = accumulatedAttack;
        player.inputs.shield = accumulatedShield;
      }
    }
  });

  // Host updates match settings
  socket.on('updateSettings', ({ bestOf, shrinkSpeed }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (room.hostId !== socket.id) return;

    room.bestOf = parseInt(bestOf) || 3;
    room.shrinkSpeed = shrinkSpeed || 'normal';

    io.to(code).emit('roomState', getRoomPayload(room));
  });

  // Host starts the match manually
  socket.on('startMatch', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (room.hostId !== socket.id) return;
    if (Object.keys(room.players).length < 1) return;
    if (room.state !== 'LOBBY') return;

    // Clear any existing physics loop to avoid concurrent interval leaks
    if (room.physicsInterval) clearInterval(room.physicsInterval);

    let lastTime = Date.now();
    room.physicsInterval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      updateRoomPhysics(room, dt);
    }, 1000 / 60);

    startCountdown(room);
  });

  // Lobby Color Selector
  socket.on('selectColor', ({ color }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (room.state !== 'LOBBY') return;

    const isColorTaken = Object.keys(room.players).some(pId => {
      return pId !== socket.id && room.players[pId].color === color;
    });

    if (isColorTaken) {
      socket.emit('errorMsg', 'COLOR ALREADY TAKEN BY OPPONENT.');
      return;
    }

    if (room.players[socket.id]) {
      room.players[socket.id].color = color;
      io.to(code).emit('roomState', getRoomPayload(room));
    }
  });

  // Rematch request handler
  socket.on('requestRematch', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    // Reset score board
    Object.keys(room.scores).forEach(id => {
      room.scores[id] = 0;
    });
    room.matchWinner = null;
    room.roundWinner = null;

    // Alert opponent that a rematch is starting
    io.to(code).emit('rematchAccepted');
    startCountdown(room);
  });

  // Chat message broadcast receiver
  socket.on('chatMessage', ({ text }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    const cleanText = text ? text.trim().substring(0, 60) : '';
    if (!cleanText) return;

    io.to(code).emit('chatMessage', {
      playerId: socket.id,
      username: player.username,
      color: player.color,
      text: cleanText
    });
  });

  // Socket disconnected
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const code = socketToRoom.get(socket.id);
    if (code) {
      const room = rooms.get(code);
      if (room) {
        delete room.players[socket.id];
        delete room.scores[socket.id];
        socketToRoom.delete(socket.id);

        if (Object.keys(room.players).length === 0) {
          // Clear interval clocks if room is destroyed
          if (room.physicsInterval) clearInterval(room.physicsInterval);
          if (room.timerInterval) clearInterval(room.timerInterval);
          rooms.delete(code);
          console.log(`Room ${code} destroyed (empty)`);
        } else {
          // Check if active match needs to drop back to lobby (if < 2 players remain)
          const remainingCount = Object.keys(room.players).length;
          if (remainingCount < 2 && room.state !== 'LOBBY') {
            room.state = 'LOBBY';
            room.matchWinner = null;
            room.roundWinner = null;
            if (room.physicsInterval) clearInterval(room.physicsInterval);
            if (room.timerInterval) clearInterval(room.timerInterval);
            io.to(code).emit('opponentDisconnected');
            io.to(code).emit('roomState', getRoomPayload(room));
            console.log(`Player left room ${code}. Remaining count < 2. Room reset to lobby.`);
          } else {
            // Match continues! Just notify and broadcast updated room state
            if (room.state === 'PLAYING') {
              // Count disconnected player as dead and check round states
              checkRoundState(room);
            }
            io.to(code).emit('roomState', getRoomPayload(room));
            console.log(`Player left room ${code}. Match continues with ${remainingCount} players.`);
          }
        }
      }
    }
  });
});

// Run HTTP server
server.listen(PORT, () => {
  console.log(`=== 1HP Cyberpunk Authoritative Server running on port ${PORT} ===`);
});
