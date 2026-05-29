/**
 * 1HP Main Client Phaser 3 Engine Scene
 * Implements client-side movement prediction, server reconciliation, interpolation,
 * and high-fidelity cyberpunk visual effects (trails, shields, shakes, sparks).
 */

const BASE_SPEED = 280;

class GameDuelScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameDuelScene' });
    this.players = {}; // Local representation of players
    this.serverPlayers = {}; // Authority coordinates received from server
    this.localPlayerId = null;
    this.keys = null;
    
    // Cooldown trackers (ms)
    this.dashCooldown = 0;
    this.attackCooldown = 0;
    this.shieldCooldown = 0;
    this.dashMaxCooldown = 1200;
    this.attackMaxCooldown = 600;
    this.shieldMaxCooldown = 10000;
    
    // Slash geometries
    this.slashGraphics = {};
    
    // Track active particle emitters for clean round resets
    this.activeEmitters = [];
  }

  init(data) {
    this.localPlayerId = myId;
    this.serverPlayers = {};
  }

  preload() {
    // Programmatically generate beautiful neon circular textures
    this.createNeonTextures();
  }

  create() {
    // Setup Arena sizing coordinates (authoritative boundaries)
    this.mapWidth = 3600;
    this.mapHeight = 2700;

    // Set map boundaries and center camera
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
    this.cameras.main.setBackgroundColor('#07050f');

    // Create safe zone graphics layer
    this.safeZoneGraphics = this.add.graphics();

    // Draw cyberpunk neon grid pattern
    this.drawNeonArena();

    // Create dedicated minimap layers for tactical storm & obstacles rendering
    this.minimapStaticGraphics = this.add.graphics();
    this.minimapGraphics = this.add.graphics();
    
    // Instruct main camera to completely ignore these minimap-only layers
    this.cameras.main.ignore([this.minimapStaticGraphics, this.minimapGraphics]);

    // Draw static tactical representations of pillars and portals for the minimap radar
    this.minimapStaticGraphics.fillStyle(0x130f26, 0.95);
    
    // Central Pillar (Large Cross-Hatched Obstacle)
    this.minimapStaticGraphics.lineStyle(30, 0x00f0ff, 0.9);
    this.minimapStaticGraphics.strokeCircle(1800, 1350, 100);
    this.minimapStaticGraphics.fillCircle(1800, 1350, 100);
    this.minimapStaticGraphics.lineStyle(15, 0x00f0ff, 0.45);
    this.minimapStaticGraphics.lineBetween(1800 - 70, 1350 - 70, 1800 + 70, 1350 + 70);
    this.minimapStaticGraphics.lineBetween(1800 - 70, 1350 + 70, 1800 + 70, 1350 - 70);
    
    // Four Mini Pillars
    const miniPillars = [
      { x: 900, y: 600 },
      { x: 900, y: 2100 },
      { x: 2700, y: 600 },
      { x: 2700, y: 2100 }
    ];
    miniPillars.forEach(p => {
      this.minimapStaticGraphics.lineStyle(20, 0x00f0ff, 0.9);
      this.minimapStaticGraphics.strokeCircle(p.x, p.y, 32);
      this.minimapStaticGraphics.fillCircle(p.x, p.y, 32);
      this.minimapStaticGraphics.lineStyle(10, 0x00f0ff, 0.45);
      this.minimapStaticGraphics.lineBetween(p.x - 22, p.y - 22, p.x + 22, p.y + 22);
      this.minimapStaticGraphics.lineBetween(p.x - 22, p.y + 22, p.x + 22, p.y - 22);
    });

    // Warp Portals Pair A (Purple Hollow Tactical Squares)
    const portalsA = [
      { x: 600, y: 2100 },
      { x: 3000, y: 600 }
    ];
    portalsA.forEach(p => {
      this.minimapStaticGraphics.lineStyle(25, 0xb026ff, 0.9); // Purple outer square stroke
      this.minimapStaticGraphics.strokeRect(p.x - 70, p.y - 70, 140, 140);
      this.minimapStaticGraphics.lineStyle(10, 0xffffff, 0.8);  // White inner highlight
      this.minimapStaticGraphics.strokeRect(p.x - 50, p.y - 50, 100, 100);
      this.minimapStaticGraphics.lineStyle(12, 0xb026ff, 0.8);
      this.minimapStaticGraphics.lineBetween(p.x - 30, p.y, p.x + 30, p.y);
      this.minimapStaticGraphics.lineBetween(p.x, p.y - 30, p.x, p.y + 30);
    });

    // Warp Portals Pair B (Orange Hollow Tactical Squares)
    const portalsB = [
      { x: 600, y: 600 },
      { x: 3000, y: 2100 }
    ];
    portalsB.forEach(p => {
      this.minimapStaticGraphics.lineStyle(25, 0xffaa00, 0.9); // Orange outer square stroke
      this.minimapStaticGraphics.strokeRect(p.x - 70, p.y - 70, 140, 140);
      this.minimapStaticGraphics.lineStyle(10, 0xffffff, 0.8);  // White inner highlight
      this.minimapStaticGraphics.strokeRect(p.x - 50, p.y - 50, 100, 100);
      this.minimapStaticGraphics.lineStyle(12, 0xffaa00, 0.8);
      this.minimapStaticGraphics.lineBetween(p.x - 30, p.y, p.x + 30, p.y);
      this.minimapStaticGraphics.lineBetween(p.x, p.y - 30, p.x, p.y + 30);
    });

    // 1. Create a dedicated static minimap camera in bottom-right corner
    this.minimapCamera = this.cameras.add(800, 645, 180, 135);
    this.minimapCamera.setZoom(180 / 3600); // Set zoom first to ensure centerOn calculates correctly (0.05)
    this.minimapCamera.centerOn(1800, 1350); // Center the camera perfectly on the map center
    this.minimapCamera.setBackgroundColor('rgba(7, 5, 15, 0.95)');

    // 2. Draw a clean, screen-locked neon border around the minimap viewport
    const minimapBorder = this.add.graphics();
    minimapBorder.lineStyle(2, 0x00f0ff, 0.8);
    minimapBorder.strokeRect(800, 645, 180, 135);
    minimapBorder.setScrollFactor(0); // Pin it statically to screen viewport!
    minimapBorder.setDepth(10);

    // Input listeners (WASD movement, Dash, Slash, Parry, Shield)
    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
      Q: Phaser.Input.Keyboard.KeyCodes.Q,
      CTRL: Phaser.Input.Keyboard.KeyCodes.CTRL
    });

    // Disable default browser context menu for Right Click parry
    this.input.mouse.disableContextMenu();

    // Setup input trigger checks (Left Click = Shield)
    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown()) {
        this.localShieldTriggered = true;
      }
    });

    // Setup central display texts (Round status, countdown overlays)
    this.centerText = this.add.text(500, 400, '', {
      fontFamily: 'Orbitron',
      fontSize: '4.5rem',
      fontWeight: 'bold',
      color: '#fffb00',
      align: 'center'
    }).setOrigin(0.5).setShadow(0, 0, 15, '#fffb00', true);

    this.roundEndText = this.add.text(500, 300, '', {
      fontFamily: 'Orbitron',
      fontSize: '1.8rem',
      fontWeight: 'bold',
      color: '#ff0055',
      align: 'center',
      wordWrap: { width: 800 }
    }).setOrigin(0.5).setShadow(0, 0, 10, '#ff0055', true);

    // Tell Minimap Camera to ignore the screen-locked border, text overlays, and main viewport cluttered graphics
    this.minimapCamera.ignore([this.centerText, this.roundEndText, minimapBorder, this.safeZoneGraphics, this.arenaGraphics]);

    // Ensure local ID is resolved immediately on boot-up
    this.localPlayerId = myId || (socket ? socket.id : null);

    // Immediately spawn players if initial positions exist globally on boot-up
    if (window.initialPlayersMap) {
      this.serverPlayers = window.initialPlayersMap;
      Object.keys(window.initialPlayersMap).forEach(id => {
        const sp = window.initialPlayersMap[id];
        this.createPlayerInstance(id, sp);
        if (id === this.localPlayerId) {
          this.cameras.main.startFollow(this.players[id].container, true, 0.1, 0.1);
        }
      });
    }

    // Expose scene to window for client.js bindings
    window.gameScene = this;
  }

  // Pre-generate geometric sprite shapes dynamically to maintain zero audio-visual files load
  createNeonTextures() {
    // 1. Neon spark particle texture
    const sparkCanvas = this.textures.createCanvas('spark', 8, 8);
    const ctx = sparkCanvas.context;
    const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#00ffff');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 8);
    sparkCanvas.refresh();

    // 2. Dash trail ghost block texture
    const ghostCanvas = this.textures.createCanvas('ghost', 48, 48);
    const gCtx = ghostCanvas.context;
    gCtx.strokeStyle = '#00f0ff';
    gCtx.lineWidth = 3;
    gCtx.arc(24, 24, 21, 0, Math.PI * 2);
    gCtx.stroke();
    ghostCanvas.refresh();

    // 3. Neon yellow shield pickup texture (Glowing Diamond)
    const shieldCanvas = this.textures.createCanvas('shield_drop', 28, 28);
    const sCtx = shieldCanvas.context;
    sCtx.strokeStyle = '#fffb00';
    sCtx.lineWidth = 3;
    sCtx.beginPath();
    sCtx.moveTo(14, 2);
    sCtx.lineTo(26, 14);
    sCtx.lineTo(14, 26);
    sCtx.lineTo(2, 14);
    sCtx.closePath();
    sCtx.stroke();
    shieldCanvas.refresh();
  }

  // Visual layout for arena grids, bounding boxes, and central obstacle structures
  drawNeonArena() {
    this.arenaGraphics = this.add.graphics();
    const graphics = this.arenaGraphics;

    // Draw Grid Lines - Premium Cyberpunk Faint Cyan Grid
    graphics.lineStyle(1.5, 0x00f0ff, 0.08);
    const gridSize = 40;
    for (let x = 0; x < this.mapWidth; x += gridSize) {
      graphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += gridSize) {
      graphics.lineBetween(0, y, this.mapWidth, y);
    }

    // Draw glowing boundaries
    graphics.lineStyle(4, '#ff0055', 0.85);
    graphics.strokeRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Central Obstacle Pillars for combat shield strategy
    graphics.lineStyle(2, '#00f0ff', 0.8);
    graphics.fillStyle('#0a0813', 0.9);
    
    // Central Pillar re-centered
    graphics.strokeCircle(this.mapWidth / 2, this.mapHeight / 2, 100);
    graphics.fillCircle(this.mapWidth / 2, this.mapHeight / 2, 100);
    
    // Mini Pillars re-centered
    graphics.strokeCircle(900, 600, 32);
    graphics.fillCircle(900, 600, 32);
    graphics.strokeCircle(900, 2100, 32);
    graphics.fillCircle(900, 2100, 32);
    graphics.strokeCircle(2700, 600, 32);
    graphics.fillCircle(2700, 600, 32);
    graphics.strokeCircle(2700, 2100, 32);
    graphics.fillCircle(2700, 2100, 32);

    // Dynamic Warp Portals (Concentric glowing rings)
    graphics.lineStyle(3, 0xb026ff, 0.9); // Purple Portal A1
    graphics.strokeCircle(600, 2100, 26);
    graphics.lineStyle(1.5, 0xb026ff, 0.4);
    graphics.strokeCircle(600, 2100, 34);
    graphics.strokeCircle(600, 2100, 14);
    
    graphics.lineStyle(3, 0xb026ff, 0.9); // Purple Portal A2
    graphics.strokeCircle(3000, 600, 26);
    graphics.lineStyle(1.5, 0xb026ff, 0.4);
    graphics.strokeCircle(3000, 600, 34);
    graphics.strokeCircle(3000, 600, 14);

    graphics.lineStyle(3, 0xffaa00, 0.9); // Orange Portal B1
    graphics.strokeCircle(600, 600, 26);
    graphics.lineStyle(1.5, 0xffaa00, 0.4);
    graphics.strokeCircle(600, 600, 34);
    graphics.strokeCircle(600, 600, 14);

    graphics.lineStyle(3, 0xffaa00, 0.9); // Orange Portal B2
    graphics.strokeCircle(3000, 2100, 26);
    graphics.lineStyle(1.5, 0xffaa00, 0.4);
    graphics.strokeCircle(3000, 2100, 34);
    graphics.strokeCircle(3000, 2100, 14);

    // Labels for gameplay cues
    this.add.text(600, 2150, 'WARP-A', { fontFamily: 'Orbitron', fontSize: '0.75rem', color: '#b026ff', fontWeight: 'bold' }).setOrigin(0.5);
    this.add.text(3000, 550, 'WARP-A', { fontFamily: 'Orbitron', fontSize: '0.75rem', color: '#b026ff', fontWeight: 'bold' }).setOrigin(0.5);
    this.add.text(600, 550, 'WARP-B', { fontFamily: 'Orbitron', fontSize: '0.75rem', color: '#ffaa00', fontWeight: 'bold' }).setOrigin(0.5);
    this.add.text(3000, 2150, 'WARP-B', { fontFamily: 'Orbitron', fontSize: '0.75rem', color: '#ffaa00', fontWeight: 'bold' }).setOrigin(0.5);

    // Apply depth
    graphics.setDepth(0);
  }

  // Create a brand new local player visual instance
  createPlayerInstance(id, serverData) {
    const isLocal = id === this.localPlayerId;
    const hexColorString = serverData.color || (isLocal ? '#00f0ff' : '#ff0055');
    const colorTheme = parseInt(hexColorString.replace('#', '0x'), 16);

    // Container for holding sprite shapes
    const container = this.add.container(serverData.x, serverData.y);

    // 0. Giant glowing radar blip for the minimap (ignored by main camera, shown only on minimap)
    const blipG = this.add.graphics();
    blipG.fillStyle(colorTheme, 1.0);
    blipG.fillCircle(0, 0, 100); 
    blipG.lineStyle(20, colorTheme, 0.35);
    blipG.strokeCircle(0, 0, 110);
    container.add(blipG);
    this.cameras.main.ignore(blipG);
    
    // 1. Draw glowing neon ring
    const bodyG = this.add.graphics();
    bodyG.lineStyle(3, colorTheme, 1);
    bodyG.fillStyle(0x07050f, 0.9);
    bodyG.strokeCircle(0, 0, 21);
    bodyG.fillCircle(0, 0, 21);
    container.add(bodyG);

    // 2. Aim pointer arrowhead
    const arrowG = this.add.graphics();
    arrowG.fillStyle(colorTheme, 1);
    arrowG.fillTriangle(18, 0, 26, -5, 26, 5);
    container.add(arrowG);

    // 3. Username Label overlay (safely resolved)
    const displayName = (serverData.username || 'Player').toUpperCase();
    const nameText = this.add.text(0, -38, displayName, {
      fontFamily: 'Orbitron',
      fontSize: '0.65rem',
      fontWeight: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setShadow(0, 0, 4, hexColorString, true);
    container.add(nameText);

    // Hide usernames on the tiny minimap view for clean blips
    if (this.minimapCamera) {
      this.minimapCamera.ignore(nameText);
    }

    // 4. Parry Energy Shield Bubble (hidden by default)
    const shieldG = this.add.graphics();
    shieldG.lineStyle(4, colorTheme, 1);
    shieldG.strokeCircle(0, 0, 32);
    // Draw hex lattice patterns on parry bubble
    shieldG.lineStyle(1, colorTheme, 0.4);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 3) {
      shieldG.lineBetween(
        Math.cos(angle) * 21, Math.sin(angle) * 21,
        Math.cos(angle) * 32, Math.sin(angle) * 32
      );
    }
    shieldG.setVisible(false);
    container.add(shieldG);

    // 5. Slash graphic utility
    const slashG = this.add.graphics();
    slashG.setVisible(false);
    container.add(slashG);

    // 6. Yellow Passive Shield bubble (hidden by default, shown when hasShield is true)
    const passiveShieldG = this.add.graphics();
    passiveShieldG.lineStyle(3, 0xfffb00, 0.95);
    passiveShieldG.strokeCircle(0, 0, 36);
    passiveShieldG.lineStyle(1.5, 0xfffb00, 0.4);
    passiveShieldG.strokeCircle(0, 0, 42);
    // Draw lattice connectors
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      passiveShieldG.lineBetween(
        Math.cos(angle) * 36, Math.sin(angle) * 36,
        Math.cos(angle) * 42, Math.sin(angle) * 42
      );
    }
    passiveShieldG.setVisible(false);
    container.add(passiveShieldG);

    // Hide small cluttered player details on the minimap camera
    if (this.minimapCamera) {
      this.minimapCamera.ignore([bodyG, arrowG, shieldG, slashG, passiveShieldG]);
    }

    // Store references
    this.players[id] = {
      container,
      body: bodyG,
      arrow: arrowG,
      shield: shieldG,
      slash: slashG,
      passiveShield: passiveShieldG,
      color: colorTheme,
      hex: hexColorString,
      isDashing: false,
      isDead: false
    };
  }

  // Perform smooth reset and spawn coordinate alignment at countdown
  resetRound(playerIds, initialPlayers) {
    // Ensure local ID is resolved immediately on round reset
    this.localPlayerId = myId || (socket ? socket.id : null);

    this.centerText.setText('');
    this.roundEndText.setText('');

    // Clear old visual objects
    Object.keys(this.players).forEach(id => {
      this.players[id].container.destroy();
    });
    this.players = {};
    
    // Clear any active trail tweens
    this.tweens.killAll();

    // Destroy all active particle emitters to avoid blood/sparks lingering
    if (this.activeEmitters) {
      this.activeEmitters.forEach(e => {
        if (e && e.destroy) e.destroy();
      });
      this.activeEmitters = [];
    }

    // Reset local inputs
    this.localShieldTriggered = false;

    // Immediately spawn players for the countdown!
    const spawnData = initialPlayers || window.initialPlayersMap;
    if (spawnData) {
      this.serverPlayers = spawnData;
      Object.keys(spawnData).forEach(id => {
        const sp = spawnData[id];
        this.createPlayerInstance(id, sp);
        
        // Let camera follow local player visual container
        if (id === this.localPlayerId) {
          this.cameras.main.startFollow(this.players[id].container, true, 0.1, 0.1);
        }
      });
    }
  }

  // Receive server authority states
  updateServerSync(serverPlayersList) {
    // Robust connection fallback to retrieve active ID
    if (!this.localPlayerId) {
      this.localPlayerId = myId || (socket ? socket.id : null);
    }
    this.serverPlayers = serverPlayersList;

    // Remove disconnected players
    Object.keys(this.players).forEach(id => {
      if (!this.serverPlayers[id]) {
        this.players[id].container.destroy();
        delete this.players[id];
      }
    });

    // Create or align states
    Object.keys(this.serverPlayers).forEach(id => {
      const sp = this.serverPlayers[id];
      if (!this.players[id]) {
        this.createPlayerInstance(id, sp);
        
        // Let camera follow local player visual container on larger map
        if (id === this.localPlayerId) {
          this.cameras.main.startFollow(this.players[id].container, true, 0.1, 0.1);
        }
      }
      
      const lp = this.players[id];
      if (!lp) return;
      
      // Update death states
      if (sp.isDead && !lp.isDead) {
        lp.isDead = true;
        lp.container.setVisible(false);
      }

      // Sync passive shields (yellow bubble protective wrap)
      if (lp.passiveShield) {
        lp.passiveShield.setVisible(sp.hasShield === true);
      }

      // Sync active state toggles (dashing, parrying)
      if (id !== this.localPlayerId) {
        lp.container.setAlpha(sp.isDashing ? 0.5 : 1.0);
      }
    });

    // Camera follow verification & fallback to keep camera centered
    if (!this.cameras.main._follow) {
      if (this.players[this.localPlayerId]) {
        this.cameras.main.startFollow(this.players[this.localPlayerId].container, true, 0.1, 0.1);
      } else {
        const firstId = Object.keys(this.players)[0];
        if (firstId && this.players[firstId]) {
          this.cameras.main.startFollow(this.players[firstId].container, true, 0.1, 0.1);
        }
      }
    }
  }

  // Main frame loop (predicts local movement, interpolates opponents, updates visual cooldown elements)
  update(time, delta) {
    const dt = delta / 1000;
    
    // 1. Process client predictions
    if (this.players[this.localPlayerId] && !this.players[this.localPlayerId].isDead) {
      const lp = this.players[this.localPlayerId];
      const sp = this.serverPlayers[this.localPlayerId];

      // Reduce cooldown timers
      if (this.dashCooldown > 0) this.dashCooldown -= delta;
      if (this.attackCooldown > 0) this.attackCooldown -= delta;
      if (this.shieldCooldown > 0) this.shieldCooldown -= delta;
      
      // Calculate Cooldown percentages for client HUD rings
      const dashPct = 1 - Math.max(0, this.dashCooldown) / this.dashMaxCooldown;
      const attackPct = 1 - Math.max(0, this.attackCooldown) / this.attackMaxCooldown;
      const shieldPct = 1 - Math.max(0, this.shieldCooldown) / this.shieldMaxCooldown;
      updateCooldownHUD(dashPct, attackPct, shieldPct);

      let moveX = 0;
      let moveY = 0;

      const isPlaying = currentLobbyState && currentLobbyState.state === 'PLAYING';
      const isChatting = document.activeElement && document.activeElement.tagName === 'INPUT';

      if (isPlaying && !isChatting) {
        if (this.keys.W.isDown) moveY -= 1;
        if (this.keys.S.isDown) moveY += 1;
        if (this.keys.A.isDown) moveX -= 1;
        if (this.keys.D.isDown) moveX += 1;
      }

      // Handle Shield Ability trigger (Left Click)
      let isShieldActivatedThisFrame = false;
      if (!isChatting && this.localShieldTriggered && this.shieldCooldown <= 0 && (!sp || !sp.isDead) && !lp.isDead) {
        this.shieldCooldown = this.shieldMaxCooldown;
        isShieldActivatedThisFrame = true;
        this.localShieldTriggered = false;
      } else if (isChatting) {
        this.localShieldTriggered = false;
      }

      // Handle Dash triggers
      let isDashingThisFrame = false;
      if (!isChatting && Phaser.Input.Keyboard.JustDown(this.keys.SHIFT) && this.dashCooldown <= 0) {
        this.dashCooldown = this.dashMaxCooldown;
        isDashingThisFrame = true;
        lp.isDashing = true;
        this.time.delayedCall(150, () => { lp.isDashing = false; });
      }

      // Handle Attack triggers (Spacebar)
      let isAttackingThisFrame = false;
      if (!isChatting && Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.attackCooldown <= 0 && !lp.isDashing && (!sp || !sp.isAttacking)) {
        this.attackCooldown = this.attackMaxCooldown;
        isAttackingThisFrame = true;
      }

      // Determine movement velocities for client local simulation
      let speed = BASE_SPEED;
      if (lp.isDashing) {
        speed = 900;
      }

      // Interpolate local coordinates to server authority if drift exceeds margin
      if (sp) {
        const drift = Phaser.Math.Distance.Between(lp.container.x, lp.container.y, sp.x, sp.y);
        if (drift > 24) {
          // Slide smoothly back to server authority
          lp.container.x = Phaser.Math.Linear(lp.container.x, sp.x, 0.25);
          lp.container.y = Phaser.Math.Linear(lp.container.y, sp.y, 0.25);
        } else {
          // Run clean local movement prediction
          if (moveX !== 0 || moveY !== 0) {
            const len = Math.sqrt(moveX * moveX + moveY * moveY);
            lp.container.x += (moveX / len) * speed * dt;
            lp.container.y += (moveY / len) * speed * dt;
          } else if (lp.isDashing && sp.dashDirX !== undefined) {
            lp.container.x += sp.dashDirX * speed * dt;
            lp.container.y += sp.dashDirY * speed * dt;
          }
        }
      } else {
        // Fallback local prediction if server state hasn't arrived yet
        if (moveX !== 0 || moveY !== 0) {
          const len = Math.sqrt(moveX * moveX + moveY * moveY);
          lp.container.x += (moveX / len) * speed * dt;
          lp.container.y += (moveY / len) * speed * dt;
        }
      }
      // Clamp inside arena walls locally
      lp.container.x = Phaser.Math.Clamp(lp.container.x, 24, this.mapWidth - 24);
      lp.container.y = Phaser.Math.Clamp(lp.container.y, 24, this.mapHeight - 24);

      // Get mouse targeting angle relative to player world coordinates
      const pointer = this.input.activePointer;
      const angle = Phaser.Math.Angle.Between(lp.container.x, lp.container.y, pointer.worldX, pointer.worldY);
      lp.arrow.setRotation(angle);

      // Emit inputs back to backend loop
      socket.emit('input', {
        w: this.keys.W.isDown,
        a: this.keys.A.isDown,
        s: this.keys.S.isDown,
        d: this.keys.D.isDown,
        dash: isDashingThisFrame,
        attack: isAttackingThisFrame,
        shield: isShieldActivatedThisFrame,
        angle: angle
      });

      // Local dash trails
      if (lp.isDashing && time % 3 === 0) {
        this.spawnGhostTrail(lp.container.x, lp.container.y, angle, lp.color);
      }
    }

    // Render Collapsing Safe Zone boundary ring
    this.safeZoneGraphics.clear();
    if (currentLobbyState && currentLobbyState.safeZoneRadius !== undefined) {
      const radius = currentLobbyState.safeZoneRadius;
      const centerX = 1800;
      const centerY = 1350;

      // 1. Draw perfectly circular danger zone shader using a thick stroke (no corner gaps or height glitches!)
      this.safeZoneGraphics.lineStyle(3000, 0xff0055, 0.22); // 3000px thick outer shade
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius + 1500); // inner edge is exactly at 'radius'

      // 2. Draw glowing storm deadzone boundary with a stunning multi-layered neon glow
      this.safeZoneGraphics.lineStyle(24, 0xff0055, 0.3); // Broad outer glow
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius);
      this.safeZoneGraphics.lineStyle(12, 0xff0055, 0.7); // Vibrant mid-glow
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius);
      this.safeZoneGraphics.lineStyle(4, 0xffffff, 1.0);  // High-intensity white laser core
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius);

      // Draw faint boundary shadow rings
      this.safeZoneGraphics.lineStyle(2, 0xff0055, 0.4);
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius + 12);
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius - 12);

      // 3. Draw beautiful concentric tactical warning radar rings outside the safe zone (GPU-safe!)
      this.safeZoneGraphics.lineStyle(3, 0xff0055, 0.25);
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius + 120);
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius + 240);
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius + 360);
      this.safeZoneGraphics.strokeCircle(centerX, centerY, radius + 480);

      // 4. Draw a highly visible tactical glowing storm ring specifically for the zoomed-out minimap radar
      this.minimapGraphics.clear();
      // Draw perfectly circular danger zone shader on the minimap
      this.minimapGraphics.lineStyle(3000, 0xff0055, 0.15); // 3000px thick outer shade
      this.minimapGraphics.strokeCircle(centerX, centerY, radius + 1500);
      
      // Glowing storm border ring
      this.minimapGraphics.lineStyle(120, 0xff0055, 0.85); // 120px thick glow scales to 6px on minimap!
      this.minimapGraphics.strokeCircle(centerX, centerY, radius);
      this.minimapGraphics.lineStyle(40, 0xff0055, 0.3);   // Soft outer radar bleed
      this.minimapGraphics.strokeCircle(centerX, centerY, radius + 80);
    }

    // 2. Interpolate other players smoothly
    Object.keys(this.players).forEach(id => {
      // Spin passive shield rings if visible
      const lp = this.players[id];
      if (lp && lp.passiveShield && lp.passiveShield.visible) {
        lp.passiveShield.setRotation(time * 0.0015);
      }

      if (id === this.localPlayerId) return;
      
      const sp = this.serverPlayers[id];
      if (!sp || sp.isDead) return;

      // Linear Interpolation (LERP) coordinates
      lp.container.x = Phaser.Math.Linear(lp.container.x, sp.x, 0.22);
      lp.container.y = Phaser.Math.Linear(lp.container.y, sp.y, 0.22);
      lp.arrow.setRotation(Phaser.Math.Linear(lp.arrow.rotation, sp.angle, 0.22));

      // Draw trails for dashing opponent
      if (sp.isDashing && time % 3 === 0) {
        this.spawnGhostTrail(lp.container.x, lp.container.y, sp.angle, lp.color);
      }
    });
  }

  // Fading neon shadow trails
  spawnGhostTrail(x, y, angle, tint) {
    const ghost = this.add.image(x, y, 'ghost');
    ghost.setRotation(angle);
    ghost.setTint(tint);
    ghost.setAlpha(0.6);
    ghost.setDepth(1);
    
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      scaleX: 0.8,
      scaleY: 0.8,
      duration: 200,
      onComplete: () => { ghost.destroy(); }
    });
  }

  // Draw glowing crescents when weapons swing
  triggerSwordSlash(id, angle) {
    const lp = this.players[id];
    if (!lp) return;

    const slash = lp.slash;
    slash.clear();
    slash.lineStyle(4, lp.color, 1);
    
    // Draw beautiful glowing neon swing arc pointing at the vector
    const range = 64;
    const arcAngle = Math.PI / 2.2; // ~80 degrees
    
    slash.beginPath();
    slash.arc(0, 0, range, -arcAngle / 2, arcAngle / 2);
    slash.strokePath();

    slash.setRotation(angle);
    slash.setVisible(true);
    slash.setAlpha(1.0);

    // Quick swing fade-out tween
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: 150,
      onComplete: () => {
        slash.setVisible(false);
        slash.setScale(1.0);
      }
    });
  }

  // Trigger shield bubble indicator on other players
  triggerParryShield(id) {
    const lp = this.players[id];
    if (!lp) return;

    // Prevent double-triggering glitches, especially for local prediction overlap
    if (lp.parryTweenActive) return;

    lp.shield.setVisible(true);
    lp.shield.setAlpha(1.0);
    lp.parryTweenActive = true;

    this.tweens.add({
      targets: lp.shield,
      alpha: 0,
      duration: 350,
      onComplete: () => {
        lp.shield.setVisible(false);
        lp.parryTweenActive = false;
      }
    });
  }

  // Trigger glowing parry block collision VFX (white expand ring + sparks)
  triggerParryImpact(x, y, parryId, victimId) {
    // 1. Blinding expansion circle
    const ring = this.add.graphics();
    ring.lineStyle(6, 0x00ff66, 1.0);
    ring.strokeCircle(x, y, 10);
    ring.setDepth(5);

    this.tweens.add({
      targets: ring,
      scaleX: 6.0,
      scaleY: 6.0,
      alpha: 0,
      duration: 400,
      onComplete: () => { ring.destroy(); }
    });

    // 2. High-speed spark burst
    const sparks = this.add.particles(x, y, 'spark', {
      speed: { min: 250, max: 550 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.8, end: 0 },
      alpha: { start: 1.0, end: 0 },
      lifespan: 600,
      maxParticles: 45,
      tint: 0x00ff66
    });
    sparks.setDepth(6);
    this.activeEmitters.push(sparks);
    this.time.delayedCall(800, () => {
      sparks.destroy();
      this.activeEmitters = this.activeEmitters.filter(e => e !== sparks);
    });

    // Shake camera heavily
    this.cameras.main.shake(250, 0.015);
    
    // Slow down game time scale briefly for instant impact feel
    this.timeScaleImpactTrigger();
  }

  // Fatal Hit Neon Spark Explosion
  triggerKillStrike(x, y, killerId, victimId) {
    const victim = this.players[victimId];
    const victimColor = victim ? victim.color : 0xff0055;

    // Play big neon explosion particles of victim's color
    const sparks = this.add.particles(x, y, 'spark', {
      speed: { min: 100, max: 400 },
      angle: { min: 0, max: 360 },
      scale: { start: 2.2, end: 0 },
      alpha: { start: 1.0, end: 0 },
      lifespan: 800,
      maxParticles: 55,
      tint: victimColor
    });
    sparks.setDepth(6);
    this.activeEmitters.push(sparks);
    this.time.delayedCall(1000, () => {
      sparks.destroy();
      this.activeEmitters = this.activeEmitters.filter(e => e !== sparks);
    });

    // Shake camera
    this.cameras.main.shake(300, 0.018);

    // Check if this was the final game ending kill. Trigger slow-mo.
    let isMatchEndingKill = false;
    if (currentLobbyState && currentLobbyState.scores) {
      const scores = currentLobbyState.scores;
      const targetWins = Math.ceil((currentLobbyState.bestOf || 3) / 2);
      
      // Get all active players in the scene right before this kill
      const aliveIds = Object.keys(this.players).filter(id => !this.players[id].isDead);
      
      // If exactly 2 players were alive, and one is about to die (victimId),
      // the remaining player is the sole survivor and will win the round.
      if (aliveIds.length === 2 && aliveIds.includes(victimId)) {
        const potentialWinnerId = aliveIds.find(id => id !== victimId);
        if (potentialWinnerId) {
          const currentWins = scores[potentialWinnerId] || 0;
          if (currentWins + 1 >= targetWins) {
            isMatchEndingKill = true;
          }
        }
      }
    }

    if (isMatchEndingKill) {
      // Epic match-ending slow motion finisher!
      this.timeScaleFinisherTrigger();
    } else {
      this.timeScaleImpactTrigger();
    }
  }

  // Dynamic Time Scales for crunchy combat impacts
  timeScaleImpactTrigger() {
    this.tweens.add({
      targets: this.tweens,
      timeScale: 0.15,
      duration: 50,
      yoyo: true,
      hold: 120,
      onComplete: () => { this.tweens.timeScale = 1.0; }
    });
  }

  timeScaleFinisherTrigger() {
    // Dramatically drop speed to 0.08x for 1.8 seconds on final blow
    this.tweens.add({
      targets: this.tweens,
      timeScale: 0.08,
      duration: 100,
      onComplete: () => {
        this.time.delayedCall(1600, () => {
          this.tweens.timeScale = 1.0;
        });
      }
    });
  }

  // Floating text cues
  showCountdownText(sec) {
    this.centerText.setText(sec.toString());
    this.centerText.setScale(0.2);
    this.centerText.setAlpha(0.2);

    this.tweens.add({
      targets: this.centerText,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 1.0,
      duration: 250,
      yoyo: true,
      hold: 500,
      onComplete: () => {
        this.centerText.setText('');
      }
    });
  }

  showRoundResolutionText(reason) {
    this.roundEndText.setText(reason.toUpperCase());
    this.roundEndText.setAlpha(0);
    this.roundEndText.setScale(0.8);

    this.tweens.add({
      targets: this.roundEndText,
      alpha: 1.0,
      scaleX: 1.0,
      scaleY: 1.0,
      duration: 300,
      hold: 2500,
      yoyo: true,
      onComplete: () => {
        this.roundEndText.setText('');
      }
    });
  }

  showStormWarningBanner(sec) {
    if (sec < 0) return;
    
    let bannerText = '';
    let bannerColor = '#fffb00';
    let alertDuration = 1200;
    
    if (sec === 0) {
      bannerText = '⚡ ALERT: STORM COLLAPSE INITIALIZED! ⚡';
      bannerColor = '#ff0055'; // Neon pink for active collapse!
      alertDuration = 2200;    // Show longer for active warning
    } else {
      // Only show big alerts at 20, 15, 10, and then every second under 5
      if (sec !== 20 && sec !== 15 && sec !== 10 && sec > 5) return;
      bannerText = `⚡ WARNING: STORM CONVERGES IN ${sec}s ⚡`;
    }
    
    // Play procedurally synthesized cyberpunk warning chirp!
    CyberSynth.playWarningBeep();
    
    this.centerText.setText(bannerText);
    this.centerText.setY(120); // Move dynamically to the top of the viewport (below the top HUD)
    this.centerText.setFontSize('1.8rem');
    this.centerText.setColor(bannerColor);
    this.centerText.setShadow(0, 0, 12, bannerColor, true);
    this.centerText.setAlpha(1.0);
    this.centerText.setScale(1.0);
    
    // Fade-out after alertDuration
    this.tweens.add({
      targets: this.centerText,
      alpha: 0,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: alertDuration,
      onComplete: () => {
        this.centerText.setText('');
        this.centerText.setY(400); // Reset Y coordinate back to center for countdowns
        this.centerText.setFontSize('4.5rem');
      }
    });
  }

  // Interactive VFX: Speed Boost Pad sparks
  triggerSpeedBoostEffect(id) {
    const lp = this.players[id];
    if (!lp) return;

    // Emit green speed particles behind player
    const sparks = this.add.particles(lp.container.x, lp.container.y, 'spark', {
      speed: { min: 80, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 400,
      maxParticles: 15,
      tint: 0x00ff66
    });
    sparks.setDepth(1);
    this.activeEmitters.push(sparks);
    this.time.delayedCall(600, () => {
      sparks.destroy();
      this.activeEmitters = this.activeEmitters.filter(e => e !== sparks);
    });
    
    // Tint arrow temporarily green
    lp.arrow.setTint(0x00ff66);
    this.time.delayedCall(800, () => {
      if (this.players[id]) {
        lp.arrow.setTint(lp.color);
      }
    });
  }

  // Interactive VFX: Warp Portals flash and concentric rings
  triggerTeleportEffect(id, fromX, fromY, toX, toY) {
    // 1. Purple ring contracting at start portal
    const ring1 = this.add.graphics();
    ring1.lineStyle(4, 0xb026ff, 1.0);
    ring1.strokeCircle(fromX, fromY, 32);
    ring1.setDepth(4);
    
    this.tweens.add({
      targets: ring1,
      scaleX: 0.1,
      scaleY: 0.1,
      alpha: 0,
      duration: 350,
      onComplete: () => { ring1.destroy(); }
    });

    // 2. Orange ring expanding at destination portal
    const ring2 = this.add.graphics();
    ring2.lineStyle(4, 0xffaa00, 1.0);
    ring2.strokeCircle(toX, toY, 6);
    ring2.setDepth(4);
    
    this.tweens.add({
      targets: ring2,
      scaleX: 5.5,
      scaleY: 5.5,
      alpha: 0,
      duration: 400,
      onComplete: () => { ring2.destroy(); }
    });

    // 3. Dual portal sparks
    const sparks1 = this.add.particles(fromX, fromY, 'spark', {
      speed: 160, scale: { start: 1.4, end: 0 }, lifespan: 400, maxParticles: 18, tint: 0xb026ff
    });
    const sparks2 = this.add.particles(toX, toY, 'spark', {
      speed: 220, scale: { start: 1.6, end: 0 }, lifespan: 450, maxParticles: 22, tint: 0xffaa00
    });
    sparks1.setDepth(5);
    sparks2.setDepth(5);
    this.activeEmitters.push(sparks1, sparks2);
    this.time.delayedCall(650, () => {
      sparks1.destroy();
      sparks2.destroy();
      this.activeEmitters = this.activeEmitters.filter(e => e !== sparks1 && e !== sparks2);
    });
  }

  // Visuals: Active shield bubble deployment flash
  triggerShieldActivate(id) {
    const lp = this.players[id];
    if (!lp) return;

    // Expanding gold matrix pulse ring
    const ring = this.add.graphics();
    ring.lineStyle(4, 0xfffb00, 1.0);
    ring.strokeCircle(lp.container.x, lp.container.y, 20);
    ring.setDepth(4);
    this.tweens.add({
      targets: ring,
      scaleX: 3.5,
      scaleY: 3.5,
      alpha: 0,
      duration: 350,
      onComplete: () => { ring.destroy(); }
    });

    // Yellow particle burst
    const sparks = this.add.particles(lp.container.x, lp.container.y, 'spark', {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      lifespan: 500,
      maxParticles: 20,
      tint: 0xfffb00
    });
    sparks.setDepth(5);
    this.activeEmitters.push(sparks);
    this.time.delayedCall(700, () => {
      sparks.destroy();
      this.activeEmitters = this.activeEmitters.filter(e => e !== sparks);
    });
  }

  // Visuals: Pop/Shatter gold shield bubble
  triggerShieldPop(id, x, y) {
    // Glass shatter sparks
    const sparks = this.add.particles(x, y, 'spark', {
      speed: { min: 150, max: 400 },
      angle: { min: 0, max: 360 },
      scale: { start: 2.0, end: 0 },
      alpha: { start: 1.0, end: 0 },
      lifespan: 750,
      maxParticles: 45,
      tint: 0xfffb00
    });
    sparks.setDepth(6);
    this.activeEmitters.push(sparks);
    this.time.delayedCall(950, () => {
      sparks.destroy();
      this.activeEmitters = this.activeEmitters.filter(e => e !== sparks);
    });

    // Camera rumble
    this.cameras.main.shake(150, 0.008);
  }
}

// Global initialization of Phaser container configuration
function initPhaserGame(playerIds) {
  const config = {
    type: Phaser.AUTO,
    width: 1000,
    height: 800,
    parent: 'phaser-game-div',
    backgroundColor: '#07050f',
    physics: {
      default: 'none' // Zero physics calculation on clients; server maintains strict authoritative physics
    },
    scene: [GameDuelScene],
    antialias: true,
    pixelArt: false,
    scale: {
      mode: Phaser.Scale.FIT, // Adaptive responsive viewport fitting
      autoCenter: Phaser.Scale.CENTER_BOTH
    }
  };

  const game = new Phaser.Game(config);
}
