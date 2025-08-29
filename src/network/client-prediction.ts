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
    if (errorMagnitude > 50) { // Increased threshold since we now have exact physics match
      console.log(`🔄 CLIENT: Large position error ${errorMagnitude.toFixed(1)}px, reconciling`);
      console.log(`  Server: (${myPlayer.pos.x.toFixed(1)}, ${myPlayer.pos.y.toFixed(1)})`);
      console.log(`  Client: (${predictedState.position.x.toFixed(1)}, ${predictedState.position.y.toFixed(1)})`);
      
      // Restore to server state
      this.restorePlayerState({
        position: myPlayer.pos,
        velocity: myPlayer.vel,
        dashCooldown: myPlayer.dashCooldown,
        isDashing: myPlayer.isDashing
      });
      
      // Re-apply unacknowledged inputs with exact server physics
      this.replayInputs(snapshot.ackSeq);
    } else if (errorMagnitude > 20) {
      // For smaller errors, just do a gentle correction instead of hard snap
      if (snapshot.tick % 60 === 0) { // Log smaller errors less frequently
        console.log(`🔧 CLIENT: Small position error ${errorMagnitude.toFixed(1)}px, gentle correction`);
        console.log(`  Server: (${myPlayer.pos.x.toFixed(1)}, ${myPlayer.pos.y.toFixed(1)})`);
        console.log(`  Client: (${predictedState.position.x.toFixed(1)}, ${predictedState.position.y.toFixed(1)})`);
      }
      
      const correctionFactor = 0.3; // Gradually correct over time
      const currentPos = this.player.getWorldPosition();
      
      this.player.setPosition(
        currentPos.x + (myPlayer.pos.x - currentPos.x) * correctionFactor,
        currentPos.y + (myPlayer.pos.y - currentPos.y) * correctionFactor
      );
    } else {
      // Log normal cases occasionally to see typical position differences
      if (snapshot.tick % 120 === 0 && errorMagnitude > 1) { // Only log if there's some difference
        console.log(`✅ CLIENT: Good sync, error: ${errorMagnitude.toFixed(1)}px`);
        console.log(`  Server: (${myPlayer.pos.x.toFixed(1)}, ${myPlayer.pos.y.toFixed(1)})`);
        console.log(`  Client: (${predictedState.position.x.toFixed(1)}, ${predictedState.position.y.toFixed(1)})`);
      }
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
    sprite.setAcceleration(0, 0); // No acceleration in simple physics
    
    // Set dash state (corrected to use isDashing from server)
    (this.player as any).dashCooldown = state.dashCooldown;
    (this.player as any).isDashing = state.isDashing;
    
    // Sync dash timer with cooldown for visual consistency
    if (state.isDashing) {
      (this.player as any).dashTimer = 0.2; // Standard dash duration
    }
  }
  
  /**
   * Apply input prediction locally
   */
  private applyInputPrediction(input: ClientInput): void {
    // Use EXACTLY the same physics as the server to prevent desync
    const networkDeltaTime = 1.0 / 15; // Match server's network tick rate
    
    // Get current player state for modification
    const worldPos = this.player.getWorldPosition();
    const sprite = (this.player as any).sprite;
    
    // Extract current state
    let pos = { x: worldPos.x, y: worldPos.y };
    let vel = { x: sprite.body.velocity.x, y: sprite.body.velocity.y };
    let isDashing = (this.player as any).isDashing || false;
    let dashCooldown = (this.player as any).dashCooldown || 0;
    
    // EXACT COPY of server physics simulation
    if (input.moveAxis.x !== 0 || input.moveAxis.y !== 0) {
      // Simple velocity-based movement (same as server)
      const speed = isDashing ? 300 : 150; // pixels per second
      
      // Handle dash (same logic as server)
      if (input.dash && dashCooldown <= 0) {
        isDashing = true;
        dashCooldown = 1.2;
      }
      
      // Set velocity directly based on input (same as server)
      vel.x = input.moveAxis.x * speed;
      vel.y = input.moveAxis.y * speed;
    } else {
      // Stop when no input (same as server)
      vel.x = 0;
      vel.y = 0;
    }
    
    // Update position based on velocity (same as server)
    pos.x += vel.x * networkDeltaTime;
    pos.y += vel.y * networkDeltaTime;
    
    // Apply boundary constraints (SAME as server)
    const cellRadius = 216; // Same as server
    const playerBoundaryRadius = cellRadius - 20; // Same margin as server
    
    const distanceFromCenter = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    if (distanceFromCenter > playerBoundaryRadius) {
      // Push player back inside the boundary (same logic as server)
      const normalizeX = pos.x / distanceFromCenter;
      const normalizeY = pos.y / distanceFromCenter;
      
      pos.x = normalizeX * playerBoundaryRadius;
      pos.y = normalizeY * playerBoundaryRadius;
      
      // Also stop velocity in the outward direction (same as server)
      const velDotNormal = (vel.x * normalizeX + vel.y * normalizeY);
      if (velDotNormal > 0) {
        vel.x -= normalizeX * velDotNormal;
        vel.y -= normalizeY * velDotNormal;
      }
    }
    
    // Apply results to player
    this.player.setPosition(pos.x, pos.y);
    sprite.setVelocity(vel.x, vel.y);
    sprite.setAcceleration(0, 0); // No acceleration in simple physics
    
    // Update dash state
    (this.player as any).isDashing = isDashing;
    (this.player as any).dashCooldown = dashCooldown;
  }  /**
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
    
    // Only log if replaying a significant number of inputs
    if (inputsToReplay.length > 10) {
      console.log(`Replayed ${inputsToReplay.length} inputs after seq ${afterSeq}`);
    }
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
