/**
 * 1HP Socket.IO Network client controller
 * Bridges network synchronization states and combat events to the Phaser view & Audio engine
 */

const socket = io();

// Client Network States
let myId = null;
let roomCode = null;
let currentLobbyState = null;
let isPhaserInitialized = false;

// DOM Selectors
const screens = {
  menu: document.getElementById('menu-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  results: document.getElementById('results-screen')
};

const usernameInput = document.getElementById('username-input');
const quickPlayBtn = document.getElementById('quick-play-btn');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const leaveLobbyBtn = document.getElementById('leave-lobby-btn');
const rematchBtn = document.getElementById('rematch-btn');
const resultsExitBtn = document.getElementById('results-exit-btn');

const lobbyCodeDisplay = document.getElementById('lobby-code-display');
const lobbyStatusText = document.getElementById('lobby-status-text');
const playersList = document.getElementById('players-list');
const toastEl = document.getElementById('toast');

// Floating HUD elements
const hudTimerVal = document.getElementById('hud-timer-value');
const hudRoundLabel = document.getElementById('hud-round-label');
const hudNameP1 = document.getElementById('hud-name-p1');
const hudNameP2 = document.getElementById('hud-name-p2');
const hudScoreP1 = document.getElementById('hud-score-p1');
const hudScoreP2 = document.getElementById('hud-score-p2');
const hudKillfeed = document.getElementById('hud-killfeed');

// Cooldown HUD rings
const cooldownDashRing = document.getElementById('cooldown-dash-ring');
const cooldownAttackRing = document.getElementById('cooldown-attack-ring');
const cooldownShieldRing = document.getElementById('cooldown-shield-ring');

// Match Settings Selectors
const lobbyBestOf = document.getElementById('lobby-best-of');
const lobbyShrinkSpeed = document.getElementById('lobby-shrink-speed');
const lobbyStartBtn = document.getElementById('lobby-start-btn');

// Toast feedback helper
function showToast(msg, duration = 3000) {
  toastEl.innerText = msg;
  toastEl.classList.remove('hidden');
  
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, duration);
}

// Screen Routing
function showScreen(targetScreen) {
  Object.keys(screens).forEach(key => {
    if (screens[key] === targetScreen) {
      screens[key].classList.remove('hidden');
      screens[key].classList.add('active');
    } else {
      screens[key].classList.add('hidden');
      screens[key].classList.remove('active');
    }
  });
}

// Extract and validate username input
function getUsername() {
  const name = usernameInput.value.trim();
  return name || 'CyberSlayer';
}

// Extract selected chassis neon emission color
function getSelectedColor() {
  const activeOpt = document.querySelector('.color-option.active');
  return activeOpt ? activeOpt.dataset.color : '#00f0ff';
}

