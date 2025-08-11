import Phaser from "phaser";
import type { WorldRefs, Transcript, InstallOrder } from "../core/world-refs";
import type { HexCoord } from "../hex/hex-grid";
import { SystemObject } from "./system-object";

/**
 * Consolidated Cell Production System
 * Handles: transcript creation, routing, ER processing, vesicle transport, and installation
 */
export class CellProduction extends SystemObject {
  private worldRefs: WorldRefs;
  private transcriptGraphics: Phaser.GameObjects.Graphics;
  
  // Performance tracking
  private updateCount = 0;
  private lastPerformanceLog = 0;

  constructor(scene: Phaser.Scene, worldRefs: WorldRefs) {
    super(scene, 'CellProduction', (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
    
    // Create graphics object for rendering transcript dots
    this.transcriptGraphics = scene.add.graphics();
    this.transcriptGraphics.setDepth(5);
  }

  /**
   * Main update cycle - runs all production phases in order
   */
  override update(deltaSeconds: number) {
    this.updateCount++;
    
    // Log performance metrics every 5 seconds
    const now = Date.now();
    if (now - this.lastPerformanceLog > 5000) {
      const transcriptCount = this.worldRefs.transcripts.size;
      console.log(`🔬 CellProduction: ${transcriptCount} transcripts, ${Math.round(this.updateCount / 5)} updates/sec`);
      this.updateCount = 0;
      this.lastPerformanceLog = now;
    }
    
    // Phase 1: Spawn new transcripts and handle TTL
    this.updateTranscriptSpawning(deltaSeconds);
    
    // Phase 2: Route transcripts to ER
    this.updateTranscriptRouting(deltaSeconds);
    
    // Phase 3: Process transcripts at ER (transcript → vesicle)
    this.updateErProcessing(deltaSeconds);
    
    // Phase 4: Route vesicles to membrane and install proteins
    this.updateVesicleRouting(deltaSeconds);
    
    // Phase 5: Render all transcripts/vesicles
    this.renderTranscripts();
  }

  /**
   * Phase 1: Process install orders and create new transcripts, handle TTL
   */
  private updateTranscriptSpawning(deltaSeconds: number) {
    // Process pending install orders to create new transcripts
    this.processInstallOrders();
    
    // Update TTL for all transcripts
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.isCarried) continue;
      
      transcript.ttlSeconds -= deltaSeconds;
      if (transcript.ttlSeconds <= 0) {
        this.worldRefs.transcripts.delete(transcript.id);
        console.log(`⏰ Transcript ${transcript.id} expired`);
      }
    }
  }

  /**
   * Phase 2: Route transcripts toward ER
   */
  private updateTranscriptRouting(_deltaSeconds: number) {
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.state !== 'traveling' || transcript.isCarried) continue;

      // Find nearest ER organelle
      const nearestER = this.findNearestER(transcript.atHex);
      if (!nearestER) continue;

