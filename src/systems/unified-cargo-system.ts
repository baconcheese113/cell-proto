/**
 * Milestone 12 - Unified Cargo System
 * 
 * Story 12.1: Ensure the player can carry exactly one cargo with TTL preserved
 * - One carry slot that accepts Transcript or Vesicle
 * - Pickup/drop remain tile-proximity gated
 * - TTL continues while carried
 * - HUD chip shows carried item type, TTL, and next valid targets
 */

import type { WorldRefs, Transcript, Vesicle } from "../core/world-refs";
import type { HexCoord } from "../hex/hex-grid";
import { SystemObject } from "./system-object";

export type CargoType = 'transcript' | 'vesicle';

export interface CarriedCargo {
  type: CargoType;
  item: Transcript | Vesicle;
  pickedUpAt: number; // timestamp when picked up
}

interface CargoTargetInfo {
  targetType: string;
  distance: number;
  isValid: boolean;
}

export class UnifiedCargoSystem extends SystemObject {
  private carriedCargo: CarriedCargo | null = null;
  
  constructor(
    scene: Phaser.Scene,
    private worldRefs: WorldRefs
  ) {
    super(scene, "UnifiedCargoSystem", (deltaSeconds: number) => this.update(deltaSeconds));
  }
  
  override update(deltaSeconds: number): void {
    this.updateCarriedCargoTTL(deltaSeconds);
    this.updateCarriedCargoPosition();
  }
  
  /**
   * Story 12.1: Check if player is currently carrying anything
   */
  public isCarrying(): boolean {
    return this.carriedCargo !== null;
  }
  
  /**
   * Story 12.1: Get currently carried cargo
   */
  public getCarriedCargo(): CarriedCargo | null {
    return this.carriedCargo;
  }
  
  /**
   * Story 12.3: Clear carried cargo without dropping to world (used by throw system)
   */
  public clearCarriedCargo(): void {
    this.carriedCargo = null;
  }
  
  /**
   * Story 12.1: Attempt to pick up cargo at current player location
   */
  public attemptPickup(playerHex: HexCoord): { success: boolean; message: string } {
    // Check if already carrying something
    if (this.carriedCargo) {
      return { 
        success: false, 
        message: `Already carrying ${this.carriedCargo.type}` 
      };
    }
    
    // Try to pick up transcript first
    const transcript = this.findTranscriptAt(playerHex);
    if (transcript) {
      return this.pickupTranscript(transcript);
    }
    
    // Try to pick up vesicle
    const vesicle = this.findVesicleAt(playerHex);
    if (vesicle) {
      return this.pickupVesicle(vesicle);
    }
    
    return { 
      success: false, 
      message: "No cargo available here" 
    };
  }
  
  /**
   * Story 12.1: Drop currently carried cargo at player location
   */
  public dropCargo(playerHex: HexCoord): { success: boolean; message: string } {
    if (!this.carriedCargo) {
      return { 
        success: false, 
        message: "Not carrying anything" 
      };
    }
    
    const cargo = this.carriedCargo;
    
    // Update cargo position and state
    cargo.item.isCarried = false;
    cargo.item.atHex = { q: playerHex.q, r: playerHex.r };
    cargo.item.worldPos = this.worldRefs.hexGrid.hexToWorld(playerHex).clone();
    
    // Return cargo to appropriate world collection
    if (cargo.type === 'transcript') {
      this.worldRefs.transcripts.set(cargo.item.id, cargo.item as Transcript);
      // Remove from carried list if it was there
      this.removeFromCarriedTranscripts(cargo.item.id);
    } else {
      this.worldRefs.vesicles.set(cargo.item.id, cargo.item as Vesicle);
      // Remove from carried list if it was there
      this.removeFromCarriedVesicles(cargo.item.id);
    }
    
    // Clear carried cargo
    this.carriedCargo = null;
    
    return { 
      success: true, 
      message: `Dropped ${cargo.type}` 
    };
  }
  
