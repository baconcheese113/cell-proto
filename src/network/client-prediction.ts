/**
 * Client Prediction Manager for Cell Proto Multiplayer
 * 
 * Handles input buffering, prediction, and reconciliation
 * for smooth multiplayer experience with host authority.
 */

import type { Player } from "../actors/player";
import type { ClientInput, HostSnapshot, InputSeq } from "./schema";

export interface PlayerState {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  dashCooldown: number;
  isDashing: boolean;
}

export interface PredictionSnapshot {
  inputSeq: InputSeq;
  playerState: PlayerState;
  timestamp: number;
}

export class ClientPrediction {
  private player: Player;
  private inputBuffer: Map<InputSeq, ClientInput> = new Map();
  private stateSnapshots: Map<InputSeq, PredictionSnapshot> = new Map();
  private lastAckedInput: InputSeq = 0;
  private readonly MAX_SNAPSHOTS = 60; // ~4 seconds at 15Hz
  
  constructor(player: Player) {
    this.player = player;
  }
  
  /**
   * Store input and create prediction snapshot
   */
  addInput(input: ClientInput): void {
    // Store input for potential replay
    this.inputBuffer.set(input.seq, input);
    
    // Create state snapshot before applying input
    const currentState = this.capturePlayerState();
    this.stateSnapshots.set(input.seq, {
      inputSeq: input.seq,
      playerState: currentState,
      timestamp: Date.now()
    });
    
    // Apply input prediction locally
    this.applyInputPrediction(input);
    
    this.cleanupOldData();
  }
  
  /**
   * Handle server reconciliation
   */
  reconcile(snapshot: HostSnapshot): void {
    const myPlayer = snapshot.players.find(p => p.id === 'client'); // TODO: Use actual player ID
    if (!myPlayer) return;
    
    this.lastAckedInput = snapshot.ackSeq;
    
    // Get current predicted position
    const predictedState = this.capturePlayerState();
    
    // Calculate error between server and prediction
    const posError = {
      x: myPlayer.pos.x - predictedState.position.x,
      y: myPlayer.pos.y - predictedState.position.y
    };
    
    const errorMagnitude = Math.sqrt(posError.x * posError.x + posError.y * posError.y);
    
    // If error is significant, perform reconciliation
    if (errorMagnitude > 3) { // 3 pixel threshold
      console.log(`Reconciling prediction, error: ${errorMagnitude.toFixed(1)}px`);
      
      // Restore to server state
      this.restorePlayerState({
        position: myPlayer.pos,
        velocity: myPlayer.vel,
        dashCooldown: myPlayer.dashCooldown,
        isDashing: myPlayer.dashCooldown > 0
      });
      
      // Replay unacknowledged inputs
      this.replayInputs(snapshot.ackSeq);
    }
  }
  
  /**
   * Capture current player state
   */
  private capturePlayerState(): PlayerState {
    const worldPos = this.player.getWorldPosition();
    const sprite = (this.player as any).sprite; // Access internal sprite
    
    return {
      position: { x: worldPos.x, y: worldPos.y },
      velocity: { 
        x: sprite.body.velocity.x, 
        y: sprite.body.velocity.y 
      },
      dashCooldown: (this.player as any).dashCooldown || 0,
      isDashing: (this.player as any).isDashing || false
    };
  }
  
  /**
   * Restore player to a specific state
   */
  private restorePlayerState(state: PlayerState): void {
    // Set position
    this.player.setPosition(state.position.x, state.position.y);
    
    // Set velocity
    const sprite = (this.player as any).sprite;
    sprite.setVelocity(state.velocity.x, state.velocity.y);
    
    // Set dash state
    (this.player as any).dashCooldown = state.dashCooldown;
    (this.player as any).isDashing = state.isDashing;
  }
  
  /**
   * Apply input prediction locally
   */
  private applyInputPrediction(input: ClientInput): void {
    // Simulate the same movement logic as the server
    // TODO: Use input.dt for more accurate physics timing
    const sprite = (this.player as any).sprite;
    
    // Apply movement
    if (input.moveAxis.x !== 0 || input.moveAxis.y !== 0) {
      // TODO: Use speed=120 for velocity-based prediction instead of acceleration
      const acceleration = 600;
      
      // Calculate input force
      const inputForce = {
        x: input.moveAxis.x * acceleration,
        y: input.moveAxis.y * acceleration
      };
      
      // Apply acceleration (simplified physics)
      sprite.setAcceleration(inputForce.x, inputForce.y);
    } else {
      // Deceleration when no input
      sprite.setAcceleration(0, 0);
      sprite.setDrag(0.7);
    }
    
    // Handle dash
    if (input.dash) {
      (this.player as any).startDash();
    }
  }
  
  /**
   * Replay inputs after a specific sequence number
   */
  private replayInputs(afterSeq: InputSeq): void {
    const inputsToReplay: ClientInput[] = [];
    
    // Collect unacknowledged inputs
    for (const [seq, input] of this.inputBuffer) {
      if (seq > afterSeq) {
        inputsToReplay.push(input);
      }
    }
    
    // Sort by sequence number
    inputsToReplay.sort((a, b) => a.seq - b.seq);
    
    // Replay each input
    for (const input of inputsToReplay) {
      this.applyInputPrediction(input);
    }
    
    console.log(`Replayed ${inputsToReplay.length} inputs after seq ${afterSeq}`);
  }
  
  /**
   * Clean up old data to prevent memory leaks
   */
  private cleanupOldData(): void {
    // Remove old inputs
    const cutoffSeq = this.lastAckedInput - 30; // Keep last 30 acked inputs
    
    for (const [seq] of this.inputBuffer) {
      if (seq < cutoffSeq) {
        this.inputBuffer.delete(seq);
        this.stateSnapshots.delete(seq);
      }
    }
    
    // Limit total snapshots
    if (this.stateSnapshots.size > this.MAX_SNAPSHOTS) {
      const sortedSeqs = Array.from(this.stateSnapshots.keys()).sort((a, b) => a - b);
      const toRemove = sortedSeqs.slice(0, sortedSeqs.length - this.MAX_SNAPSHOTS);
      
      for (const seq of toRemove) {
        this.stateSnapshots.delete(seq);
      }
    }
  }
  
  /**
   * Get prediction statistics for debugging
   */
  getStats() {
    return {
      inputBufferSize: this.inputBuffer.size,
      snapshotCount: this.stateSnapshots.size,
      lastAckedInput: this.lastAckedInput,
      unackedInputs: Array.from(this.inputBuffer.keys()).filter(seq => seq > this.lastAckedInput).length
    };
  }
}