// Initialize User actions & Input clicks
document.addEventListener('DOMContentLoaded', () => {
  
  // Handle Neon Color selection click events
  const colorOptions = document.querySelectorAll('.color-option');
  colorOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      if (opt.classList.contains('taken')) return; // Taken colors are unclickable
      
      const hexColor = opt.dataset.color;
      
      if (roomCode) {
        // Emit selectColor to the server
        socket.emit('selectColor', { color: hexColor });
      } else {
        // Local menu styling
        colorOptions.forEach(o => {
          o.classList.remove('active');
          o.style.boxShadow = 'none';
        });
        opt.classList.add('active');
        opt.style.boxShadow = `0 0 12px ${hexColor}`;
      }
    });
  });

  // Random username generator for quick starts
  const placeholders = ['NeonStalker', 'GlitchGhost', 'SubZero', 'HackZilla', 'NullPointer', 'ByteSlasher', 'CyberReaper', 'HexBlade'];
  usernameInput.placeholder = `E.G. ${placeholders[Math.floor(Math.random() * placeholders.length)]}...`;

  // Quick Play Matchmaking
  quickPlayBtn.addEventListener('click', () => {
    CyberSynth.init();
    socket.emit('quickPlay', { username: getUsername(), color: getSelectedColor() });
  });

  // Create Lobby Room Code
  createRoomBtn.addEventListener('click', () => {
    CyberSynth.init();
    socket.emit('createRoom', { username: getUsername(), color: getSelectedColor() });
  });

  // Join Existing Lobby
  joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 4) {
      showToast('ENTER A VALID 4-DIGIT ACCESS KEY!');
      return;
    }
    CyberSynth.init();
    socket.emit('joinRoom', { username: getUsername(), code, color: getSelectedColor() });
  });

  // Disconnect from Lobby
  leaveLobbyBtn.addEventListener('click', () => {
    window.location.reload(); // Quick reset
  });

  // Host manual match options change events
  lobbyBestOf.addEventListener('change', () => {
    if (currentLobbyState && currentLobbyState.hostId === socket.id) {
      socket.emit('updateSettings', {
        bestOf: lobbyBestOf.value,
        shrinkSpeed: lobbyShrinkSpeed.value
      });
    }
  });

  lobbyShrinkSpeed.addEventListener('change', () => {
    if (currentLobbyState && currentLobbyState.hostId === socket.id) {
      socket.emit('updateSettings', {
        bestOf: lobbyBestOf.value,
        shrinkSpeed: lobbyShrinkSpeed.value
      });
    }
  });

  // Host clicks manual Start Duel button
  lobbyStartBtn.addEventListener('click', () => {
    socket.emit('startMatch');
  });

  // Request Rematch
  rematchBtn.addEventListener('click', () => {
    CyberSynth.init();
    rematchBtn.disabled = true;
    rematchBtn.querySelector('.btn-text').innerText = 'QUEUED FOR MATCH...';
    socket.emit('requestRematch');
  });

  // Exit game completely
  resultsExitBtn.addEventListener('click', () => {
    window.location.reload();
  });

  // Lobby Chat Send Interceptor
  const lobbyChatInput = document.getElementById('lobby-chat-input');
  if (lobbyChatInput) {
    lobbyChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = lobbyChatInput.value.trim();
        if (text) {
          socket.emit('chatMessage', { text });
          lobbyChatInput.value = '';
        }
      }
    });
  }

  // In-Game Chat Send Interceptor
  const hudChatInput = document.getElementById('hud-chat-input');
  const hudChatInputWrapper = document.getElementById('hud-chat-input-wrapper');
  if (hudChatInput && hudChatInputWrapper) {
    hudChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = hudChatInput.value.trim();
        if (text) {
          socket.emit('chatMessage', { text });
          hudChatInput.value = '';
        }
        hudChatInputWrapper.classList.add('hidden');
        hudChatInput.blur();
      }
    });
  }

  // Lobby Copy Invite Link
  const lobbyCopyLinkBtn = document.getElementById('lobby-copy-link-btn');
  if (lobbyCopyLinkBtn) {
    lobbyCopyLinkBtn.addEventListener('click', () => {
      if (roomCode) {
        const inviteUrl = `${window.location.origin}/?join=${roomCode}`;
        navigator.clipboard.writeText(inviteUrl).then(() => {
          showToast(`COM-LINK COPIED: TRANSMIT TO COMBATANTS!`);
          if (typeof CyberSynth !== 'undefined' && CyberSynth.playChat) {
            CyberSynth.playChat();
          }
        }).catch(err => {
          console.error('Failed to copy com-link: ', err);
          showToast(`ACCESS KEY IS: ${roomCode}`);
        });
      }
    });
  }

  // Auto Join URL Parser
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = urlParams.get('room') || urlParams.get('join');
  if (inviteCode && inviteCode.length === 4) {
    const cleanCode = inviteCode.trim().toUpperCase();
    const codeInput = document.getElementById('room-code-input');
    if (codeInput) {
      codeInput.value = cleanCode;
      showToast(`COM-LINK ACQUIRED: ROOM ${cleanCode}`, 4000);
      
      // Flash the join button to guide the player
      const joinBtn = document.getElementById('join-room-btn');
      if (joinBtn) {
        joinBtn.style.animation = 'pulse-glow 1s infinite ease-in-out';
      }
    }
  }
});

// Socket Event Receivers
socket.on('connect', () => {
  myId = socket.id;
  console.log(`Connected to game server. Codex ID: ${myId}`);
});