  /**
   * Story 12.1: Get valid targets for currently carried cargo
   */
  public getValidTargets(): CargoTargetInfo[] {
    if (!this.carriedCargo) return [];
    
    const targets: CargoTargetInfo[] = [];
    const playerPos = this.getPlayerPosition();
    
    if (this.carriedCargo.type === 'transcript') {
      // Transcripts can go to ER
      const erOrganelles = this.findOrganellesOfType('er');
      for (const er of erOrganelles) {
        const distance = Phaser.Math.Distance.BetweenPoints(playerPos, er.worldPos);
        targets.push({
          targetType: 'ER',
          distance: distance,
          isValid: distance < 50 // Within interaction range
        });
      }
    } else {
      // Vesicles have different targets based on glycosylation state
      const vesicle = this.carriedCargo.item as Vesicle;
      
      if (vesicle.glyco === 'partial') {
        // Partial vesicles go to Golgi
        const golgiOrganelles = this.findOrganellesOfType('golgi');
        for (const golgi of golgiOrganelles) {
          const distance = Phaser.Math.Distance.BetweenPoints(playerPos, golgi.worldPos);
          targets.push({
            targetType: 'Golgi',
            distance: distance,
            isValid: distance < 50
          });
        }
      } else if (vesicle.glyco === 'complete') {
        // Complete vesicles go to their destination membrane hex
        const destWorldPos = this.worldRefs.hexGrid.hexToWorld(vesicle.destHex);
        const distance = Phaser.Math.Distance.BetweenPoints(playerPos, destWorldPos);
        targets.push({
          targetType: `Membrane (${vesicle.destHex.q},${vesicle.destHex.r})`,
          distance: distance,
          isValid: distance < 40
        });
      }
    }
    
    return targets.sort((a, b) => a.distance - b.distance);
  }
  
  /**
   * Get HUD display info for carried cargo
   */
  public getHUDInfo(): {
    type: CargoType;
    ttlRemaining: number;
    ttlPercent: number;
    targets: CargoTargetInfo[];
  } | null {
    if (!this.carriedCargo) return null;
    
    const item = this.carriedCargo.item;
    let ttlRemaining: number;
    let maxTTL: number;
    
    if (this.carriedCargo.type === 'transcript') {
      const transcript = item as Transcript;
      ttlRemaining = transcript.ttlSeconds;
      maxTTL = 60; // Assume 60 second default transcript TTL
    } else {
      const vesicle = item as Vesicle;
      ttlRemaining = vesicle.ttlMs / 1000;
      maxTTL = 90; // Assume 90 second default vesicle TTL
    }
    
    return {
      type: this.carriedCargo.type,
      ttlRemaining: ttlRemaining,
      ttlPercent: Math.max(0, ttlRemaining / maxTTL),
      targets: this.getValidTargets()
    };
  }
  
  /**
   * Update TTL for carried cargo
   */
  private updateCarriedCargoTTL(deltaSeconds: number): void {
    if (!this.carriedCargo) return;
    
    const item = this.carriedCargo.item;
    
    if (this.carriedCargo.type === 'transcript') {
      const transcript = item as Transcript;
      transcript.ttlSeconds -= deltaSeconds;
      
      if (transcript.ttlSeconds <= 0) {
        this.worldRefs.showToast("Carried transcript expired!");
        
        // Remove from carried arrays to prevent network sync of expired cargo
        this.removeFromCarriedTranscripts(transcript.id);
        
        this.carriedCargo = null;
      }
    } else {
      const vesicle = item as Vesicle;
      vesicle.ttlMs -= deltaSeconds * 1000;
      
      if (vesicle.ttlMs <= 0) {
        this.worldRefs.showToast("Carried vesicle expired!");
        
        // Remove from carried arrays to prevent network sync of expired cargo
        this.removeFromCarriedVesicles(vesicle.id);
        
        this.carriedCargo = null;
      }
    }
  }
  
  /**
   * Update position of carried cargo to orbit around player
   */
  private updateCarriedCargoPosition(): void {
    const playerPos = this.getPlayerPosition();
    const orbitRadius = 25;
    let cargoIndex = 0;
    
    // Update carried transcripts (skip thrown ones and network-controlled ones)
    for (const transcript of this.worldRefs.carriedTranscripts) {
      if (!transcript.isThrown && !transcript.isNetworkControlled) { // Skip thrown cargo and remote cargo
        const angle = (this.scene.time.now / 1000) * 2 + (cargoIndex * Math.PI / 2); // Spread items around
        const cargoPos = new Phaser.Math.Vector2(
          playerPos.x + Math.cos(angle) * orbitRadius,
          playerPos.y + Math.sin(angle) * orbitRadius
        );
        transcript.worldPos.copy(cargoPos);
        cargoIndex++;
      }
    }
    
    // Update carried vesicles (skip thrown ones and network-controlled ones)
    for (const vesicle of this.worldRefs.carriedVesicles) {
      if (!vesicle.isThrown && !vesicle.isNetworkControlled) { // Skip thrown cargo and remote cargo
        const angle = (this.scene.time.now / 1000) * 2 + (cargoIndex * Math.PI / 2); // Spread items around
        const cargoPos = new Phaser.Math.Vector2(
          playerPos.x + Math.cos(angle) * orbitRadius,
          playerPos.y + Math.sin(angle) * orbitRadius
        );
        vesicle.worldPos.copy(cargoPos);
        cargoIndex++;
      }
    }
  }
  
