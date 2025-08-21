import { NetComponent } from "../network/net-entity";
import { RunOnServer } from "../network/decorators";
import type { NetBus } from "../network/net-bus";

// Keep types local to this file (or export if needed elsewhere)
export type PlayerId = string;

export interface PlayerDTO {
  id: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  drive: boolean;
  ts: number; // last server update ms
}

export interface PlayersState {
  byId: Record<PlayerId, PlayerDTO>;
  [key: string]: any; // Add index signature for JSONObject constraint
}

interface InputSample {
  ax: number; // [-1..1]
  ay: number; // [-1..1]
  drive?: boolean;
  facing?: number;
}

export class PlayerSystem extends NetComponent {
  // Authoritative state mirror (host writes, clients read)
  public readonly players = this.stateChannel<PlayersState>("players", { byId: {} });

  // Host-only input accumulator
  private readonly _inputs = new Map<PlayerId, InputSample>();

  // Tunables (host)
  private readonly maxSpeed = 110;       // px/s
  private readonly accel = 480;          // px/s^2
  private readonly damping = 0.86;       // per tick damping

  constructor(bus: NetBus) {
    super(bus);
  }

  /** API method: Get local peer ID */
  localId(): string {
    return this._netBus.localId;
  }

  /** API method: Get specific player data */
  get(id: string): PlayerDTO | undefined {
    return this.players.byId[id];
  }

  /** API method: Get all players */
  all(): PlayerDTO[] {
    return Object.values(this.players.byId);
  }

  /** Host creates/initializes a player entry if missing. Safe to call multiple times. */
  @RunOnServer()
  join(id: PlayerId, spawnX = 0, spawnY = 0): void {
    if (!this.players.byId[id]) {
      // Create new player entry directly on the state object
      this.players.byId[id] = {
        id, x: spawnX, y: spawnY, vx: 0, vy: 0, facing: 0, drive: false, ts: Date.now(),
      };
      
      // State channel will auto-replicate the new player
    }
  }

  /** Host removes a player. */
  @RunOnServer()
  leave(id: PlayerId): void {
    // Remove player directly from state object
    delete this.players.byId[id];
    this._inputs.delete(id);
    
    // State channel will auto-replicate the player removal
  }

  /** Client → Host input. Host stores, does not mutate state yet. */
  @RunOnServer()
  setInput(id: PlayerId, input: InputSample): void {
    // Auto-join players when they send input (clean, minimal lifecycle management)
    if (!this.players.byId[id]) {
      this.join(id, 0, 0);
    }

    // Clamp inputs defensively
    const ax = Math.max(-1, Math.min(1, input.ax ?? 0));
    const ay = Math.max(-1, Math.min(1, input.ay ?? 0));
    const facing = Number.isFinite(input.facing) ? (input.facing as number) : undefined;

    this._inputs.set(id, { ax, ay, drive: !!input.drive, facing });
  }

  /** Client → Host position sync. Clients send their actual local position for better accuracy. */
  @RunOnServer()
  updatePosition(id: PlayerId, x: number, y: number, vx: number, vy: number): void {
    const playerData = this.players.byId[id];
    if (playerData) {
      // Update position directly from client's local physics
      playerData.x = x;
      playerData.y = y;
      playerData.vx = vx;
      playerData.vy = vy;
      playerData.ts = Date.now();
    }
  }

  /** Host physics step. Call once per frame from GameScene.update(dt). */
  tick(dtSeconds: number): void {
    if (!this._isHost) return;

    const dt = Math.max(0, Math.min(0.05, dtSeconds)); // clamp dt for stability
    const playerIds = Object.keys(this.players.byId);
    
    if (playerIds.length === 0) return;

    for (const id of playerIds) {
      const p = this.players.byId[id];
      const inp = this._inputs.get(id) ?? { ax: 0, ay: 0, drive: p.drive, facing: p.facing };

      // Track if this player had meaningful changes
      let hasChanges = false;

      // Update drive/facing flags
      if (typeof inp.drive === "boolean" && p.drive !== inp.drive) {
        p.drive = inp.drive;
        hasChanges = true;
      }
      if (typeof inp.facing === "number" && p.facing !== inp.facing) {
        p.facing = inp.facing;
        hasChanges = true;
      }

      // Store original position and velocity for change detection
      const oldX = p.x, oldY = p.y, oldVx = p.vx, oldVy = p.vy;

      // Integrate acceleration
      p.vx += inp.ax * this.accel * dt;
      p.vy += inp.ay * this.accel * dt;

      // Speed clamp
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > this.maxSpeed) {
        const k = this.maxSpeed / Math.max(1e-6, speed);
        p.vx *= k; p.vy *= k;
      }

      // Damping
      p.vx *= this.damping;
      p.vy *= this.damping;

      // Integrate position
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Check if position or velocity changed meaningfully (more than 0.01 pixels)
      const posChanged = Math.abs(p.x - oldX) > 0.01 || Math.abs(p.y - oldY) > 0.01;
      const velChanged = Math.abs(p.vx - oldVx) > 0.01 || Math.abs(p.vy - oldVy) > 0.01;
      
      if (posChanged || velChanged) {
        hasChanges = true;
      }

      // Only update timestamp when there are meaningful changes
      if (hasChanges) {
        p.ts = Date.now();
      }
    }
  }
}