      // Move toward ER (one hex per tick)
      const nextHex = this.getNextHexToward(transcript.atHex, nearestER);
      if (nextHex && this.isHexFree(nextHex, transcript.id)) {
        transcript.atHex = nextHex;
        transcript.worldPos = this.worldRefs.hexGrid.hexToWorld(nextHex);

        // Check if arrived at ER
        const distance = this.calculateHexDistance(transcript.atHex, nearestER);
        if (distance <= 1) {
          // Arrived at ER - transition to processing state
          transcript.state = 'processing_at_er';
          transcript.processingTimer = 3.0; // 3 seconds ER processing
          console.log(`🔄 ${transcript.proteinId} transcript arrived at ER - starting processing`);
        }
      }
    }
  }

  /**
   * Phase 3: Process transcripts at ER
   */
  private updateErProcessing(deltaSeconds: number) {
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.state !== 'processing_at_er' || transcript.isCarried) continue;

      transcript.processingTimer -= deltaSeconds;
      
      if (transcript.processingTimer <= 0) {
        this.completeERProcessing(transcript);
      }
    }
  }

  /**
   * Phase 4: Route vesicles to membrane and install
   */
  private updateVesicleRouting(deltaSeconds: number) {
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.isCarried) continue;

      if (transcript.state === 'packaged_for_transport') {
        this.routeVesicleToDestination(transcript);
      } else if (transcript.state === 'installing_at_membrane') {
        transcript.processingTimer -= deltaSeconds;
        if (transcript.processingTimer <= 0) {
          this.completeMembraneInstallation(transcript);
        }
      }
    }
  }

  // === TRANSCRIPT SPAWNING HELPERS ===

  private processInstallOrders() {
    if (this.worldRefs.installOrders.size === 0) return;

    const nucleusCoord = this.findNucleus();
    if (!nucleusCoord) return;

    // Process one order per frame to avoid spam
    const orderEntry = this.worldRefs.installOrders.entries().next().value;
    if (orderEntry) {
      const [orderId, order] = orderEntry;
      this.createTranscriptAtNucleus(order, nucleusCoord);
      this.worldRefs.installOrders.delete(orderId);
    }
  }

  private findNucleus(): HexCoord | null {
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const organelle of organelles) {
      if (organelle.type === 'nucleus') {
        return organelle.coord;
      }
    }
    return null;
  }

  private createTranscriptAtNucleus(order: InstallOrder, nucleusCoord: HexCoord) {
    const transcript: Transcript = {
      id: `transcript_${this.worldRefs.nextTranscriptId++}`,
      proteinId: order.proteinId,
      atHex: { q: nucleusCoord.q, r: nucleusCoord.r },
      ttlSeconds: 60, // 1 minute lifetime
      worldPos: this.worldRefs.hexGrid.hexToWorld(nucleusCoord),
      isCarried: false,
      moveAccumulator: 0,
      destHex: { q: order.destHex.q, r: order.destHex.r },
      state: 'traveling', // Start traveling to ER
      processingTimer: 0,
      glycosylationState: 'none' // Start with no glycosylation
    };
    
    this.worldRefs.transcripts.set(transcript.id, transcript);
    console.log(`📝 Created transcript for ${order.proteinId} at nucleus (${nucleusCoord.q}, ${nucleusCoord.r}) - traveling to ER`);
  }

  // === TRANSCRIPT ROUTING HELPERS ===

  private findNearestER(fromHex: HexCoord): HexCoord | null {
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    let nearestER = null;
    let minDistance = Infinity;

    for (const organelle of organelles) {
      if (organelle.type === 'proto-er') {
        const distance = this.calculateHexDistance(fromHex, organelle.coord);
        if (distance < minDistance) {
          minDistance = distance;
          nearestER = organelle.coord;
        }
      }
    }

    return nearestER;
  }

  private getNextHexToward(from: HexCoord, to: HexCoord): HexCoord | null {
    const neighbors = [
      { q: from.q + 1, r: from.r },     // right
      { q: from.q + 1, r: from.r - 1 }, // top-right  
      { q: from.q, r: from.r - 1 },     // top-left
      { q: from.q - 1, r: from.r },     // left
      { q: from.q - 1, r: from.r + 1 }, // bottom-left
      { q: from.q, r: from.r + 1 }      // bottom-right
    ];

    let bestNeighbor = null;
    let bestDistance = Infinity;

    for (const neighbor of neighbors) {
      const tile = this.worldRefs.hexGrid.getTile(neighbor);
      if (!tile) continue; // Invalid hex

      // Allow entering destination (ER) even if it's membrane (shouldn't happen but safety check)
      const isDestination = neighbor.q === to.q && neighbor.r === to.r;
      
      // For transcript routing, we generally avoid membrane tiles unless destination
      if (tile.isMembrane && !isDestination) continue;

      const distance = this.calculateHexDistance(neighbor, to);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestNeighbor = neighbor;
      }
    }

    return bestNeighbor;
  }

  private calculateHexDistance(from: HexCoord, to: HexCoord): number {
    return (Math.abs(from.q - to.q) + Math.abs(from.q + from.r - to.q - to.r) + Math.abs(from.r - to.r)) / 2;
  }

  private isHexFree(coord: HexCoord, currentTranscriptId: string): boolean {
    // Check if another transcript is already at this hex
    for (const transcript of this.worldRefs.transcripts.values()) {
      if (transcript.id === currentTranscriptId) continue;
      if (transcript.atHex.q === coord.q && transcript.atHex.r === coord.r) {
        return false;
      }
    }
    return true;
  }

  // === ER PROCESSING HELPERS ===

  private completeERProcessing(transcript: Transcript) {
    const erTile = this.worldRefs.hexGrid.getTile(transcript.atHex);
    if (!erTile) return;

    const aaRequired = 5.0; // Amino acids for protein synthesis
    const atpRequired = 3.0; // Energy for processing
    const sugarRequired = 2.0; // Sugar for glycosylation (optional)
    
    const aaAvailable = erTile.concentrations['AA'] || 0;
    const atpAvailable = erTile.concentrations['ATP'] || 0;
    const sugarAvailable = erTile.concentrations['GLUCOSE'] || 0;

    if (aaAvailable >= aaRequired && atpAvailable >= atpRequired) {
      // Consume basic resources
      this.worldRefs.hexGrid.addConcentration(transcript.atHex, 'AA', -aaRequired);
      this.worldRefs.hexGrid.addConcentration(transcript.atHex, 'ATP', -atpRequired);

      // Determine glycosylation state based on available resources
      if (sugarAvailable >= sugarRequired) {
        // Complete glycosylation with sugar consumption
        this.worldRefs.hexGrid.addConcentration(transcript.atHex, 'GLUCOSE', -sugarRequired);
        transcript.glycosylationState = 'complete';
        console.log(`🍭 ${transcript.proteinId} received complete glycosylation`);
      } else if (sugarAvailable >= sugarRequired / 2) {
        // Partial glycosylation with partial sugar consumption
        this.worldRefs.hexGrid.addConcentration(transcript.atHex, 'GLUCOSE', -sugarAvailable);
        transcript.glycosylationState = 'partial';
        console.log(`🍬 ${transcript.proteinId} received partial glycosylation`);
      } else {
        // No glycosylation
        transcript.glycosylationState = 'none';
        console.log(`⚪ ${transcript.proteinId} processed without glycosylation`);
      }

      // Transition to transport state
      transcript.state = 'packaged_for_transport';
      transcript.processingTimer = 0;
      
      console.log(`📦 ${transcript.proteinId} transcript processed at ER - ready for transport`);
    } else {
      // Insufficient resources - wait and try again next frame
      transcript.processingTimer = 0.1; // Short retry delay
      console.log(`⚠️ ER lacks resources for ${transcript.proteinId}: AA=${aaAvailable.toFixed(1)}/${aaRequired}, ATP=${atpAvailable.toFixed(1)}/${atpRequired}`);
    }
  }

  // === VESICLE ROUTING HELPERS ===

  private routeVesicleToDestination(transcript: Transcript) {
    if (!transcript.destHex) {
      console.error(`Transcript ${transcript.id} has no destination!`);
      return;
    }

    // Check if arrived at destination
    const distance = this.calculateHexDistance(transcript.atHex, transcript.destHex);
    if (distance <= 1) {
      // Move to the actual destination membrane tile for installation
      transcript.atHex = { q: transcript.destHex.q, r: transcript.destHex.r };
      
      // Arrived at membrane - start installation
      transcript.state = 'installing_at_membrane';
      transcript.processingTimer = 2.0; // 2 seconds installation time
      console.log(`🔧 ${transcript.proteinId} vesicle arrived at membrane - starting installation`);
      return;
    }

    // Move one hex toward destination
    const nextHex = this.getNextHexTowardMembrane(transcript.atHex, transcript.destHex);
    if (nextHex && this.isHexFree(nextHex, transcript.id)) {
      transcript.atHex = nextHex;
      transcript.worldPos = this.worldRefs.hexGrid.hexToWorld(nextHex);
    }
  }

  private getNextHexTowardMembrane(from: HexCoord, to: HexCoord): HexCoord | null {
    const neighbors = [
      { q: from.q + 1, r: from.r },     // right
      { q: from.q + 1, r: from.r - 1 }, // top-right  
      { q: from.q, r: from.r - 1 },     // top-left
      { q: from.q - 1, r: from.r },     // left
      { q: from.q - 1, r: from.r + 1 }, // bottom-left
      { q: from.q, r: from.r + 1 }      // bottom-right
    ];

    let bestNeighbor = null;
    let bestDistance = Infinity;

    for (const neighbor of neighbors) {
      const tile = this.worldRefs.hexGrid.getTile(neighbor);
      if (!tile) continue; // Invalid hex

      // Allow entering destination membrane tile
      const isDestination = neighbor.q === to.q && neighbor.r === to.r;
      
      // For vesicle routing, avoid membrane tiles unless it's the destination
      if (tile.isMembrane && !isDestination) continue;

      const distance = this.calculateHexDistance(neighbor, to);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestNeighbor = neighbor;
      }
    }

    return bestNeighbor;
  }

  private completeMembraneInstallation(transcript: Transcript) {
    const coord = transcript.atHex;
    
    // Verify this is a membrane tile
    if (!this.worldRefs.hexGrid.isMembraneCoord(coord)) {
      console.warn(`Installation failed: (${coord.q}, ${coord.r}) is not a membrane tile`);
      this.worldRefs.transcripts.delete(transcript.id);
      return;
    }

    // Check if protein can be installed
    if (this.worldRefs.membraneExchangeSystem.hasInstalledProtein(coord)) {
      console.warn(`Installation failed: membrane tile (${coord.q}, ${coord.r}) already has a protein`);
      this.worldRefs.transcripts.delete(transcript.id);
      return;
    }

    // Install the protein
    const success = this.worldRefs.membraneExchangeSystem.installMembraneProtein(coord, transcript.proteinId);
    
    if (success) {
      // Find and complete the associated install order
      for (const [orderId, order] of this.worldRefs.installOrders) {
        if (order.proteinId === transcript.proteinId && 
            order.destHex.q === coord.q && 
            order.destHex.r === coord.r) {
          this.worldRefs.installOrders.delete(orderId);
          break;
        }
      }
      
      console.log(`✅ Successfully installed ${transcript.proteinId} at membrane (${coord.q}, ${coord.r})`);
      
      // Trigger UI refresh to show the newly installed protein
      this.worldRefs.refreshTileInfo();
    } else {
      console.error(`❌ Failed to install ${transcript.proteinId} at membrane (${coord.q}, ${coord.r})`);
    }

    // Remove the transcript (installation complete)
    this.worldRefs.transcripts.delete(transcript.id);
  }

  // === RENDERING ===

  private renderTranscripts() {
    this.transcriptGraphics.clear();
    
    for (const transcript of this.worldRefs.transcripts.values()) {
      // Skip rendering carried transcripts (handled by player)
      if (transcript.isCarried) continue;
      
      // Choose color based on state
      let color = 0x88cc44; // Default green
      switch (transcript.state) {
        case 'processing_at_er':
          color = 0xffaa00; // Orange - processing
          break;
        case 'packaged_for_transport':
        case 'traveling':
          color = 0x00aaff; // Blue - traveling
          break;
        case 'installing_at_membrane':
          color = 0xff00aa; // Magenta - installing
          break;
      }
      
      // Modify color brightness based on glycosylation state
      if (transcript.glycosylationState === 'complete') {
        // Brighten color for complete glycosylation
        color = this.brightenColor(color, 0.3);
      } else if (transcript.glycosylationState === 'partial') {
        // Slightly brighten for partial glycosylation
        color = this.brightenColor(color, 0.15);
      }
      // 'none' uses base color
      
      // Draw transcript dot
      this.transcriptGraphics.fillStyle(color);
      this.transcriptGraphics.fillCircle(
        transcript.worldPos.x, 
        transcript.worldPos.y, 
        4
      );
      
      // Add glycosylation indicator ring
      if (transcript.glycosylationState !== 'none') {
        const ringColor = transcript.glycosylationState === 'complete' ? 0xffffff : 0xcccccc;
        this.transcriptGraphics.lineStyle(1, ringColor, 0.8);
        this.transcriptGraphics.strokeCircle(
          transcript.worldPos.x,
          transcript.worldPos.y,
          6
        );
      }
      
      // Add processing indicator for stationary states
      if (transcript.processingTimer > 0) {
        this.transcriptGraphics.lineStyle(2, color, 0.6);
        this.transcriptGraphics.strokeCircle(
          transcript.worldPos.x,
          transcript.worldPos.y,
          8
        );
      }
      
      // Add low TTL warning
      if (transcript.ttlSeconds < 10) {
        this.transcriptGraphics.lineStyle(2, 0xff0000, 0.8);
        this.transcriptGraphics.strokeCircle(
          transcript.worldPos.x,
          transcript.worldPos.y,
          10
        );
      }
    }
  }

  private brightenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xFF) * (1 + factor)));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xFF) * (1 + factor)));
    const b = Math.min(255, Math.floor((color & 0xFF) * (1 + factor)));
    return (r << 16) | (g << 8) | b;
  }

  override destroy() {
    this.transcriptGraphics?.destroy();
    super.destroy();
  }
}
