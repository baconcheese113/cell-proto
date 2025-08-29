/**
 * NetSyncSystem - Core multiplayer synchronization system
 * 
 * Handles host-authoritative simulation with client prediction.
 * Manages input collection, state replication, and command processing.
 */

import { SystemObject } from "../systems/system-object";
import type { NetworkTransport, ConnectionEvent } from "./transport";
import type { WorldRefs, Transcript, Vesicle } from "../core/world-refs";
import type { Player } from "../actors/player";
import { ClientPrediction } from "./client-prediction";
import { EntityReplicator } from "./entity-replicator";
import type { 
  ClientInput, 
  HostCommand, 
  ClientCommand,
  HostSnapshot, 
  NetworkMessage, 
  NetworkPlayer, 
  NetworkStatus,
  NetworkCargo,
  InputSeq
} from "./schema";

export interface NetSyncConfig {
  scene: Phaser.Scene;
  transport: NetworkTransport;
  worldRefs: WorldRefs;
  player: Player;
  isHost: boolean;
}

export class NetSyncSystem extends SystemObject {
  private transport: NetworkTransport;
  private player: Player;
  private isHost: boolean;
  private worldRefs: WorldRefs;
  
  // Entity replication
  private entityReplicator: EntityReplicator;
  
  // Client-side prediction
  private clientPrediction?: ClientPrediction;
  
  // Network timing
  private readonly TICK_RATE = 15; // Hz - network update rate
  private readonly TICK_INTERVAL = 1000 / this.TICK_RATE; // ms
  private lastNetTick = 0;
  private currentTick = 0;
  
  // Client-side input prediction
  private inputSequence: InputSeq = 0;
  private inputBuffer: Map<InputSeq, ClientInput> = new Map();
  private lastAckedInput: InputSeq = 0;
  private readonly MAX_INPUT_BUFFER = 60; // ~4 seconds at 15Hz
  
  // Host-side state
  private connectedPlayers: Map<string, NetworkPlayer> = new Map();
  private remotePlayers: Map<string, Phaser.GameObjects.Sprite> = new Map(); // Visual sprites for remote players
  private hostPlayerId: string = 'host';
  private hostNetworkPlayer?: NetworkPlayer; // Host's own network state using simplified physics
  
  // Track what each player is carrying for multiplayer cargo system
  private playerCarriedCargo = new Map<string, { type: 'transcript' | 'vesicle'; item: Transcript | Vesicle; pickedUpAt: number }>();
  
  // Client-side integration tracking
  private pendingPickupIntegration = false;
  
  // Host-side input tracking (for proper acknowledgments)
  private lastProcessedInputs: Map<string, InputSeq> = new Map(); // Track last input seq per player
  
  // Status tracking
  private status: NetworkStatus;
  
  // Command deduplication tracking  
  private processedCommandIds = new Set<string>();
  private readonly MAX_PROCESSED_COMMANDS = 1000; // Limit memory usage
  
  constructor(config: NetSyncConfig) {
    super(config.scene, 'NetSyncSystem', (dt) => this.networkUpdate(dt));
    
    this.transport = config.transport;
    this.worldRefs = config.worldRefs;
    this.player = config.player;
    this.isHost = config.isHost;
    
    // Initialize entity replication
    this.entityReplicator = new EntityReplicator(this.worldRefs);
    
    // Provide a callback for the EntityReplicator to get cargo carrier information
    this.entityReplicator.setCarrierIdResolver((cargoId: string) => {
      for (const [playerId, cargo] of this.playerCarriedCargo) {
        if (cargo.item.id === cargoId) {
          return playerId;
        }
      }
      return undefined;
    });
    
    // Provide a way for EntityReplicator to get the local player ID
    this.entityReplicator.setLocalPlayerIdResolver(() => {
      return this.isHost ? 'host' : 'client';
    });
    
    // Initialize host network player state if we're the host
    if (this.isHost) {
      const initialPos = this.player.getWorldPosition();
      this.hostNetworkPlayer = {
        id: this.hostPlayerId,
        pos: { x: initialPos.x, y: initialPos.y },
        vel: { x: 0, y: 0 },
        dir: { x: 1, y: 0 },
        isDashing: false,
        dashTimer: 0,
        dashCooldown: 0,
        driveMode: false,
        motilityMode: 'default',
        actionCooldowns: {
          blebBurst: 0,
          proteaseToggle: 0,
          handbrake: 0
        },
        health: 100
      };
      console.log(`🏠 HOST: Initialized hostNetworkPlayer at (${initialPos.x}, ${initialPos.y})`);
      
      // Enable network control mode for host player to prevent double movement
      this.player.setNetworkControlled(true);
      console.log(`🏠 HOST: Enabled network control mode for host player`);
    }
    
    // Initialize client prediction for non-host players
    if (!this.isHost) {
      // Disable client prediction for now to avoid sync issues
      // this.clientPrediction = new ClientPrediction(this.player);
      
      // Enable network control for client to prevent local physics interference
      this.player.setNetworkControlled(true);
      console.log(`📱 CLIENT: Using server-authoritative movement without prediction`);
    }
    
    this.status = {
      isHost: this.isHost,
      connected: false,
      playerId: this.isHost ? this.hostPlayerId : 'client',
      ping: 0,
      tickRate: this.TICK_RATE,
      inputBuffer: 0,
      lastSnapshot: 0
    };
    
    this.setupNetworkHandlers();
    this.logStartup();
  }
  
  private setupNetworkHandlers(): void {
    this.transport.addEventListener('connection', (event: any) => {
      const connectionEvent = event.detail as ConnectionEvent;
      this.handleConnectionEvent(connectionEvent);
    });
  }
  
  private handleConnectionEvent(event: ConnectionEvent): void {
    // Only log message events for important stuff, filter out routine command/snapshot/input spam
    if (event.type !== 'message' || 
        (event.data?.type !== 'input' && event.data?.type !== 'command' && event.data?.type !== 'snapshot')) {
      console.log(`🔌 NetSyncSystem: Connection event:`, event.type, event.data);
    }
    
    switch (event.type) {
      case 'connected':
        this.status.connected = true;
        console.log('🎉 NetSyncSystem: Connected to network - enabling network ticks');
        break;
        
      case 'disconnected':
        this.status.connected = false;
        console.log('❌ NetSyncSystem: Disconnected from network - disabling network ticks');
        break;
        
      case 'message':
        this.handleNetworkMessage(event.data);
        break;
        
      case 'error':
        console.error('❌ NetSyncSystem: Network error:', event.data?.error);
        break;
    }
  }
  
  private handleNetworkMessage(message: NetworkMessage): void {
    switch (message.type) {
      case 'input':
        if (this.isHost) {
          this.handleClientInput(message.playerId!, message.data as ClientInput);
        }
        break;
        
      case 'clientCommand':
        if (this.isHost) {
          this.handleClientCommand(message.playerId!, message.data as ClientCommand);
        }
        break;
        
      case 'command':
        if (!this.isHost) {
          this.handleHostCommand(message.data as HostCommand);
        }
        break;
        
      case 'snapshot':
        if (!this.isHost) {
          this.handleHostSnapshot(message.data as HostSnapshot);
        }
        break;
        
      case 'join':
        if (this.isHost) {
          this.handlePlayerJoin(message.playerId!);
        }
        break;
        
      case 'leave':
        if (this.isHost) {
          this.handlePlayerLeave(message.playerId!);
        }
        break;
    }
  }
  
  private networkUpdate(_dt: number): void {
    if (!this.status.connected) {
      console.log('🔌 NetSyncSystem: Not connected, skipping network update');
      return;
    }
    
    const now = Date.now();
    
    // Network tick timing
    if (now - this.lastNetTick >= this.TICK_INTERVAL) {
      this.lastNetTick = now;
      this.currentTick++;
      
      // Only log every 50th tick to reduce spam (about every 3 seconds)
      if (this.currentTick % 50 === 0) {
        console.log(`🎮 NetSyncSystem: Network tick ${this.currentTick} (${this.isHost ? 'HOST' : 'CLIENT'})`);
      }
      
      if (this.isHost) {
        this.hostNetworkTick();
      } else {
        this.clientNetworkTick();
      }
    }
    
    // Update status
    this.status.inputBuffer = this.inputBuffer.size;
    this.status.ping = this.transport.getStats().ping;
  }
  
  /**
   * Host network tick - process inputs and send snapshots
   */
  private hostNetworkTick(): void {
    // Update host's own network state using the same simplified physics as clients
    this.updateHostNetworkState();
    
    // Only log every 50th tick to reduce spam
    if (this.currentTick % 50 === 0) {
      console.log('📡 HOST: Creating and sending snapshot...');
    }
    
    // Process any pending client inputs
    // (inputs are processed immediately when received)
    
    // Send snapshot to all clients
    const snapshot = this.createHostSnapshot();
    
    // Host also needs to apply visual updates for connected players
    this.applyHostVisualUpdates(snapshot);
    
    // Apply network-controlled cargo visual updates for the host
    // This ensures the host sees cargo carried by remote players without affecting local game state
    this.applyNetworkCargoVisuals(snapshot);
    
    // Only log every 50th tick to reduce spam
    if (this.currentTick % 50 === 0) {
      console.log(`📦 HOST: Snapshot created with ${snapshot.cargo.length} cargo, ${snapshot.seats.length} seats`);
      if (snapshot.cargo.some(c => c.carrierId && c.carrierId !== 'host')) {
        console.log(`🔄 HOST: Applied network cargo visuals for remote players`);
      }
    }
    
    this.broadcastSnapshot(snapshot);
    
    // Clean up old input acknowledgments
    this.cleanupInputBuffer();
  }
  