// Receive Chat Messages from room broadcast
socket.on('chatMessage', (data) => {
  const isLobbyActive = screens.lobby.classList.contains('active');
  
  if (typeof CyberSynth !== 'undefined' && CyberSynth.playChat) {
    CyberSynth.playChat();
  }

  // Resolve Host Badge
  const isHostMsg = currentLobbyState && data.playerId === currentLobbyState.hostId;
  const hostBadgeHTML = isHostMsg ? ' <span class="host-tag" style="color: var(--neon-yellow); text-shadow: 0 0 6px rgba(255, 251, 0, 0.4); font-size: 0.75rem; font-weight: bold; margin-left: 4px;">[HOST]</span>' : '';

  if (isLobbyActive) {
    const messagesBox = document.getElementById('lobby-chat-messages');
    if (messagesBox) {
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message';
      msgEl.innerHTML = `<span class="msg-username" style="color: ${data.color}; text-shadow: 0 0 4px ${data.color}40;">${data.username.toUpperCase()}${hostBadgeHTML}:</span><span>${data.text}</span>`;
      messagesBox.appendChild(msgEl);
      messagesBox.scrollTop = messagesBox.scrollHeight;
    }
  } else {
    const messagesBox = document.getElementById('hud-chat-messages');
    if (messagesBox) {
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message';
      msgEl.innerHTML = `<span class="msg-username" style="color: ${data.color}; text-shadow: 0 0 4px ${data.color}40;">${data.username.toUpperCase()}${hostBadgeHTML}:</span><span>${data.text}</span>`;
      messagesBox.appendChild(msgEl);
      messagesBox.scrollTop = messagesBox.scrollHeight;

      setTimeout(() => {
        msgEl.classList.add('fade-out');
      }, 6000);

      setTimeout(() => {
        msgEl.remove();
      }, 15000);
    }
  }
});

socket.on('roomCreated', ({ code, roomState }) => {
  roomCode = code;
  lobbyCodeDisplay.innerText = code;
  updateLobbyUI(roomState);
  showScreen(screens.lobby);
});

socket.on('matchFound', ({ code }) => {
  socket.emit('joinRoom', { username: getUsername(), code, color: getSelectedColor() });
});

socket.on('roomState', (roomState) => {
  currentLobbyState = roomState;
  
  if (roomState.state === 'LOBBY') {
    updateLobbyUI(roomState);
    showScreen(screens.lobby);
  } else if (roomState.state === 'COUNTDOWN' || roomState.state === 'PLAYING') {
    startActiveGame(roomState);
  } else if (roomState.state === 'GAME_OVER') {
    showResultsScreen(roomState);
  }
});

socket.on('countdown', (seconds) => {
  // Hide round resolved scoreboard during countdown transitions
  const resolvedOverlay = document.getElementById('hud-round-resolved-overlay');
  if (resolvedOverlay) {
    resolvedOverlay.classList.add('hidden');
    resolvedOverlay.classList.remove('active');
  }

  hudRoundLabel.innerText = `READY IN: ${seconds}`;
  // Synthesize warning tones for countdown
  if (isPhaserInitialized && window.gameScene) {
    window.gameScene.showCountdownText(seconds);
  }
});

socket.on('timer', (seconds) => {
  hudTimerVal.innerText = seconds;
});

socket.on('errorMsg', (msg) => {
  showToast(msg);
});

socket.on('opponentDisconnected', () => {
  showToast('TARGET SIGNAL LOST! OPPONENT DISCONNECTED.');
});

socket.on('rematchAccepted', () => {
  rematchBtn.disabled = false;
  rematchBtn.querySelector('.btn-text').innerText = 'INITIATE REMATCH';
  showToast('REMATCH INITIATED! LOADING ARENA...', 2000);
});

