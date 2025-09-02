import { NetComponent } from '../network/net-entity';
import { Multicast, RunOnServer } from '../network/decorators';
import type { NetBus } from '../network/net-bus';
import type { PlayerSystem } from './player-system';
import type { GameScene } from '../scenes/game-scene';

export interface EmotePayload {
  peerId: string;
  emoji: string;
  x: number;
  y: number;
}

/**
 * Minimal, self-contained emote system:
 * - Clients call send() -> host @RunOnServer sendEmote(peerId)
 * - Host computes emoji + pose and @Multicast showEmote(payload)
 * - Everyone (including host) spawns tween with dedupe by (peerId, seq)
 */
export class EmoteSystem extends NetComponent {
  private readonly emojis = ['👍', '🕺', '🍺'] as const;
  private nextIndex = 0;

  constructor(
    bus: NetBus, 
    private scene: GameScene, 
    private players: PlayerSystem
  ) {
    super(bus, { address: 'EmoteSystem' });
    console.log('🎭 EmoteSystem initialized');
  }

  /** Client entry point: called by input layer when 0 is pressed. */
  public send(): void {
    const myId = this._netBus.localId;
    if (!myId) return;
    
    // Get player position from the players system
    const playerData = this.players.get(myId);
    const allPlayers = this.players.all();
    console.log(`🎭 Total players = ${allPlayers.length}`, allPlayers);
    if (!playerData) {
      console.warn(`🎭 No player data for ${myId}, using fallback position`);
      this.sendEmote(myId, 0, 0);
      return;
    }
    
    // Use player's position within the cell
    this.sendEmote(myId, playerData.x, playerData.y);
  }

  /** Cleanup method for GameScene shutdown */
  public destroy(): void {
    console.log('🎭 EmoteSystem destroyed');
  }

  /** Host-only: decide emoji + pose, then multicast. */
  @RunOnServer()
  public sendEmote(peerId: string, x: number, y: number): void {
    console.log(`🎭 [HOST] Processing emote from ${peerId} at x=${x} y=${y}`);

    const emoji = this.emojis[this.nextIndex++ % this.emojis.length];

    const payload: EmotePayload = { peerId, emoji, x, y };
    this.spawnEmoji(payload);
  }

  @Multicast()
  private spawnEmoji({ emoji, x, y, peerId }: EmotePayload): void {
    console.log(`🎭 Spawning ${emoji} emote for ${peerId} at (${x}, ${y})`);

    // Get physics center from the scene to convert cell-local to world coordinates
    const physicsCenter = this.scene.getPhysicsCenter() || { x: 0, y: 0 };
    const worldX = physicsCenter.x + x;
    const worldY = physicsCenter.y + y;

    // Create emoji text at world position
    const emoteText = this.scene.add.text(worldX, worldY - 30, emoji, {
      fontFamily: 'Arial',
      fontSize: '24px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);

    emoteText.setDepth(1000); // Above most other objects

    // Tween up and fade
    this.scene.tweens.add({
      targets: emoteText,
      y: worldY - 60, // Float higher
      alpha: 0,
      scaleX: { from: 1, to: 1.2 },
      scaleY: { from: 1, to: 1.2 },
      duration: 1200,
      ease: 'Cubic.easeOut',
      onComplete: () => emoteText.destroy(),
    });
  }
}