  /**
   * Update host network state using same simplified physics as clients
   */
  private updateHostNetworkState(): void {
    if (!this.hostNetworkPlayer) return;
    
    // Collect host's current input state
    const hostInput = this.collectCurrentHostInput();
    if (hostInput) {
      // Debug log host movement every 100 ticks
      if (this.currentTick % 100 === 0 && (Math.abs(hostInput.moveAxis.x) > 0 || Math.abs(hostInput.moveAxis.y) > 0)) {
        console.log(`🏠 HOST: Host input - move(${hostInput.moveAxis.x.toFixed(2)}, ${hostInput.moveAxis.y.toFixed(2)}) dash:${hostInput.dash}`);
        console.log(`🏠 HOST: Pre-movement pos(${this.hostNetworkPlayer.pos.x.toFixed(1)}, ${this.hostNetworkPlayer.pos.y.toFixed(1)})`);
      }
      
      // Apply the same simplified physics that clients use
      this.applyInputToNetworkPlayer(hostInput, this.hostNetworkPlayer);
      
      if (this.currentTick % 100 === 0 && (Math.abs(hostInput.moveAxis.x) > 0 || Math.abs(hostInput.moveAxis.y) > 0)) {
        console.log(`🏠 HOST: Post-movement pos(${this.hostNetworkPlayer.pos.x.toFixed(1)}, ${this.hostNetworkPlayer.pos.y.toFixed(1)})`);
      }
    }
    
    // CRITICAL: Sync the real player position to match the network state
    // This ensures that the host's visual player and network state are consistent
    this.player.setPosition(this.hostNetworkPlayer.pos.x, this.hostNetworkPlayer.pos.y);
  }
  
  /**
   * Collect host's current input (similar to client input collection)
   */
  private collectCurrentHostInput(): ClientInput | null {
    const scene = this.scene as any;
    if (!scene.keys) return null;
    
    const keys = scene.keys;
    
    // Calculate movement axis
    let moveX = 0;
    let moveY = 0;
    if (keys.A.isDown) moveX -= 1;
    if (keys.D.isDown) moveX += 1;
    if (keys.W.isDown) moveY -= 1;
    if (keys.S.isDown) moveY += 1;
    
    // Normalize movement vector
    if (moveX !== 0 || moveY !== 0) {
      const length = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= length;
      moveY /= length;
    }
    
    return {
      seq: this.currentTick, // Use tick as sequence for host
      dt: 1.0 / this.TICK_RATE, // Use network tick rate
      moveAxis: { x: moveX, y: moveY },
      dash: keys.SPACE.isDown,
      driveToggle: false, // Don't toggle for host automatic updates
      motilityActions: undefined, // Simplified for host
      aimDir: undefined,
      throwCharge: 0,
      throwRelease: false,
      scoopDrop: false,
      interact: false
    };
  }
  
  /**
   * Client network tick - send inputs and handle prediction
   */
  private clientNetworkTick(): void {
    // Only log every 300th tick to reduce spam (300 ticks = ~20 seconds at 15Hz)
    if (this.currentTick % 300 === 0) {
      console.log('📤 CLIENT: Network tick - collecting input...');
    }
    
    // Collect current input state
    const input = this.collectClientInput();
    
    if (input) {
      // Only log every 300th input to reduce spam
      if (input.seq % 300 === 0) {
        console.log(`📤 CLIENT: Sending input seq ${input.seq}:`, {
          moveX: input.moveAxis.x,
          moveY: input.moveAxis.y,
          dash: input.dash
        });
      }
      
      // Store input for potential replay
      this.inputBuffer.set(input.seq, input);
      
      // Send to host
      this.sendClientInput(input);
      
      // Client prediction disabled - using server authoritative movement only
      // if (this.clientPrediction && (
      //   input.moveAxis.x !== 0 || 
      //   input.moveAxis.y !== 0 || 
      //   input.dash ||
      //   input.driveToggle ||
      //   input.scoopDrop ||
      //   input.interact
      // )) {
      //   this.clientPrediction.addInput(input);
      // }
    } else {
      // Only log no-input every 300th tick to reduce spam
      if (this.currentTick % 300 === 0) {
        console.log('📤 CLIENT: No input to send');
      }
    }
    
    // Clean up old inputs
    this.cleanupInputBuffer();
  }
  
  /**
   * Collect current client input state
   */
  private collectClientInput(): ClientInput | null {
    const scene = this.scene as any; // Access scene's input system
    if (!scene.keys) return null;

    const keys = scene.keys;
    this.inputSequence++;

    // Calculate movement axis
    let moveX = 0;
    let moveY = 0;
    if (keys.A.isDown) moveX -= 1;
    if (keys.D.isDown) moveX += 1;
    if (keys.W.isDown) moveY -= 1;
    if (keys.S.isDown) moveY += 1;

    // Normalize movement vector
    if (moveX !== 0 || moveY !== 0) {
      const length = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= length;
      moveY /= length;
    }

    // Get aim direction from mouse or touch
    const pointer = scene.input.activePointer;
    const playerWorldPos = this.player.getWorldPosition();
    const aimX = pointer.worldX - playerWorldPos.x;
    const aimY = pointer.worldY - playerWorldPos.y;
    const aimLength = Math.sqrt(aimX * aimX + aimY * aimY);

    // Collect CellMotility-specific inputs
    let motilityActions = undefined;
    
    // Check if we're in drive mode (controlling the cell)
    const isInDriveMode = (scene as any).cellDriveMode || false;
    
    if (scene.cellMotility) {
      const modeRegistry = scene.cellMotility.getModeRegistry();
      const modeState = modeRegistry.getState();
      
      motilityActions = {
        // blebBurst is only available in drive mode
        blebBurst: isInDriveMode && keys.SPACE && Phaser.Input.Keyboard.JustDown(keys.SPACE),
        proteaseToggle: keys.X && Phaser.Input.Keyboard.JustDown(keys.X),
        handbrake: keys.Z && Phaser.Input.Keyboard.JustDown(keys.Z),
        modeSwitch: keys.TAB && Phaser.Input.Keyboard.JustDown(keys.TAB),
        
        // Amoeboid-specific: pseudopod aiming
        amoeboidPseudopodAim: modeState.currentModeId === 'amoeboid' && modeState.amoeboid.isAiming ? {
          isAiming: true,
          aimDirection: modeState.amoeboid.aimDirection
        } : undefined
      };
    }

    const input: ClientInput = {
      seq: this.inputSequence,
      dt: 1.0 / this.TICK_RATE, // Use network deltaTime (~0.067s) instead of frame deltaTime
      
      moveAxis: { x: moveX, y: moveY },
      // dash is only available when NOT in drive mode
      dash: !isInDriveMode && keys.SPACE.isDown,
      driveToggle: Phaser.Input.Keyboard.JustDown(keys.T),
      
      motilityActions,
      
      aimDir: aimLength > 0 ? {
        x: aimX / aimLength,
        y: aimY / aimLength
      } : undefined,
      
      throwCharge: 0, // TODO: Implement throw charging
      throwRelease: false, // TODO: Implement throw release
      
      scoopDrop: Phaser.Input.Keyboard.JustDown(keys.R),
      interact: Phaser.Input.Keyboard.JustDown(keys.E)
    };

    return input;
  }  /**
   * Send client input to host
   */
  private sendClientInput(input: ClientInput): void {
    const message: NetworkMessage = {
      type: 'input',
      playerId: this.status.playerId,
      data: input,
      timestamp: Date.now()
    };
    
    // Only log every 300th input send to reduce spam
    if (input.seq % 300 === 0) {
      console.log(`🚀 CLIENT: Sending input message seq ${input.seq}`);
    }
    
    try {
      this.transport.sendUnreliable(message);
      // Only log success every 300th input to reduce spam
      if (input.seq % 300 === 0) {
        console.log('✅ CLIENT: Input sent successfully');
      }
    } catch (error) {
      console.error('❌ CLIENT: Failed to send input:', error);
    }
  }
  
  /**
   * Handle incoming client input (host only)
   */
  private handleClientInput(playerId: string, input: ClientInput): void {
    if (!this.isHost) return;
    
    // Reduce logging spam
    if (input.seq % 60 === 0) {
      console.log(`🎮 HOST: Processing input from ${playerId}, seq ${input.seq}`);
    }
    
    // Get or create player state
    let playerState = this.connectedPlayers.get(playerId);
    if (!playerState) {
      playerState = this.createNetworkPlayer(playerId);
      this.connectedPlayers.set(playerId, playerState);
      console.log(`🆕 HOST: Created new player state for ${playerId}`);
    }
    
    // Validate and apply input
    if (this.validateInput(input, playerState)) {
      this.applyInputToNetworkPlayer(input, playerState);
      
      // Track this as the last processed input for this player
      this.lastProcessedInputs.set(playerId, input.seq);
      
      // Input acknowledgment is sent via snapshot.ackSeq, not individual commands
    } else {
      console.warn(`❌ HOST: Invalid input from ${playerId}, seq ${input.seq}`);
      // Send rejection for invalid inputs only
      this.sendInputRejection(playerId, input.seq, 'Invalid input');
    }
  }
  