// Handle Dynamic Lobby Rendering
function updateLobbyUI(roomState) {
  playersList.innerHTML = '';
  const playerIds = Object.keys(roomState.players);
  const isHost = roomState.hostId === socket.id;
  
  playerIds.forEach(id => {
    const p = roomState.players[id];
    const item = document.createElement('div');
    item.className = 'player-lobby-item';
    
    const isPlayerHost = id === roomState.hostId;
    const hostTagHTML = isPlayerHost ? ' <span class="host-tag" style="color: var(--neon-yellow); text-shadow: 0 0 6px rgba(255, 251, 0, 0.4); font-size: 0.75rem; font-weight: bold; margin-left: 6px;">[HOST]</span>' : '';
    const youTagHTML = id === socket.id ? ' (YOU)' : '';
    
    item.innerHTML = `<span>${p.username}${youTagHTML}${hostTagHTML}</span><span class="ready-tag" style="color: ${p.color}; text-shadow: 0 0 8px ${p.color};">ONLINE</span>`;
    playersList.appendChild(item);
  });

  // Configure settings panel based on Host status
  if (isHost) {
    // Host has write access
    lobbyBestOf.disabled = false;
    lobbyShrinkSpeed.disabled = false;
    lobbyStartBtn.style.display = 'block';
    
    if (playerIds.length >= 1) {
      lobbyStartBtn.disabled = false;
      lobbyStartBtn.classList.remove('disabled');
      lobbyStatusText.innerText = 'SIGNAL STABLE. DUEL LAUNCH READY.';
    } else {
      lobbyStartBtn.disabled = true;
      lobbyStartBtn.classList.add('disabled');
      lobbyStatusText.innerText = 'AWAITING TARGET SIGNAL...';
    }
  } else {
    // Guest sees read-only settings
    lobbyBestOf.disabled = true;
    lobbyShrinkSpeed.disabled = true;
    lobbyStartBtn.style.display = 'none'; // Guest can't see start match button
    
    // Sync guest dropdown views
    lobbyBestOf.value = roomState.bestOf || 3;
    lobbyShrinkSpeed.value = roomState.shrinkSpeed || 'normal';
    
    if (playerIds.length >= 2) {
      lobbyStatusText.innerText = 'WAITING FOR HOST TO LAUNCH DUEL...';
    } else {
      lobbyStatusText.innerText = 'AWAITING TARGET SIGNAL...';
    }
  }

  // Update Color Selector Locking dynamically for all opponents
  const colorOptions = document.querySelectorAll('.color-option');
  const opponentColors = Object.values(roomState.players)
    .filter(p => p.id !== myId)
    .map(p => p.color);
  
  const myPlayer = roomState.players[myId];
  const myColor = myPlayer ? myPlayer.color : null;

  colorOptions.forEach(opt => {
    const col = opt.dataset.color;
    
    if (opponentColors.includes(col)) {
      opt.classList.add('taken');
      opt.classList.remove('active');
      opt.style.boxShadow = 'none';
    } else {
      opt.classList.remove('taken');
      if (col === myColor) {
        opt.classList.add('active');
        opt.style.boxShadow = `0 0 12px ${col}`;
      } else {
        opt.classList.remove('active');
        opt.style.boxShadow = 'none';
      }
    }
  });
}

// Transition into active Phaser Arena
function startActiveGame(roomState) {
  showScreen(screens.game);
  
  // Hide round resolved scoreboard during active round phases
  const resolvedOverlay = document.getElementById('hud-round-resolved-overlay');
  if (resolvedOverlay) {
    resolvedOverlay.classList.add('hidden');
    resolvedOverlay.classList.remove('active');
  }

  // Expose initial positions globally for Phaser's first round creation loop
  window.initialPlayersMap = roomState.players;
  
  const playerIds = Object.keys(roomState.players);

  // Render and update player HUD dynamic grids
  renderHUDPlayers(roomState);

  // Initialize Phaser
  if (!isPhaserInitialized) {
    initPhaserGame(playerIds);
    isPhaserInitialized = true;
  } else {
    // Reset existing scene
    if (window.gameScene) {
      window.gameScene.resetRound(playerIds, roomState.players);
    }
  }

  hudRoundLabel.innerText = `ROUND ${Object.values(roomState.scores).reduce((a,b)=>a+b, 0) + 1}`;
}