  /**
   * Pick up a transcript
   */
  private pickupTranscript(transcript: Transcript): { success: boolean; message: string } {
    // Remove from world collections
    this.worldRefs.transcripts.delete(transcript.id);
    this.removeFromCarriedTranscripts(transcript.id);
    
    // Mark as carried
    transcript.isCarried = true;
    
    // Add to carried transcripts array for serialization
    this.worldRefs.carriedTranscripts.push(transcript);
    
    // Set as carried cargo
    this.carriedCargo = {
      type: 'transcript',
      item: transcript,
      pickedUpAt: this.scene.time.now
    };
    
    return { 
      success: true, 
      message: `Picked up ${transcript.proteinId} transcript` 
    };
  }
  
  /**
   * Pick up a vesicle
   */
  private pickupVesicle(vesicle: Vesicle): { success: boolean; message: string } {
    // Remove from world collections
    this.worldRefs.vesicles.delete(vesicle.id);
    this.removeFromCarriedVesicles(vesicle.id);
    
    // Mark as carried
    vesicle.isCarried = true;
    
    // Add to carried vesicles array for serialization
    this.worldRefs.carriedVesicles.push(vesicle);
    
    // Set as carried cargo
    this.carriedCargo = {
      type: 'vesicle',
      item: vesicle,
      pickedUpAt: this.scene.time.now
    };
    
    return { 
      success: true, 
      message: `Picked up ${vesicle.proteinId} vesicle (${vesicle.glyco})` 
    };
  }
  
  /**
   * Find transcript at hex location
   */
  private findTranscriptAt(hex: HexCoord): Transcript | null {
    // Check world transcripts
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (!transcript.isCarried && 
          transcript.atHex.q === hex.q && 
          transcript.atHex.r === hex.r) {
        return transcript;
      }
    }
    
    // Check carried transcripts that might be at this location
    for (const transcript of this.worldRefs.carriedTranscripts) {
      if (!transcript.isCarried && 
          transcript.atHex.q === hex.q && 
          transcript.atHex.r === hex.r) {
        return transcript;
      }
    }
    
    return null;
  }
  
  /**
   * Find vesicle at hex location
   */
  private findVesicleAt(hex: HexCoord): Vesicle | null {
    // Check world vesicles
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (!vesicle.isCarried && 
          vesicle.atHex.q === hex.q && 
          vesicle.atHex.r === hex.r) {
        return vesicle;
      }
    }
    
    // Check carried vesicles that might be at this location
    for (const vesicle of this.worldRefs.carriedVesicles) {
      if (!vesicle.isCarried && 
          vesicle.atHex.q === hex.q && 
          vesicle.atHex.r === hex.r) {
        return vesicle;
      }
    }
    
    return null;
  }
  
  /**
   * Find organelles of specified type
   */
  private findOrganellesOfType(type: string): Array<{ coord: HexCoord; worldPos: Phaser.Math.Vector2 }> {
    const organelles: Array<{ coord: HexCoord; worldPos: Phaser.Math.Vector2 }> = [];
    
    for (const organelle of this.worldRefs.organelleSystem.getAllOrganelles()) {
      if (organelle.type === type) {
        organelles.push({
          coord: organelle.coord,
          worldPos: this.worldRefs.hexGrid.hexToWorld(organelle.coord)
        });
      }
    }
    
    return organelles;
  }
  
  /**
   * Remove transcript from carried list
   */
  private removeFromCarriedTranscripts(transcriptId: string): void {
    const index = this.worldRefs.carriedTranscripts.findIndex(t => t.id === transcriptId);
    if (index !== -1) {
      this.worldRefs.carriedTranscripts.splice(index, 1);
    }
  }
  
  /**
   * Remove vesicle from carried list
   */
  private removeFromCarriedVesicles(vesicleId: string): void {
    const index = this.worldRefs.carriedVesicles.findIndex(v => v.id === vesicleId);
    if (index !== -1) {
      this.worldRefs.carriedVesicles.splice(index, 1);
    }
  }
  
  private getPlayerPosition(): Phaser.Math.Vector2 {
    const player = (this.scene as any).playerActor;
    return player ? player.getWorldPosition() : new Phaser.Math.Vector2(0, 0);
  }
}