  /**
   * Validate client input (basic validation)
   */
  private validateInput(input: ClientInput, player: NetworkPlayer): boolean {
    // Basic validation - movement vector should be normalized
    const moveLength = Math.sqrt(input.moveAxis.x ** 2 + input.moveAxis.y ** 2);
    if (moveLength > 1.1) return false; // Allow small floating point errors

    // Aim direction should be normalized if present
    if (input.aimDir) {
      const aimLength = Math.sqrt(input.aimDir.x ** 2 + input.aimDir.y ** 2);
      if (Math.abs(aimLength - 1.0) > 0.1) return false;
    }
    
    // Validate timing constraints (prevent input flooding)
    if (input.dt < 0 || input.dt > 1.0) return false; // Reasonable delta time range
    
    // Validate action timing (prevent rapid-fire actions)
    if (input.motilityActions) {
      const actions = input.motilityActions;
      
      // Check action cooldowns to prevent cheating
      if (actions.blebBurst && player.actionCooldowns.blebBurst > 0) return false;
      if (actions.proteaseToggle && player.actionCooldowns.proteaseToggle > 0) return false;
      if (actions.handbrake && player.actionCooldowns.handbrake > 0) return false;
      
      // Validate amoeboid pseudopod aim direction
      if (actions.amoeboidPseudopodAim?.aimDirection !== undefined) {
        const aimDir = actions.amoeboidPseudopodAim.aimDirection;
        if (aimDir < 0 || aimDir >= Math.PI * 2) return false; // Valid radian range
      }
    }

    return true;
  }  /**
   * Apply input to network player state
   */
  private applyInputToNetworkPlayer(input: ClientInput, player: NetworkPlayer): void {
    // Use consistent network tick deltaTime instead of variable client deltaTime
    // This ensures consistent physics simulation regardless of client framerate
    const networkDeltaTime = 1.0 / this.TICK_RATE; // Should be ~0.067 seconds for 15Hz
    const deltaTime = networkDeltaTime;

    // Debug logging for movement
    const oldPos = { x: player.pos.x, y: player.pos.y };
    const oldVel = { x: player.vel.x, y: player.vel.y };

    // Handle drive mode toggle
    if (input.driveToggle) {
      player.driveMode = !player.driveMode;
    }

    // Only process movement if in drive mode (or always for network players)
    if (player.driveMode || true) { // For now, always process movement
      
      // Simplified server physics - just basic movement
      if (input.moveAxis.x !== 0 || input.moveAxis.y !== 0) {
        // Simple velocity-based movement
        const speed = player.isDashing ? 300 : 150; // pixels per second
        
        // Handle dash
        if (input.dash && player.dashCooldown <= 0) {
          player.isDashing = true;
          player.dashTimer = 0.2;
          player.dashCooldown = 1.2;
        }
        
        // Set velocity directly based on input
        player.vel.x = input.moveAxis.x * speed;
        player.vel.y = input.moveAxis.y * speed;
        
      } else {
        // Stop when no input
        player.vel.x = 0;
        player.vel.y = 0;
      }
      
      // Update position based on velocity
      player.pos.x += player.vel.x * deltaTime;
      player.pos.y += player.vel.y * deltaTime;
      
      // Apply boundary constraints to keep player within cell membrane
      const cellRadius = 216; // Same as GameScene.cellRadius
      const playerBoundaryRadius = cellRadius - 20; // Give some margin like the real player
      
      const distanceFromCenter = Math.sqrt(player.pos.x * player.pos.x + player.pos.y * player.pos.y);
      if (distanceFromCenter > playerBoundaryRadius) {
        // Push player back inside the boundary
        const normalizeX = player.pos.x / distanceFromCenter;
        const normalizeY = player.pos.y / distanceFromCenter;
        
        player.pos.x = normalizeX * playerBoundaryRadius;
        player.pos.y = normalizeY * playerBoundaryRadius;
        
        // Also stop velocity in the outward direction to prevent bouncing
        const velDotNormal = (player.vel.x * normalizeX + player.vel.y * normalizeY);
        if (velDotNormal > 0) {
          player.vel.x -= normalizeX * velDotNormal;
          player.vel.y -= normalizeY * velDotNormal;
        }
      }
      
      // Debug movement every few ticks
      if (input.seq % 150 === 0 && (Math.abs(input.moveAxis.x) > 0 || Math.abs(input.moveAxis.y) > 0)) {
        console.log(`🎮 HOST: Player ${player.id} movement debug:`);
        console.log(`  Input: moveAxis(${input.moveAxis.x.toFixed(2)}, ${input.moveAxis.y.toFixed(2)}) client_dt=${input.dt.toFixed(4)} network_dt=${deltaTime.toFixed(4)}`);
        console.log(`  Velocity: (${oldVel.x.toFixed(1)}, ${oldVel.y.toFixed(1)}) → (${player.vel.x.toFixed(1)}, ${player.vel.y.toFixed(1)})`);
        console.log(`  Position: (${oldPos.x.toFixed(1)}, ${oldPos.y.toFixed(1)}) → (${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)})`);
        console.log(`  Distance from center: ${distanceFromCenter.toFixed(1)}/${playerBoundaryRadius}`);
      }
    }
    
    // Update direction based on aim or movement
    if (input.aimDir) {
      player.dir.x = input.aimDir.x;
      player.dir.y = input.aimDir.y;
    } else if (input.moveAxis.x !== 0 || input.moveAxis.y !== 0) {
      const moveLength = Math.sqrt(input.moveAxis.x ** 2 + input.moveAxis.y ** 2);
      if (moveLength > 0) {
        player.dir.x = input.moveAxis.x / moveLength;
        player.dir.y = input.moveAxis.y / moveLength;
      }
    }
    
    // Handle CellMotility actions
    if (input.motilityActions) {
      const actions = input.motilityActions;
      
      // Process action inputs and update cooldowns
      if (actions.blebBurst && player.actionCooldowns.blebBurst <= 0) {
        // Apply bleb burst effects (from CellMotility system)
        const burstSpeed = 2.0; // Speed multiplier for bleb burst
        player.vel.x *= burstSpeed;
        player.vel.y *= burstSpeed;
        player.actionCooldowns.blebBurst = 2.0; // 2 second cooldown
      }
      
      if (actions.proteaseToggle && player.actionCooldowns.proteaseToggle <= 0) {
        // Toggle protease state (visual/mechanical effect)
        player.actionCooldowns.proteaseToggle = 1.0; // 1 second cooldown
      }
      
      if (actions.handbrake && player.actionCooldowns.handbrake <= 0) {
        // Apply handbrake effect (reduce speed, enhance turning)
        player.vel.x *= 0.85; // Speed reduction from CellMotility
        player.actionCooldowns.handbrake = 0.5; // 0.5 second cooldown
      }
      
      if (actions.modeSwitch) {
        // Cycle through motility modes
        const modes = ['amoeboid', 'blebbing', 'mesenchymal'];
        const currentIndex = modes.indexOf(player.motilityMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        player.motilityMode = modes[nextIndex];
      }
    }
    
    // Process other action inputs
    if (this.isHost) {
      // Only process game actions on the host to maintain authority
      this.processGameActions(input, player);
    }
    
    // Update dash timer and cooldowns
    if (player.isDashing) {
      player.dashTimer -= deltaTime;
      if (player.dashTimer <= 0) {
        player.isDashing = false;
      }
    }
    
    if (player.dashCooldown > 0) {
      player.dashCooldown -= deltaTime;
    }
    
    // Update action cooldowns
    if (player.actionCooldowns.blebBurst > 0) {
      player.actionCooldowns.blebBurst -= deltaTime;
    }
    if (player.actionCooldowns.proteaseToggle > 0) {
      player.actionCooldowns.proteaseToggle -= deltaTime;
    }
    if (player.actionCooldowns.handbrake > 0) {
      player.actionCooldowns.handbrake -= deltaTime;
    }
  }

  /**
   * Process game action inputs that affect the game world (host only)
   */
  private processGameActions(input: ClientInput, player: NetworkPlayer): void {
    const scene = this.scene as any; // Access game scene for systems
    
    // Handle cargo pickup/drop (R key) - only for host player, clients use command system
    if (input.scoopDrop && player.id === 'host') {
      console.log(`🔄 HOST: Processing scoopDrop action for host player`);
      
      if (scene.unifiedCargoSystem && scene.getPlayerHexCoord) {
        // Get host player's hex position
        const playerHex = scene.getPlayerHexCoord();
        
        if (playerHex) {
          // Execute the same logic as the local input handler
          if (!scene.unifiedCargoSystem.isCarrying()) {
            const result = scene.unifiedCargoSystem.attemptPickup(playerHex);
            console.log(`📦 HOST: Pickup result for host: ${result.message}`);
          } else {
            const result = scene.unifiedCargoSystem.dropCargo(playerHex);
            console.log(`📦 HOST: Drop result for host: ${result.message}`);
          }
        } else {
          console.warn(`❌ HOST: Could not determine hex position for host player`);
        }
      } else {
        console.warn(`❌ HOST: UnifiedCargoSystem not available for processing scoopDrop`);
      }
    } else if (input.scoopDrop && player.id !== 'host') {
      // Client players should use the command system, this shouldn't happen
      console.warn(`⚠️ HOST: Client ${player.id} sent scoopDrop input - they should use command system instead`);
    }
    
    // Handle interaction (E key)
    if (input.interact) {
      console.log(`🔄 HOST: Processing interact action for player ${player.id}`);
      
      // TODO: Implement interaction processing
      // This would handle things like:
      // - Finishing construction
      // - Activating organelles
      // - Interacting with special objects
      console.log(`⚠️ HOST: Interact processing not yet implemented`);
    }
    
    // Handle throw actions
    if (input.throwRelease && input.throwCharge > 0) {
      console.log(`🔄 HOST: Processing throw action for player ${player.id} (charge: ${input.throwCharge})`);
      
      // TODO: Implement throw processing
      console.log(`⚠️ HOST: Throw processing not yet implemented`);
    }
  }

  /**
   * Create host snapshot
   */
  private createHostSnapshot(): HostSnapshot {
    // Use host network player state instead of real player state for consistency
    const hostPlayer: NetworkPlayer = this.hostNetworkPlayer!;
    const allPlayers = [hostPlayer, ...Array.from(this.connectedPlayers.values())];
    
    // Calculate the lowest acknowledged input sequence across all players
    // This ensures we don't acknowledge inputs that haven't been processed for all players
    let globalAckSeq = 0;
    if (this.lastProcessedInputs.size > 0) {
      globalAckSeq = Math.min(...Array.from(this.lastProcessedInputs.values()));
    }
    
    // Debug logging for connected players (reduced frequency)
    if (this.currentTick % 100 === 0) {
      console.log(`📋 HOST: Snapshot with ${allPlayers.length} players (${this.connectedPlayers.size} connected), ackSeq: ${globalAckSeq}`);
      allPlayers.forEach(player => {
        console.log(`  - ${player.id}: pos(${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)}) vel(${player.vel.x.toFixed(1)}, ${player.vel.y.toFixed(1)})`);
      });
    }
    
    const snapshot: HostSnapshot = {
      tick: this.currentTick,
      timestamp: Date.now(),
      ackSeq: globalAckSeq, // Use proper acknowledgment sequence
      
      players: allPlayers,
      
      // Entity replication - full state for now (TODO: optimize with deltas)
      cargo: this.entityReplicator.serializeCargo(),
      seats: this.entityReplicator.serializeSeats(),
      organelles: this.entityReplicator.serializeOrganelles(),
      blueprints: this.entityReplicator.serializeBlueprints(),
      species: this.entityReplicator.serializeSpecies(),
      membraneProteins: this.entityReplicator.serializeMembraneProteins(),
      
      // Delta updates for performance
      railsDelta: {
        added: this.entityReplicator.serializeRails(),
        removed: [],
        updated: []
      }
    };
    
    return snapshot;
  }
  
  /**
   * Broadcast snapshot to all clients
   */
  private broadcastSnapshot(snapshot: HostSnapshot): void {
    const message: NetworkMessage = {
      type: 'snapshot',
      data: snapshot,
      timestamp: Date.now()
    };
    
    // Only log every 50th tick to reduce spam
    if (this.currentTick % 50 === 0) {
      console.log('🚀 HOST: Broadcasting snapshot message:', {
        type: message.type,
        cargoCount: snapshot.cargo.length,
        seatCount: snapshot.seats.length,
        tick: snapshot.tick
      });
    }
    
    try {
      this.transport.sendReliable(message);
      // Only log success every 50th tick to reduce spam
      if (this.currentTick % 50 === 0) {
        console.log('✅ HOST: Snapshot sent successfully');
      }
    } catch (error) {
      console.error('❌ HOST: Failed to send snapshot:', error);
    }
    
    this.status.lastSnapshot = Date.now();
  }
  
  /**
   * Handle incoming host snapshot (client only)
   */
  private handleHostSnapshot(snapshot: HostSnapshot): void {
    if (this.isHost) return;
    
    // Only log every 50th snapshot to reduce spam
    if (snapshot.tick % 50 === 0) {
      console.log(`📥 CLIENT: Received snapshot tick ${snapshot.tick}, ack ${snapshot.ackSeq}`, {
        cargoCount: snapshot.cargo.length,
        seatCount: snapshot.seats.length,
        playerCount: snapshot.players.length
      });
      
      // Debug: Show all players in snapshot
      snapshot.players.forEach(player => {
        console.log(`  Player ${player.id}: pos(${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)})`);
      });
    }
    
    // Update acknowledged input sequence
    this.lastAckedInput = snapshot.ackSeq;
    
    // Apply snapshot to game state
    this.applySnapshot(snapshot);
    
    // Client prediction disabled - using server authoritative movement only
    // if (this.clientPrediction) {
    //   this.clientPrediction.reconcile(snapshot);
    // }
    
    this.status.lastSnapshot = Date.now();
  }
  
  /**
   * Apply snapshot to game state
   */
  private applySnapshot(snapshot: HostSnapshot): void {
    // Update all players, including local client player
    for (const networkPlayer of snapshot.players) {
      if (networkPlayer.id === this.status.playerId) {
        // Update local player position from server
        this.updateLocalPlayer(networkPlayer);
      } else {
        // Update remote players
        this.updateRemotePlayer(networkPlayer);
      }
    }
    
    // Apply entity updates
    this.entityReplicator.applyCargo(snapshot.cargo);
    this.entityReplicator.applySeats(snapshot.seats);
    this.entityReplicator.applyOrganelles(snapshot.organelles);
    this.entityReplicator.applyBlueprints(snapshot.blueprints);
    this.entityReplicator.applySpecies(snapshot.species);
    this.entityReplicator.applyMembraneProteins(snapshot.membraneProteins);
    
    // Handle cargo removal - remove any cargo that exists locally but not in the snapshot
    this.handleCargoRemoval(snapshot.cargo);
    
    // Debug logging for entity replication (reduced frequency)
    if (snapshot.tick % 50 === 0) {
      console.log(`📦 Applied entity snapshot: ${snapshot.cargo.length} cargo, ${snapshot.seats.length} seats, ${snapshot.organelles.length} organelles, ${snapshot.blueprints.length} blueprints, ${snapshot.species.tiles.length} species tiles, ${snapshot.membraneProteins.length} membrane proteins`);
    }
    
    // Check if we need to integrate a pending pickup after snapshot processing
    if (this.pendingPickupIntegration) {
      this.pendingPickupIntegration = false;
      this.integrateMultiplayerPickupWithLocalSystem();
    }
    
    // Apply delta updates if present
    if (snapshot.railsDelta) {
      // Only log rail changes every 100th tick or when there are actual changes to reduce spam
      if ((snapshot.railsDelta.added.length > 0 || snapshot.railsDelta.removed.length > 0) && snapshot.tick % 100 === 0) {
        console.log(`🚄 Rail delta: ${snapshot.railsDelta.added.length} added, ${snapshot.railsDelta.removed.length} removed`);
      }
      this.entityReplicator.applyRails(snapshot.railsDelta);
    }
  }
  
  /**
   * Handle cargo removal - remove any cargo that exists locally but not in the host snapshot
   */
  private handleCargoRemoval(networkCargo: NetworkCargo[]): void {
    if (!this.worldRefs) return;
    
    // Create a set of cargo IDs that exist in the network snapshot
    const networkCargoIds = new Set(networkCargo.map(c => c.id));
    
    // Find local cargo that's missing from the network snapshot
    const removedIds: string[] = [];
    
    // Check transcripts
    for (const [id] of this.worldRefs.transcripts) {
      if (!networkCargoIds.has(id)) {
        removedIds.push(id);
      }
    }
    
    // Check carried transcripts
    for (const transcript of this.worldRefs.carriedTranscripts) {
      if (!networkCargoIds.has(transcript.id)) {
        removedIds.push(transcript.id);
      }
    }
    
    // Check vesicles
    for (const [id] of this.worldRefs.vesicles) {
      if (!networkCargoIds.has(id)) {
        removedIds.push(id);
      }
    }
    
    // Check carried vesicles
    for (const vesicle of this.worldRefs.carriedVesicles) {
      if (!networkCargoIds.has(vesicle.id)) {
        removedIds.push(vesicle.id);
      }
    }
    
    // Remove the cargo that's no longer present on the host
    if (removedIds.length > 0) {
      console.log(`🧪 [CLIENT] Removing ${removedIds.length} cargo entities that completed installation or expired on host`);
      this.entityReplicator.removeCargoEntities(removedIds);
    }
  }

  /**
   * Apply visual updates for host (show connected client players)
   */
  private applyHostVisualUpdates(snapshot: HostSnapshot): void {
    // Host needs to visually show all connected client players
    for (const networkPlayer of snapshot.players) {
      // Skip the host player itself, only show connected clients
      if (networkPlayer.id !== this.hostPlayerId) {
        this.updateRemotePlayer(networkPlayer);
        
        // Log occasionally to confirm host is updating client visuals
        if (this.currentTick % 100 === 0) {
          console.log(`🏠 HOST: Visually updating client ${networkPlayer.id} at (${networkPlayer.pos.x.toFixed(1)}, ${networkPlayer.pos.y.toFixed(1)})`);
        }
      }
    }
  }

  /**
   * Apply network-controlled cargo visual updates for the host
   * This ensures the host sees cargo carried by remote players without affecting local game state
   */
  private applyNetworkCargoVisuals(snapshot: HostSnapshot): void {
    // Only apply cargo that's carried by remote players (not the host)
    const networkControlledCargo = snapshot.cargo.filter(cargo => 
      cargo.state === 'carried' && cargo.carrierId && cargo.carrierId !== 'host'
    );
    
    if (networkControlledCargo.length > 0) {
      console.log(`🔄 HOST: Applying visuals for ${networkControlledCargo.length} network-controlled cargo items`);
      
      // Apply only the network-controlled cargo for positioning
      this.entityReplicator.applyCargo(networkControlledCargo);
    }
  }

  /**
   * Update local player position from server snapshot
   */
  private updateLocalPlayer(networkPlayer: NetworkPlayer): void {
    // Get the sprite from the player container
    const sprite = (this.player as any).sprite;
    if (sprite && sprite.body) {
      // Update sprite position and velocity directly
      sprite.setPosition(networkPlayer.pos.x, networkPlayer.pos.y);
      sprite.setVelocity(networkPlayer.vel.x, networkPlayer.vel.y);
    }
    
    // Update dash state
    if ((this.player as any).isDashing !== networkPlayer.isDashing) {
      (this.player as any).isDashing = networkPlayer.isDashing;
    }
    if ((this.player as any).dashCooldown !== networkPlayer.dashCooldown) {
      (this.player as any).dashCooldown = networkPlayer.dashCooldown;
    }
    
    // Call the sync method to update ring and cargo indicator positions
    if (typeof (this.player as any).syncVisualComponents === 'function') {
      (this.player as any).syncVisualComponents();
    }
  }

  /**
   * Update remote player visual representation
   */
  private updateRemotePlayer(networkPlayer: NetworkPlayer): void {
    // Only log very occasionally to reduce spam
    if (Math.random() < 0.01) {
      console.log(`Updating remote player ${networkPlayer.id} at (${networkPlayer.pos.x.toFixed(1)}, ${networkPlayer.pos.y.toFixed(1)})`);
    }
    
    // Get or create remote player sprite
    let remoteSprite = this.remotePlayers.get(networkPlayer.id);
    if (!remoteSprite) {
      // Create a proper player sprite similar to local player but different color
      const graphics = this.scene.add.graphics();
      
      // Draw a filled circle (player body) - orange for remote players
      // Center the circle at (9,9) so it's not clipped when positioned at (0,0)
      graphics.fillStyle(0xff8800); // Orange color for remote players
      graphics.fillCircle(9, 9, 7); // Center at (9,9) with radius 7
      
      // Add a small ring around it for better visibility
      graphics.lineStyle(1, 0xffaa44); // Lighter orange ring
      graphics.strokeCircle(9, 9, 8); // Center at (9,9) with radius 8
      
      const key = `remote_player_${networkPlayer.id}`;
      graphics.generateTexture(key, 18, 18); // 18x18 texture
      graphics.destroy();
      
      // Create new remote player sprite with the generated texture
      remoteSprite = this.scene.add.sprite(
        networkPlayer.pos.x, 
        networkPlayer.pos.y, 
        key
      );
      
      // Add remote player to cellRoot container (same as local player)
      if (this.worldRefs.cellRoot) {
        this.worldRefs.cellRoot.add(remoteSprite);
      }
      
      this.remotePlayers.set(networkPlayer.id, remoteSprite);
      
      console.log(`Created remote player sprite for ${networkPlayer.id}`);
    } else {
      // Update existing sprite position
      remoteSprite.setPosition(networkPlayer.pos.x, networkPlayer.pos.y);
    }
  }
  
  /**
   * Create network player state
   */
  private createNetworkPlayer(playerId: string): NetworkPlayer {
    // For the main players (host and first client), start at center
    // Only offset additional clients joining an existing game
    let spawnX = 0;
    let spawnY = 0;
    
    // Only apply spawn offset if there are already multiple players in the game
    const existingPlayerCount = this.connectedPlayers.size;
    if (playerId !== this.hostPlayerId && existingPlayerCount > 0) {
      // Additional clients spawn at different locations around the cell to avoid overlap
      const angle = (existingPlayerCount * Math.PI * 2) / 4; // Spread around circle
      const spawnRadius = 60; // Spawn 60 pixels from center
      spawnX = Math.cos(angle) * spawnRadius;
      spawnY = Math.sin(angle) * spawnRadius;
      
      console.log(`🎯 HOST: Spawning additional client ${playerId} at (${spawnX.toFixed(1)}, ${spawnY.toFixed(1)})`);
    } else {
      console.log(`🎯 HOST: Spawning player ${playerId} at center (0.0, 0.0)`);
    }
    
    return {
      id: playerId,
      pos: { x: spawnX, y: spawnY },
      vel: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      
      // Movement mechanics state
      isDashing: false,
      dashTimer: 0,
      dashCooldown: 0,
      
      // CellMotility state
      driveMode: false,
      motilityMode: 'default',
      
      // Action states
      actionCooldowns: {
        blebBurst: 0,
        proteaseToggle: 0,
        handbrake: 0
      },
      
      health: 100
    };
  }

  /**
   * Handle player join
   */
  private handlePlayerJoin(playerId: string): void {
    console.log(`Player ${playerId} joined`);
    
    if (this.isHost) {
      const playerState = this.createNetworkPlayer(playerId);
      this.connectedPlayers.set(playerId, playerState);
    }
  }
  
  /**
   * Handle player leave
   */
  private handlePlayerLeave(playerId: string): void {
    console.log(`Player ${playerId} left`);
    
    if (this.isHost) {
      this.connectedPlayers.delete(playerId);
    }
  }
  
  /**
   * Send input rejection
   */
  private sendInputRejection(playerId: string, seq: InputSeq, reason: string): void {
    const command: HostCommand = {
      type: 'reject',
      action: 'build', // Generic action for input rejection
      data: { seq },
      reason
    };
    
    const message: NetworkMessage = {
      type: 'command',
      playerId,
      data: command,
      timestamp: Date.now()
    };
    
    this.transport.sendReliable(message);
  }
  
  /**
   * Send command from client to host (client only)
   */
  sendClientCommand(action: ClientCommand['action'], data: any): string {
    if (this.isHost) {
      console.warn('Cannot send client command - this is the host');
      return '';
    }

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const command: ClientCommand = {
      commandId,
      action,
      data
    };

    const message: NetworkMessage = {
      type: 'clientCommand',
      playerId: 'client', // TODO: Use actual client ID
      data: command,
      timestamp: Date.now()
    };

    this.transport.sendReliable(message);
    console.log(`📤 CLIENT: Sent command ${action} with ID ${commandId}`);
    return commandId;
  }

  /**
   * Handle client command (host only)
   */
  private handleClientCommand(playerId: string, command: ClientCommand): void {
    if (!this.isHost) return;

    // Check for duplicate command
    if (this.processedCommandIds.has(command.commandId)) {
      console.log(`🔄 HOST: Ignoring duplicate command ${command.action} from ${playerId} (ID: ${command.commandId})`);
      return;
    }

    // Add to processed commands set
    this.processedCommandIds.add(command.commandId);

    // Limit memory usage by removing old command IDs
    if (this.processedCommandIds.size > this.MAX_PROCESSED_COMMANDS) {
      const oldestIds = Array.from(this.processedCommandIds).slice(0, this.MAX_PROCESSED_COMMANDS / 2);
      oldestIds.forEach(id => this.processedCommandIds.delete(id));
    }

    console.log(`📥 HOST: Received command ${command.action} from ${playerId}`);

    // Validate and process the command
    try {
      switch (command.action) {
        case 'buildBlueprint':
          this.handleBuildBlueprintCommand(playerId, command);
          break;
        case 'injectSpecies':
          this.handleInjectSpeciesCommand(playerId, command);
          break;
        case 'cargoPickup':
          this.handleCargoPickupCommand(playerId, command);
          break;
        case 'cargoDrop':
          this.handleCargoDropCommand(playerId, command);
          break;
        case 'cargoThrow':
          this.handleCargoThrowCommand(playerId, command);
          break;
        case 'buildFilament':
          this.handleBuildFilamentCommand(playerId, command);
          break;
        case 'finishConstruction':
          this.handleFinishConstructionCommand(playerId, command);
          break;
        case 'installOrder':
          this.handleInstallOrderCommand(playerId, command);
          break;
        default:
          this.sendCommandResponse(playerId, command.commandId, 'reject', command.action as any, undefined, `Unknown command: ${command.action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ HOST: Error processing command ${command.action}:`, error);
      this.sendCommandResponse(playerId, command.commandId, 'reject', command.action as any, undefined, `Internal error: ${errorMessage}`);
    }
  }

  /**
   * Send command response from host to client
   */
  private sendCommandResponse(playerId: string, commandId: string, type: 'confirm' | 'reject', action: HostCommand['action'], data?: any, reason?: string): void {
    const response: HostCommand = {
      type,
      commandId,
      action,
      data,
      reason
    };

    const message: NetworkMessage = {
      type: 'command',
      playerId,
      data: response,
      timestamp: Date.now()
    };

    this.transport.sendReliable(message);
    
    if (type === 'reject') {
      console.warn(`❌ HOST: Rejected ${action} for ${playerId}: ${reason}`);
    } else {
      console.log(`✅ HOST: Confirmed ${action} for ${playerId}`);
    }
  }

  /**
   * Placeholder command handlers - to be implemented for each action type
   */
  private handleBuildBlueprintCommand(playerId: string, command: ClientCommand): void {
    const { recipeId, hex } = command.data;
    
    console.log(`📥 HOST: Received blueprint build request from ${playerId}: ${recipeId} at (${hex.q}, ${hex.r})`);
    
    // Validate the blueprint placement
    const validation = this.worldRefs.blueprintSystem.validatePlacement(recipeId, hex.q, hex.r);
    
    if (!validation.isValid) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'build', undefined, `Blueprint placement failed: ${validation.errors.join('; ')}`);
      return;
    }
    
    // Place the blueprint on the host
    const result = this.worldRefs.blueprintSystem.placeBlueprint(recipeId, hex.q, hex.r);
    
    if (result.success) {
      console.log(`🏗️ HOST: Successfully placed ${recipeId} blueprint at (${hex.q}, ${hex.r}) for ${playerId}`);
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'build', {
        recipeId,
        hex,
        blueprintId: result.blueprintId
      }, `${recipeId} blueprint placed successfully`);
    } else {
      console.warn(`🏗️ HOST: Failed to place ${recipeId} blueprint at (${hex.q}, ${hex.r}) for ${playerId}: ${result.error}`);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'build', undefined, result.error || 'Unknown blueprint placement error');
    }
  }

  private handleInjectSpeciesCommand(playerId: string, command: ClientCommand): void {
    const { speciesId, amount, hex } = command.data;
    
    console.log(`📥 HOST: Received species injection request from ${playerId}: ${amount} ${speciesId} at (${hex.q}, ${hex.r})`);
    
    // Validate species ID (get list from species registry)
    const validSpeciesIds = ['ATP', 'AA', 'NT', 'ROS', 'GLUCOSE', 'PRE_MRNA', 'PROTEIN', 'CARGO', 'SIGNAL'];
    
    if (!validSpeciesIds.includes(speciesId)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'injectSpecies', undefined, 'Invalid species type');
      return;
    }
    
    // Validate amount
    if (typeof amount !== 'number' || amount <= 0 || amount > 100) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'injectSpecies', undefined, 'Invalid injection amount (must be 1-100)');
      return;
    }
    
    // Validate hex coordinates
    if (typeof hex.q !== 'number' || typeof hex.r !== 'number') {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'injectSpecies', undefined, 'Invalid hex coordinates');
      return;
    }
    
    // Check if hex is a valid tile
    const tile = this.worldRefs.hexGrid.getTile(hex);
    if (!tile) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'injectSpecies', undefined, 'Invalid tile coordinates');
      return;
    }
    
    // All validation passed - inject the species
    try {
      this.worldRefs.hexGrid.addConcentration(hex, speciesId as any, amount);
      
      // Show success message
      this.worldRefs.showToast(`${playerId} injected ${amount} ${speciesId} at (${hex.q}, ${hex.r})`);
      
      // Send confirmation response
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'injectSpecies', {
        speciesId,
        amount,
        hex
      });
      
      console.log(`✅ HOST: Injected ${amount} ${speciesId} at (${hex.q}, ${hex.r}) for ${playerId}`);
      
    } catch (error) {
      console.error('Failed to inject species:', error);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'injectSpecies', undefined, 'Failed to inject species');
    }
  }

  private handleCargoPickupCommand(playerId: string, command: ClientCommand): void {
    const scene = this.scene as any;
    const { playerHex } = command.data;
    
    if (!playerHex) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'pickup', undefined, 'Invalid pickup request');
      return;
    }
    
    // Get the network player state
    let networkPlayer: NetworkPlayer | undefined;
    if (playerId === 'host') {
      networkPlayer = this.hostNetworkPlayer;
    } else {
      networkPlayer = this.connectedPlayers.get(playerId);
    }
    
    if (!networkPlayer) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'pickup', undefined, 'Player not found');
      return;
    }
    
    // Calculate player's actual hex position using the correct method name
    const actualPlayerHex = scene.hexGrid?.worldToHex(networkPlayer.pos.x, networkPlayer.pos.y);
    
    // Relax position validation to allow for small network discrepancies
    // Allow pickup if player is within 1 hex of the requested position
    if (!actualPlayerHex) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'pickup', undefined, 'Could not determine player position');
      return;
    }
    
    const hexDistance = Math.max(
      Math.abs(actualPlayerHex.q - playerHex.q),
      Math.abs(actualPlayerHex.r - playerHex.r),
      Math.abs((actualPlayerHex.q + actualPlayerHex.r) - (playerHex.q + playerHex.r))
    );
    
    if (hexDistance > 1) {
      console.log(`🔍 HOST: Position validation failed - expected (${playerHex.q}, ${playerHex.r}), actual (${actualPlayerHex.q}, ${actualPlayerHex.r}), distance: ${hexDistance}`);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'pickup', undefined, 'Too far from pickup location');
      return;
    }
    
    // Check if player is already carrying something (multiplayer-aware)
    if (this.playerCarriedCargo.has(playerId)) {
      const carried = this.playerCarriedCargo.get(playerId)!;
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'pickup', undefined, `Already carrying ${carried.type}`);
      return;
    }
    
    // Attempt pickup using direct cargo manipulation (not UnifiedCargoSystem)
    const result = this.attemptMultiplayerPickup(playerId, playerHex);
    if (result.success) {
      console.log(`📦 HOST: Cargo pickup successful for ${playerId}: ${result.message}`);
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'pickup', { 
        message: result.message, 
        playerHex 
      });
    } else {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'pickup', undefined, result.message);
    }
  }

  /**
   * Multiplayer-aware cargo pickup that properly tracks which player is carrying what
   */
  private attemptMultiplayerPickup(playerId: string, playerHex: { q: number; r: number }): { success: boolean; message: string } {
    // Try to pick up transcript first
    const transcript = this.findTranscriptAt(playerHex);
    if (transcript) {
      return this.pickupTranscriptForPlayer(playerId, transcript);
    }
    
    // Try to pick up vesicle
    const vesicle = this.findVesicleAt(playerHex);
    if (vesicle) {
      return this.pickupVesicleForPlayer(playerId, vesicle);
    }
    
    return { 
      success: false, 
      message: "No cargo available here" 
    };
  }

  /**
   * Find transcript at hex location (replicates UnifiedCargoSystem logic)
   */
  private findTranscriptAt(hex: { q: number; r: number }): Transcript | null {
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.atHex.q === hex.q && transcript.atHex.r === hex.r && !transcript.isCarried) {
        return transcript;
      }
    }
    return null;
  }

  /**
   * Find vesicle at hex location (replicates UnifiedCargoSystem logic)
   */
  private findVesicleAt(hex: { q: number; r: number }): Vesicle | null {
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.atHex.q === hex.q && vesicle.atHex.r === hex.r && !vesicle.isCarried) {
        return vesicle;
      }
    }
    return null;
  }

  /**
   * Pick up transcript for specific player (replicates UnifiedCargoSystem logic)
   */
  private pickupTranscriptForPlayer(playerId: string, transcript: Transcript): { success: boolean; message: string } {
    // Remove from world collections
    this.worldRefs.transcripts.delete(transcript.id);
    this.removeFromCarriedTranscripts(transcript.id);
    
    // Mark as carried
    transcript.isCarried = true;
    
    // Add to carried transcripts array for serialization
    this.worldRefs.carriedTranscripts.push(transcript);
    
    // Track in our multiplayer cargo system
    this.playerCarriedCargo.set(playerId, {
      type: 'transcript',
      item: transcript,
      pickedUpAt: this.scene.time.now
    });
    
    return { 
      success: true, 
      message: `Picked up ${transcript.proteinId} transcript` 
    };
  }

  /**
   * Pick up vesicle for specific player (replicates UnifiedCargoSystem logic)
   */
  private pickupVesicleForPlayer(playerId: string, vesicle: Vesicle): { success: boolean; message: string } {
    // Remove from world collections
    this.worldRefs.vesicles.delete(vesicle.id);
    this.removeFromCarriedVesicles(vesicle.id);
    
    // Mark as carried
    vesicle.isCarried = true;
    
    // Add to carried vesicles array for serialization
    this.worldRefs.carriedVesicles.push(vesicle);
    
    // Track in our multiplayer cargo system
    this.playerCarriedCargo.set(playerId, {
      type: 'vesicle',
      item: vesicle,
      pickedUpAt: this.scene.time.now
    });
    
    return { 
      success: true, 
      message: `Picked up ${vesicle.proteinId} vesicle (${vesicle.glyco})` 
    };
  }

  /**
   * Remove transcript from carried list (replicates UnifiedCargoSystem logic)
   */
  private removeFromCarriedTranscripts(transcriptId: string): void {
    const index = this.worldRefs.carriedTranscripts.findIndex(t => t.id === transcriptId);
    if (index !== -1) {
      this.worldRefs.carriedTranscripts.splice(index, 1);
    }
  }

  /**
   * Remove vesicle from carried list (replicates UnifiedCargoSystem logic)
   */
  private removeFromCarriedVesicles(vesicleId: string): void {
    const index = this.worldRefs.carriedVesicles.findIndex(v => v.id === vesicleId);
    if (index !== -1) {
      this.worldRefs.carriedVesicles.splice(index, 1);
    }
  }

  private handleCargoDropCommand(playerId: string, command: ClientCommand): void {
    const scene = this.scene as any;
    const { playerHex } = command.data;
    
    if (!playerHex) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'drop', undefined, 'Invalid drop request');
      return;
    }
    
    // Get the network player state
    let networkPlayer: NetworkPlayer | undefined;
    if (playerId === 'host') {
      networkPlayer = this.hostNetworkPlayer;
    } else {
      networkPlayer = this.connectedPlayers.get(playerId);
    }
    
    if (!networkPlayer) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'drop', undefined, 'Player not found');
      return;
    }
    
    // Calculate player's actual hex position using the correct method name
    const actualPlayerHex = scene.hexGrid?.worldToHex(networkPlayer.pos.x, networkPlayer.pos.y);
    
    // Relax position validation to allow for small network discrepancies
    // Allow drop if player is within 1 hex of the requested position
    if (!actualPlayerHex) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'drop', undefined, 'Could not determine player position');
      return;
    }
    
    const hexDistance = Math.max(
      Math.abs(actualPlayerHex.q - playerHex.q),
      Math.abs(actualPlayerHex.r - playerHex.r),
      Math.abs((actualPlayerHex.q + actualPlayerHex.r) - (playerHex.q + playerHex.r))
    );
    
    if (hexDistance > 1) {
      console.log(`🔍 HOST: Position validation failed - expected (${playerHex.q}, ${playerHex.r}), actual (${actualPlayerHex.q}, ${actualPlayerHex.r}), distance: ${hexDistance}`);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'drop', undefined, 'Too far from drop location');
      return;
    }
    
    // Check if player is carrying something (multiplayer-aware)
    if (!this.playerCarriedCargo.has(playerId)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'drop', undefined, 'Not carrying anything');
      return;
    }
    
    // Attempt drop using direct cargo manipulation (not UnifiedCargoSystem)
    const result = this.attemptMultiplayerDrop(playerId, playerHex);
    if (result.success) {
      console.log(`📦 HOST: Cargo drop successful for ${playerId}: ${result.message}`);
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'drop', { 
        message: result.message, 
        playerHex 
      });
    } else {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'drop', undefined, result.message);
    }
  }

  /**
   * Multiplayer-aware cargo drop that properly handles player-specific cargo
   */
  private attemptMultiplayerDrop(playerId: string, playerHex: { q: number; r: number }): { success: boolean; message: string } {
    const carriedCargo = this.playerCarriedCargo.get(playerId);
    if (!carriedCargo) {
      return {
        success: false,
        message: "Not carrying anything"
      };
    }
    
    const cargo = carriedCargo.item;
    
    // Update cargo position and state
    cargo.isCarried = false;
    cargo.atHex = { q: playerHex.q, r: playerHex.r };
    cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(playerHex).clone();
    
    // Return cargo to appropriate world collection
    if (carriedCargo.type === 'transcript') {
      this.worldRefs.transcripts.set(cargo.id, cargo as Transcript);
      // Remove from carried list if it was there
      this.removeFromCarriedTranscripts(cargo.id);
    } else {
      this.worldRefs.vesicles.set(cargo.id, cargo as Vesicle);
      // Remove from carried list if it was there
      this.removeFromCarriedVesicles(cargo.id);
    }
    
    // Remove from multiplayer cargo tracking
    this.playerCarriedCargo.delete(playerId);
    
    const carriedDuration = (this.scene.time.now - carriedCargo.pickedUpAt) / 1000;
    return {
      success: true,
      message: `Dropped ${carriedCargo.type} (carried ${carriedDuration.toFixed(1)}s)`
    };
  }

  private handleCargoThrowCommand(playerId: string, command: ClientCommand): void {
    // Validate that the player is carrying something
    if (!this.playerCarriedCargo.has(playerId)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'throw', undefined, 'Not carrying anything');
      return;
    }

    // Get throw parameters from command data
    const throwData = command.data;
    if (!throwData || !throwData.direction || !throwData.chargeLevel) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'throw', undefined, 'Invalid throw data');
      return;
    }

    console.log(`🎯 HOST: Processing throw command from ${playerId} with charge ${(throwData.chargeLevel * 100).toFixed(1)}%`);

    // Execute the throw on the host's throw system
    const result = this.executeHostThrow(playerId, throwData);
    
    if (result.success) {
      console.log(`🎯 HOST: Throw successful for ${playerId}: ${result.message}`);
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'throw', { 
        message: result.message 
      });
    } else {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'throw', undefined, result.message);
    }
  }

  /**
   * Execute throw on host for a specific player
   */
  private executeHostThrow(playerId: string, throwData: any): { success: boolean; message: string } {
    const carriedCargo = this.playerCarriedCargo.get(playerId);
    if (!carriedCargo) {
      return { success: false, message: 'Player not carrying anything' };
    }

    // Get the throw system from the scene
    const scene = this.scene as any;
    if (!scene.throwSystem) {
      return { success: false, message: 'Throw system not available' };
    }

    // Get the client's throw parameters
    const chargeLevel = throwData.chargeLevel;
    const clientPlayerPos = new Phaser.Math.Vector2(throwData.playerPos.x, throwData.playerPos.y);

    // Get the carried cargo
    const cargo = carriedCargo.item;

    // Position the cargo at the client's position (not the host's position)
    cargo.worldPos.copy(clientPlayerPos);
    
    // Set up the throw system to execute the client's throw
    console.log(`🎯 HOST: Setting up throw system for client throw`);
    
    // First, set the cargo as carried in unified cargo system so ThrowSystem can find it
    const cargoItem = {
      type: carriedCargo.type,
      item: cargo,
      pickedUpAt: carriedCargo.pickedUpAt
    };
    scene.unifiedCargoSystem.setCarriedCargo(cargoItem);
    
    // Set up the throw system's aim state with the client's parameters
    const throwSystem = scene.throwSystem as any;
    throwSystem.aimState = {
      isAiming: true,
      startTime: Date.now() - (chargeLevel * 1000), // Simulate charge time
      targetPosition: new Phaser.Math.Vector2(
        clientPlayerPos.x + (throwData.direction.x * 100), 
        clientPlayerPos.y + (throwData.direction.y * 100)
      ),
      power: chargeLevel,
      chargeLevel: chargeLevel,
      showPreview: false
    };
    
    // Override the player position for this throw
    const originalGetPlayerPosition = throwSystem.getPlayerPosition;
    throwSystem.getPlayerPosition = () => clientPlayerPos;
    
    // Execute the throw using the throw system
    const success = scene.throwSystem.executeThrow();
    
    // Restore the original getPlayerPosition method
    throwSystem.getPlayerPosition = originalGetPlayerPosition;
    
    console.log(`🎯 HOST: Throw system execution result: ${success}`);
    console.log(`🎯 HOST: Applied throw physics from client position (${clientPlayerPos.x.toFixed(1)}, ${clientPlayerPos.y.toFixed(1)}) with charge ${(chargeLevel * 100).toFixed(1)}%`);

    if (success) {
      // Clear from multiplayer tracking since the cargo is now thrown
      this.playerCarriedCargo.delete(playerId);
      
      // Also remove from the world's carried arrays to prevent continued serialization
      if (carriedCargo.type === 'transcript') {
        const index = this.worldRefs.carriedTranscripts.findIndex(t => t.id === cargo.id);
        if (index !== -1) {
          this.worldRefs.carriedTranscripts.splice(index, 1);
          console.log(`🎯 HOST: Removed thrown transcript ${cargo.id} from carried array`);
        }
      } else if (carriedCargo.type === 'vesicle') {
        const index = this.worldRefs.carriedVesicles.findIndex(v => v.id === cargo.id);
        if (index !== -1) {
          this.worldRefs.carriedVesicles.splice(index, 1);
          console.log(`🎯 HOST: Removed thrown vesicle ${cargo.id} from carried array`);
        }
      }
      
      return { 
        success: true, 
        message: `Threw ${carriedCargo.type} with ${(chargeLevel * 100).toFixed(0)}% charge` 
      };
    } else {
      // Clear the temporary cargo if throw failed
      scene.unifiedCargoSystem.clearCarriedCargo();
      return { success: false, message: 'Failed to execute throw' };
    }
  }

  private handleBuildFilamentCommand(playerId: string, command: ClientCommand): void {
    const { filamentType, segments } = command.data;
    
    console.log(`📥 HOST: Received filament build request from ${playerId}: ${segments.length} ${filamentType} segment(s)`);
    
    // Validate filament type
    if (!['actin', 'microtubule'].includes(filamentType)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'Invalid filament type');
      return;
    }
    
    // Validate segments array
    if (!Array.isArray(segments) || segments.length === 0) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'No segments provided');
      return;
    }
    
    // Validate each segment has proper hex coordinates
    for (const segment of segments) {
      if (!segment.from || !segment.to || typeof segment.from.q !== 'number' || typeof segment.from.r !== 'number' || 
          typeof segment.to.q !== 'number' || typeof segment.to.r !== 'number') {
        this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'Invalid segment coordinates');
        return;
      }
    }
    
    // Get the filament builder for build config access
    const filamentBuilder = (this.scene as any).filamentBuilder;
    if (!filamentBuilder) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'Filament builder not available');
      return;
    }
    
    // Get build config for cost validation
    const buildConfig = filamentBuilder.BUILD_CONFIG;
    if (!buildConfig || !buildConfig[filamentType]) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'Invalid filament configuration');
      return;
    }
    
    const cost = buildConfig[filamentType].cost;
    const totalCost: Record<string, number> = {};
    
    // Calculate total cost for all segments
    for (const [resource, amount] of Object.entries(cost)) {
      totalCost[resource] = (totalCost[resource] || 0) + ((amount as number) * segments.length);
    }
    
    // All validation passed - create the filament blueprints
    // Note: Resources are not required to place blueprints, they just affect construction speed
    try {
      const cytoskeletonSystem = this.worldRefs.cytoskeletonSystem;
      const createdBlueprints: string[] = [];
      
      for (const segment of segments) {
        const blueprintId = cytoskeletonSystem.createFilamentBlueprint(
          filamentType,
          segment.from,
          segment.to
        );
        
        if (blueprintId) {
          createdBlueprints.push(blueprintId);
        }
      }
      
      if (createdBlueprints.length > 0) {
        // Show success message
        this.worldRefs.showToast(
          `Started building ${segments.length} ${filamentType} segment(s)`
        );
        
        // Send confirmation response
        this.sendCommandResponse(playerId, command.commandId, 'confirm', 'buildFilament', {
          filamentType,
          segmentCount: segments.length,
          blueprintIds: createdBlueprints
        });
        
        console.log(`✅ HOST: Created ${createdBlueprints.length} ${filamentType} blueprints for ${playerId}`);
      } else {
        this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'Failed to create filament blueprints');
      }
      
    } catch (error) {
      console.error('Failed to create filament blueprints:', error);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'buildFilament', undefined, 'Failed to create filament blueprints');
    }
  }

  private handleFinishConstructionCommand(playerId: string, command: ClientCommand): void {
    const { hex } = command.data;
    
    console.log(`📥 HOST: Received finish construction request from ${playerId} at (${hex.q}, ${hex.r})`);
    
    // Find blueprint at the specified location
    const blueprint = this.worldRefs.blueprintSystem.getBlueprintAtTile(hex.q, hex.r);
    
    if (!blueprint) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'finishConstruction', undefined, 'No blueprint found at this location');
      return;
    }
    
    // Complete the blueprint construction instantly
    const result = this.worldRefs.blueprintSystem.instantlyComplete(blueprint.id);
    
    if (result.success) {
      console.log(`🏗️ HOST: Instantly completed ${blueprint.recipeId} blueprint at (${hex.q}, ${hex.r}) for ${playerId}`);
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'finishConstruction', {
        recipeId: blueprint.recipeId,
        hex,
        blueprintId: blueprint.id
      }, `${blueprint.recipeId} construction completed instantly`);
    } else {
      console.warn(`🏗️ HOST: Failed to complete ${blueprint.recipeId} blueprint at (${hex.q}, ${hex.r}) for ${playerId}: ${result.error}`);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'finishConstruction', undefined, result.error || 'Unknown construction completion error');
    }
  }

  private handleInstallOrderCommand(playerId: string, command: ClientCommand): void {
    const { proteinId, destHex } = command.data;
    
    console.log(`📥 HOST: Received install order request from ${playerId}: ${proteinId} at (${destHex.q}, ${destHex.r})`);
    
    // Import the protein ID types
    const validProteinIds = ['GLUT', 'AA_TRANSPORTER', 'NT_TRANSPORTER', 'ROS_EXPORTER', 'SECRETION_PUMP', 'GROWTH_FACTOR_RECEPTOR'];
    
    // Validate protein ID
    if (!validProteinIds.includes(proteinId)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, 'Invalid protein type');
      return;
    }
    
    // Validate destination coordinates
    if (typeof destHex.q !== 'number' || typeof destHex.r !== 'number') {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, 'Invalid destination coordinates');
      return;
    }
    
    // Check if destination is a membrane tile
    if (!this.worldRefs.hexGrid.isMembraneCoord(destHex)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, 'Destination is not a membrane tile');
      return;
    }
    
    // Check if there's already a pending installation for this destination
    for (const order of this.worldRefs.installOrders.values()) {
      if (order.destHex.q === destHex.q && order.destHex.r === destHex.r) {
        this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, `Installation already pending for (${destHex.q}, ${destHex.r})`);
        return;
      }
    }
    
    // Check for transcripts heading to this destination
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.destHex && 
          transcript.destHex.q === destHex.q && 
          transcript.destHex.r === destHex.r) {
        this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, `Transcript already heading to (${destHex.q}, ${destHex.r})`);
        return;
      }
    }
    
    // Check for vesicles heading to this destination
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.destHex && 
          vesicle.destHex.q === destHex.q && 
          vesicle.destHex.r === destHex.r &&
          (vesicle.state === 'EN_ROUTE_MEMBRANE' || 
           vesicle.state === 'INSTALLING' ||
           vesicle.state === 'QUEUED_GOLGI' ||
           vesicle.state === 'EN_ROUTE_GOLGI')) {
        this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, `Vesicle already targeting (${destHex.q}, ${destHex.r})`);
        return;
      }
    }
    
    // Check if protein already installed at destination
    if (this.worldRefs.membraneExchangeSystem.hasInstalledProtein(destHex)) {
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, 'Protein already installed at this location');
      return;
    }
    
    // All validation passed - create the install order
    try {
      const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const order = {
        id: orderId,
        proteinId,
        destHex: { q: destHex.q, r: destHex.r },
        createdAt: Date.now()
      };
      
      this.worldRefs.installOrders.set(orderId, order);
      
      // Show success message
      this.worldRefs.showToast(`Requested ${proteinId} for (${destHex.q}, ${destHex.r})`);
      
      // Send confirmation response
      this.sendCommandResponse(playerId, command.commandId, 'confirm', 'installOrder', {
        proteinId,
        destHex,
        orderId
      });
      
      console.log(`✅ HOST: Created install order ${orderId} for ${proteinId} at (${destHex.q}, ${destHex.r}) from ${playerId}`);
      
    } catch (error) {
      console.error('Failed to create install order:', error);
      this.sendCommandResponse(playerId, command.commandId, 'reject', 'installOrder', undefined, 'Failed to create install order');
    }
  }

  /**
   * Handle host command (client only)
   */
  private handleHostCommand(command: HostCommand): void {
    // Only log rejections and important confirmations (not routine build confirmations)
    if (command.type === 'reject' || (command.type === 'confirm' && command.action !== 'build')) {
      console.log(`📥 CLIENT: Received host command: ${command.type} ${command.action}`);
    }
    
    const scene = this.scene as any;
    
    if (command.type === 'reject') {
      console.warn(`❌ CLIENT: Action rejected: ${command.reason}`);
      // Show user feedback for rejections
      if (scene.showToast) {
        scene.showToast(`Action failed: ${command.reason}`);
      }
    } else if (command.type === 'confirm') {
      // Handle successful actions
      if (command.action === 'pickup') {
        console.log(`✅ CLIENT: Cargo pickup confirmed`);
        // Mark that we're expecting to integrate a pickup in the next snapshot
        this.pendingPickupIntegration = true;
        if (scene.showToast && command.data?.message) {
          scene.showToast(command.data.message);
        }
      } else if (command.action === 'drop') {
        console.log(`✅ CLIENT: Cargo drop confirmed`);
        // Clear local carried cargo when drop is confirmed
        if (scene.unifiedCargoSystem) {
          scene.unifiedCargoSystem.clearCarriedCargo();
        }
        if (scene.showToast && command.data?.message) {
          scene.showToast(command.data.message);
        }
      } else if (command.action === 'throw') {
        console.log(`✅ CLIENT: Cargo throw confirmed`);
        // Now clear the local carried cargo since throw was successful
        if (scene.unifiedCargoSystem) {
          scene.unifiedCargoSystem.clearCarriedCargo();
        }
        // Clear the aiming state on the client since throw was confirmed
        if (scene.throwInputController) {
          console.log(`🎯 CLIENT: Canceling aiming after throw confirmation`);
          scene.throwInputController.cancelAiming();
        } else {
          console.log(`⚠️ CLIENT: throwInputController not available for aiming cancellation`);
        }
        // Also directly clear the ThrowSystem's aiming state and graphics
        if (scene.throwSystem) {
          console.log(`🎯 CLIENT: Also clearing ThrowSystem aiming state directly`);
          scene.throwSystem.cancelAiming();
        }
        if (scene.showToast && command.data?.message) {
          scene.showToast(command.data.message);
        }
      } else if (command.action === 'build') {
        console.log(`✅ CLIENT: Blueprint placement confirmed`);
        if (scene.showToast) {
          const data = command.data;
          if (data?.recipeId) {
            scene.showToast(`${data.recipeId} blueprint placed successfully`);
          } else {
            scene.showToast('Blueprint placed successfully');
          }
        }
      } else if (command.action === 'finishConstruction') {
        console.log(`✅ CLIENT: Construction completion confirmed`);
        if (scene.showToast) {
          const data = command.data;
          if (data?.recipeId) {
            scene.showToast(`${data.recipeId} construction completed instantly!`);
          } else {
            scene.showToast('Construction completed instantly!');
          }
        }
      } else if (command.action === 'buildFilament') {
        console.log(`✅ CLIENT: Filament placement confirmed`);
        if (scene.showToast) {
          const data = command.data;
          if (data?.filamentType && data?.segmentCount) {
            scene.showToast(`${data.segmentCount} ${data.filamentType} segment(s) placed successfully`);
          } else {
            scene.showToast('Filament placed successfully');
          }
        }
      }
    }
  }

  /**
   * Integrate multiplayer pickup with local UnifiedCargoSystem
   * This ensures that locally carried cargo is properly displayed
   */
  private integrateMultiplayerPickupWithLocalSystem(): void {
    if (this.isHost) return; // Only for clients
    
    console.log(`🔧 CLIENT: Attempting to integrate multiplayer pickup with local system`);
    
    const scene = this.scene as any;
    if (!scene.unifiedCargoSystem) {
      console.warn('🔧 CLIENT: No unifiedCargoSystem found to integrate pickup');
      return;
    }
    
    console.log(`🔧 CLIENT: Found unifiedCargoSystem, checking carried arrays...`);
    console.log(`🔧 CLIENT: Carried transcripts: ${this.worldRefs.carriedTranscripts.length}, Carried vesicles: ${this.worldRefs.carriedVesicles.length}`);
    
    // Find the carried cargo that was just picked up by checking carried arrays
    const carriedTranscript = this.worldRefs.carriedTranscripts.find(t => 
      t.isCarried && !t.isNetworkControlled
    );
    const carriedVesicle = this.worldRefs.carriedVesicles.find(v => 
      v.isCarried && !v.isNetworkControlled
    );
    
    console.log(`🔧 CLIENT: Found locally owned transcript: ${carriedTranscript?.id || 'none'}`);
    console.log(`🔧 CLIENT: Found locally owned vesicle: ${carriedVesicle?.id || 'none'}`);
    
    if (carriedTranscript) {
      // Set the carried cargo in UnifiedCargoSystem for proper positioning
      scene.unifiedCargoSystem.setCarriedCargo({
        type: 'transcript',
        item: carriedTranscript,
        pickedUpAt: this.scene.time.now
      });
      console.log(`🔧 CLIENT: Integrated transcript ${carriedTranscript.id} with local cargo system`);
    } else if (carriedVesicle) {
      scene.unifiedCargoSystem.setCarriedCargo({
        type: 'vesicle',
        item: carriedVesicle,
        pickedUpAt: this.scene.time.now
      });
      console.log(`🔧 CLIENT: Integrated vesicle ${carriedVesicle.id} with local cargo system`);
    } else {
      console.warn(`🔧 CLIENT: No locally owned cargo found to integrate`);
    }
  }

  /**
   * Clean up old input buffer entries
   */
  private cleanupInputBuffer(): void {
    const cutoff = this.inputSequence - this.MAX_INPUT_BUFFER;
    
    for (const [seq] of this.inputBuffer) {
      if (seq < cutoff) {
        this.inputBuffer.delete(seq);
      }
    }
  }
  
  /**
   * Get remote player sprite for positioning cargo (EntityReplicator access)
   */
  public getRemotePlayerSprite(playerId: string): Phaser.GameObjects.Sprite | undefined {
    return this.remotePlayers.get(playerId);
  }

  /**
   * Get all remote player IDs
   */
  public getRemotePlayerIds(): string[] {
    return Array.from(this.remotePlayers.keys());
  }

  /**
   * Get current network status
   */
  public getStatus(): NetworkStatus {
    return { ...this.status };
  }
  
  /**
   * Check if this instance is the host
   */
  public getIsHost(): boolean {
    return this.isHost;
  }
  
  /**
   * Send command to host for validation and execution (client only)
   * Returns command ID for tracking responses
   */
  public requestAction(action: ClientCommand['action'], data: any): string | null {
    if (this.isHost) {
      console.warn('❌ Cannot request action - this is the host');
      return null;
    }
    
    return this.sendClientCommand(action, data);
  }
  
  /**
   * Get entity replication statistics for debugging
   */
  public getEntityStats(): { 
    cargoCount: number; 
    seatCount: number; 
    railCount: number;
    organelleCount: number;
    blueprintCount: number;
    speciesTileCount: number;
  } {
    const cargo = this.entityReplicator.serializeCargo();
    const seats = this.entityReplicator.serializeSeats();
    const rails = this.entityReplicator.serializeRails();
    const organelles = this.entityReplicator.serializeOrganelles();
    const blueprints = this.entityReplicator.serializeBlueprints();
    const species = this.entityReplicator.serializeSpecies();
    
    return {
      cargoCount: cargo.length,
      seatCount: seats.length,
      railCount: rails.length,
      organelleCount: organelles.length,
      blueprintCount: blueprints.length,
      speciesTileCount: species.tiles.length
    };
  }

  /**
   * Get prediction statistics for debugging
   */
  public getPredictionStats() {
    if (this.clientPrediction) {
      return this.clientPrediction.getStats();
    }
    
    return {
      inputBufferSize: this.inputBuffer.size,
      snapshotCount: 0,
      lastAckedInput: this.lastAckedInput,
      unackedInputs: Array.from(this.inputBuffer.keys()).filter(seq => seq > this.lastAckedInput).length
    };
  }
  
  /**
   * Log system startup information
   */
  private logStartup(): void {
    console.log('=== NetSyncSystem Startup ===');
    console.log(`Mode: ${this.isHost ? 'HOST' : 'CLIENT'}`);
    console.log(`Tick Rate: ${this.TICK_RATE}Hz`);
    console.log(`Player ID: ${this.status.playerId}`);
    console.log(`Channels: reliable + unreliable`);
    console.log('===============================');
  }
}