// Dynamically render all connected player columns, tags, and win gems inside centered Tab Scoreboard
function renderHUDPlayers(roomState) {
  const listContainer = document.getElementById('scoreboard-players-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const playerIds = Object.keys(roomState.players);
  const targetWins = Math.ceil((roomState.bestOf || 3) / 2);

  playerIds.forEach((id) => {
    const p = roomState.players[id];
    const score = roomState.scores[id] || 0;
    const isLocal = id === myId;
    const isHost = id === roomState.hostId;
    const isDead = p.isDead;

    const row = document.createElement('div');
    row.className = 'scoreboard-row';
    if (isLocal) row.classList.add('scoreboard-row-local');
    if (isDead) row.classList.add('scoreboard-row-dead');

    // Generate score gems
    let gemsHTML = '';
    for (let i = 0; i < targetWins; i++) {
      if (i < score) {
        gemsHTML += `<span class="gem won" style="background-color: ${p.color}; border-color: ${p.color}; box-shadow: 0 0 8px ${p.color};"></span>`;
      } else {
        gemsHTML += `<span class="gem"></span>`;
      }
    }

    const badgeHTML = isDead 
      ? `<span class="status-badge deceased glow-text-pink" style="color: #ff0055; text-shadow: 0 0 4px #ff005560; border: 1px solid rgba(255, 0, 85, 0.3);">DECEASED</span>` 
      : `<span class="status-badge alive glow-text-green" style="color: #00ff66; text-shadow: 0 0 4px #00ff6660; border: 1px solid rgba(0, 255, 102, 0.3);">ALIVE</span>`;

    const identityHTML = `${isLocal ? ' <span class="tag-you">[YOU]</span>' : ''}${isHost ? ' <span class="tag-host">[HOST]</span>' : ''}`;

    row.innerHTML = `
      <div class="row-left">
        <span class="color-dot" style="background-color: ${p.color}; box-shadow: 0 0 8px ${p.color};"></span>
        <span class="username" style="color: ${p.color}; text-shadow: 0 0 4px ${p.color}40; font-weight: bold;">${p.username.toUpperCase()}${identityHTML}</span>
      </div>
      <div class="row-right">
        <div class="score-gems" style="display: flex; gap: 6px;">${gemsHTML}</div>
        <div class="status-wrap">${badgeHTML}</div>
      </div>
    `;
    listContainer.appendChild(row);
  });
}

// Live Combat Action Feeds
socket.on('effect', (data) => {
  if (!isPhaserInitialized || !window.gameScene) return;

  const scene = window.gameScene;

  switch (data.type) {
    case 'slash_trigger':
      scene.triggerSwordSlash(data.playerId, data.angle);
      // Play swipe sound FX
      CyberSynth.playSlash();
      break;

    case 'dash':
      scene.triggerDashEffect(data.playerId);
      CyberSynth.playDash();
      break;

    case 'parry':
      scene.triggerParryShield(data.playerId);
      break;

    case 'parry_success':
      scene.triggerParryImpact(data.x, data.y, data.parryId, data.victimId);
      CyberSynth.playParry();
      break;

    case 'kill_strike':
      scene.triggerKillStrike(data.x, data.y, data.killerId, data.victimId);
      CyberSynth.playHit();
      break;

    case 'speed_boost':
      scene.triggerSpeedBoostEffect(data.playerId);
      CyberSynth.playSpeedBoost();
      break;

    case 'teleport':
      scene.triggerTeleportEffect(data.playerId, data.fromX, data.fromY, data.toX, data.toY);
      CyberSynth.playTeleport();
      break;

    case 'shield_activate':
      scene.triggerShieldActivate(data.playerId);
      CyberSynth.playShieldPickup();
      logToKillfeed(`${currentLobbyState.players[data.playerId].username} DEPLOYED DEFENSIVE SHIELD BUBBLE!`);
      break;

    case 'shield_pop':
      scene.triggerShieldPop(data.playerId, data.x, data.y);
      CyberSynth.playShieldPop();
      logToKillfeed(`${currentLobbyState.players[data.playerId].username}'S SHIELD SHATTERED!`);
      break;
  }
});

// Capture Storm warning indicators
socket.on('stormWarning', (seconds) => {
  if (seconds % 5 === 0 || seconds <= 5) {
    logToKillfeed(`STORM CONVERGING IN ${seconds} SECONDS!`);
  }
  if (window.gameScene) {
    window.gameScene.showStormWarningBanner(seconds);
  }
});

// Capture Round Over Results
socket.on('roundOver', (roomState) => {
  renderHUDPlayers(roomState);

  // Show floating text inside game scene
  if (window.gameScene) {
    window.gameScene.showRoundResolutionText(roomState.endReason);
  }

  // Log in temporary killfeed
  logToKillfeed(roomState.endReason);

  // Populate and present the interim Round Scoreboard Table Overlay
  const resolvedOverlay = document.getElementById('hud-round-resolved-overlay');
  const resolvedTitle = document.getElementById('round-resolved-title');
  const resolvedWinner = document.getElementById('round-resolved-winner');
  const tableBody = document.getElementById('round-resolved-table-body');
  
  if (resolvedOverlay && tableBody) {
    const roundNum = Object.values(roomState.scores).reduce((a, b) => a + b, 0);
    resolvedTitle.innerText = `// ROUND ${roundNum} COMPLETED //`;
    
    const winnerId = roomState.roundWinner;
    const winner = roomState.players[winnerId];
    if (winner) {
      resolvedWinner.innerText = `ROUND WINNER: ${winner.username.toUpperCase()}`;
      resolvedWinner.style.color = winner.color;
      resolvedWinner.style.textShadow = `0 0 6px ${winner.color}80`;
    } else {
      resolvedWinner.innerText = `ROUND RESOLVED: DRAW`;
      resolvedWinner.style.color = '#fffb00';
      resolvedWinner.style.textShadow = `0 0 6px #fffb0080`;
    }
    
    // Sort players by score descending
    tableBody.innerHTML = '';
    const playerIds = Object.keys(roomState.players);
    const sortedPlayers = playerIds.map(id => ({
      id,
      username: roomState.players[id] ? roomState.players[id].username : 'Unknown',
      color: roomState.players[id] ? roomState.players[id].color : '#ffffff',
      score: roomState.scores[id] || 0
    })).sort((a, b) => b.score - a.score);
    
    const targetWins = Math.ceil((roomState.bestOf || 3) / 2);
    
    sortedPlayers.forEach(p => {
      const row = document.createElement('div');
      row.className = 'round-table-row';
      row.style.borderLeft = `4px solid ${p.color}`;
      const isLocal = p.id === myId;
      
      // Gems
      let gemsHTML = '';
      for (let i = 0; i < targetWins; i++) {
        if (i < p.score) {
          gemsHTML += `<span class="gem won" style="background-color: ${p.color}; border-color: ${p.color}; box-shadow: 0 0 4px ${p.color};"></span>`;
        } else {
          gemsHTML += `<span class="gem"></span>`;
        }
      }
      
      row.innerHTML = `
        <div class="row-left">
          <span class="color-indicator" style="background-color: ${p.color}; box-shadow: 0 0 4px ${p.color};"></span>
          <span class="username" style="color: #ffffff; font-weight: bold; text-shadow: 0 0 1px rgba(255,255,255,0.2);">${p.username.toUpperCase()}${isLocal ? ' <span class="tag-you">[YOU]</span>' : ''}</span>
        </div>
        <div class="row-right">
          <span class="points-value" style="color: ${p.color}; font-weight: 900; letter-spacing: 1px;">${p.score} PTS</span>
          <div class="score-gems">${gemsHTML}</div>
        </div>
      `;
      tableBody.appendChild(row);
    });
    
    resolvedOverlay.classList.remove('hidden');
    resolvedOverlay.classList.add('active');
  }
});

// Render Killfeed items dynamically
function logToKillfeed(text) {
  const item = document.createElement('div');
  item.className = 'killfeed-item';
  item.innerHTML = `<span>⚡ SYSTEM LOG:</span><span>${text.toUpperCase()}</span>`;
  hudKillfeed.appendChild(item);

  // Auto clean killfeed elements
  setTimeout(() => {
    item.remove();
  }, 4500);
}

// Display Game Over Modal
function showResultsScreen(roomState) {
  const playerIds = Object.keys(roomState.players);
  const winId = roomState.matchWinner;
  const winner = roomState.players[winId];
  const winnerName = winner ? winner.username : 'UNKNOWN COMBATANT';

  const resultsWinnerText = document.getElementById('results-winner-text');

  if (resultsWinnerText) {
    resultsWinnerText.innerText = `${winnerName} WINS THE DUEL`;
    if (winId === myId) {
      resultsWinnerText.className = 'results-winner glow-text-cyan';
    } else {
      resultsWinnerText.className = 'results-winner glow-text-pink';
    }
  }

  // Dynamically populate all players' scores in results stats container
  const resultsStats = document.querySelector('.results-stats');
  if (resultsStats) {
    resultsStats.innerHTML = '';
    
    // Sort players by score (wins) descending
    const sortedPlayers = playerIds.map(id => ({
      id,
      username: roomState.players[id] ? roomState.players[id].username : 'Unknown',
      color: roomState.players[id] ? roomState.players[id].color : '#ffffff',
      score: roomState.scores[id] || 0
    })).sort((a, b) => b.score - a.score);
    
    sortedPlayers.forEach(p => {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `
        <span class="stat-label" style="color: ${p.color}; text-shadow: 0 0 6px ${p.color}60;">${p.username.toUpperCase()}</span>
        <span class="stat-value" style="color: ${p.color};">${p.score} WINS</span>
      `;
      resultsStats.appendChild(row);
    });
    
    // Add outcome row at the bottom
    const outcomeRow = document.createElement('div');
    outcomeRow.className = 'stat-row';
    outcomeRow.style.marginTop = '12px';
    outcomeRow.style.borderTop = '1px dashed rgba(255, 255, 255, 0.15)';
    outcomeRow.style.paddingTop = '8px';
    
    const outcomeLabel = document.createElement('span');
    outcomeLabel.className = 'stat-label';
    outcomeLabel.innerText = 'COMBAT OUTCOME';
    
    const outcomeVal = document.createElement('span');
    outcomeVal.id = 'results-outcome-text';
    if (winId === myId) {
      outcomeVal.innerText = 'DUEL SECURED // NET CREDIT ACQUIRED';
      outcomeVal.className = 'stat-value text-green';
    } else {
      outcomeVal.innerText = 'DUEL TERMINATED // SYNAPSE FLATLINED';
      outcomeVal.className = 'stat-value glow-text-pink';
    }
    
    outcomeRow.appendChild(outcomeLabel);
    outcomeRow.appendChild(outcomeVal);
    resultsStats.appendChild(outcomeRow);
  }

  // Restore rematch button state
  if (rematchBtn) {
    rematchBtn.disabled = false;
    rematchBtn.querySelector('.btn-text').innerText = 'INITIATE REMATCH';
  }

  showScreen(screens.results);
}

// Synchronize continuous 60FPS physics positions
socket.on('sync', (players) => {
  if (isPhaserInitialized && window.gameScene) {
    window.gameScene.updateServerSync(players);
  }
});

// Synchronize continuous storm safe zone radius
socket.on('stormSync', (radius) => {
  if (currentLobbyState) {
    currentLobbyState.safeZoneRadius = radius;
  }
});

// Cooldown HUD Updater (Radial SVG progress)
function updateCooldownHUD(dashPct, attackPct, shieldPct) {
  // SVG circles take dasharray: e.g. "90, 100" representing percentage
  cooldownDashRing.style.strokeDasharray = `${dashPct * 100}, 100`;
  cooldownAttackRing.style.strokeDasharray = `${attackPct * 100}, 100`;
  cooldownShieldRing.style.strokeDasharray = `${shieldPct * 100}, 100`;
}

// Tab Key Leaderboard Overlay & Enter Key Chat Interceptors
window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const scoreboard = document.getElementById('hud-scoreboard-overlay');
    if (scoreboard) {
      scoreboard.classList.remove('hidden');
      scoreboard.classList.add('active');
    }
  }

  if (e.key === 'Enter') {
    const isGameActive = screens.game.classList.contains('active');
    if (isGameActive) {
      const chatInput = document.getElementById('hud-chat-input');
      const chatInputWrapper = document.getElementById('hud-chat-input-wrapper');
      if (chatInput && chatInputWrapper) {
        if (chatInputWrapper.classList.contains('hidden')) {
          e.preventDefault();
          chatInputWrapper.classList.remove('hidden');
          chatInput.focus();
          
          // Re-reveal all faded out messages
          const fadedMsgs = document.querySelectorAll('.hud-chat-messages .chat-message');
          fadedMsgs.forEach(m => m.classList.remove('fade-out'));
        }
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const scoreboard = document.getElementById('hud-scoreboard-overlay');
    if (scoreboard) {
      scoreboard.classList.add('hidden');
      scoreboard.classList.remove('active');
    }
  }
});
