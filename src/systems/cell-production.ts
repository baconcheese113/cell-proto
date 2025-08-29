import Phaser from "phaser";
import type { WorldRefs, Transcript, InstallOrder, CargoItinerary, CargoStage } from "../core/world-refs";
import type { HexCoord } from "../hex/hex-grid";
import { SystemObject } from "./system-object";
import { updateVesicles, createVesicleAtER } from "./vesicle-system";

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
  
  // Milestone 13: Spawn gate FIFO queue
  private pendingSpawnQueue: InstallOrder[] = [];

  constructor(scene: Phaser.Scene, worldRefs: WorldRefs, cellRoot?: Phaser.GameObjects.Container) {
    super(scene, 'CellProduction', (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
    
    // Create graphics object for rendering transcript dots
    this.transcriptGraphics = scene.add.graphics();
    this.transcriptGraphics.setDepth(5);
    
    // HOTFIX H5: Re-parent to cellRoot if provided
    if (cellRoot) {
      cellRoot.add(this.transcriptGraphics);
    }
    
    // Milestone 13: Listen for seat events to retry pending spawns
    this.worldRefs.organelleSystem.addSeatEventListener((event, _organelleId, _seatId) => {
      if (event === 'seatReleased') {
        this.retryPendingSpawns();
      }
    });
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
      const vesicleCount = this.worldRefs.vesicles.size;
      console.log(`🔬 Cell-Production: ${transcriptCount} transcripts, ${vesicleCount} vesicles, ${Math.round(this.updateCount / 5)} updates/sec`);
      this.updateCount = 0;
      this.lastPerformanceLog = now;
    }
    
    // Phase 1: Spawn new transcripts and handle TTL
    this.updateTranscriptSpawning(deltaSeconds);
    
    // Phase 2: Route transcripts to ER
    this.updateTranscriptRouting(deltaSeconds);
    
    // Phase 3: Process transcripts at ER (transcript → vesicle)
    this.updateErProcessing(deltaSeconds);
    
    // Phase 4: Update vesicles through secretory pipeline (Milestone 8)
    updateVesicles(this.worldRefs, deltaSeconds, this.scene);
    
    // Phase 5: Route vesicles to membrane and install proteins (legacy - now handled by vesicles)
    this.updateVesicleRouting(deltaSeconds);
    
    // Phase 6: Render all transcripts/vesicles
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
          // Check for available ER seat before processing
          const erOrganelle = this.findEROrganelleAtPosition(transcript.atHex);
          if (erOrganelle) {
            // Check if ER has available seats
            if (!this.worldRefs.organelleSystem.hasAvailableSeats(erOrganelle.id)) {
              // ER is full - keep transcript traveling, don't start processing
              console.log(`🚫 Transcript ${transcript.proteinId} blocked: ER ${erOrganelle.id} is full`);
              continue; // Keep traveling, try again next tick
            }
            
            // Reserve a seat for this transcript
            const seatId = this.worldRefs.organelleSystem.reserveSeat(erOrganelle.id, transcript.id);
            if (!seatId) {
              console.warn(`⚠️ Failed to reserve ER seat for transcript ${transcript.proteinId}`);
              continue;
            }
            
            // Position transcript at the assigned seat
            const seatPosition = this.worldRefs.organelleSystem.getSeatPosition(erOrganelle.id, seatId);
            if (seatPosition) {
              transcript.atHex = seatPosition;
              transcript.worldPos = this.worldRefs.hexGrid.hexToWorld(seatPosition);
              console.log(`🎫 Transcript ${transcript.proteinId} positioned at ER seat ${seatId} at (${seatPosition.q},${seatPosition.r})`);
            }
            
            // Store seat info for later release (add to transcript interface if needed)
            (transcript as any).reservedSeatId = seatId;
            (transcript as any).targetOrganelleId = erOrganelle.id;
          }
          
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
    // Move new install orders to pending queue
    for (const [orderId, order] of this.worldRefs.installOrders) {
      this.pendingSpawnQueue.push(order);
      this.worldRefs.installOrders.delete(orderId);
    }
    
    // Try to spawn from pending queue
    this.retryPendingSpawns();
  }

  // Milestone 13: Retry spawning pending transcripts when seats become available
  private retryPendingSpawns() {
    if (this.pendingSpawnQueue.length === 0) return;

    const nucleusCoord = this.findNucleus();
    if (!nucleusCoord) return;

    const nucleusOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(nucleusCoord);
    if (!nucleusOrganelle) return;

    // Try to spawn one transcript at a time (FIFO)
    const freeSeat = this.worldRefs.organelleSystem.getFreeSeat(nucleusOrganelle.id);
    if (freeSeat) {
      const order = this.pendingSpawnQueue.shift();
      if (order) {
        this.createTranscriptAtNucleus(order, nucleusCoord);
      }
    } else {
      // Milestone 13: Log when nucleus seats are full (helps with validation)
      const seatInfo = this.worldRefs.organelleSystem.getSeatInfo(nucleusOrganelle.id);
      if (seatInfo && this.pendingSpawnQueue.length > 0) {
        console.log(`🎫 Nucleus seats full: ${seatInfo.occupied}/${seatInfo.capacity}, ${this.pendingSpawnQueue.length} transcripts waiting`);
      }
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
    const nucleusOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(nucleusCoord);
    if (!nucleusOrganelle) {
      console.warn(`No nucleus organelle found at ${nucleusCoord.q},${nucleusCoord.r}`);
      return;
    }

    // Reserve a seat in the nucleus
    const seatId = this.worldRefs.organelleSystem.reserveSeat(nucleusOrganelle.id, `transcript_${this.worldRefs.nextTranscriptId}`);
    if (!seatId) {
      console.warn(`Failed to reserve nucleus seat for transcript - this should not happen if spawn gate is working`);
      return;
    }

    // Get the seat position
    const seatPosition = this.worldRefs.organelleSystem.getSeatPosition(nucleusOrganelle.id, seatId);
    if (!seatPosition) {
      console.warn(`Failed to get seat position for ${seatId}`);
      return;
    }

    // Build itinerary for this order
    const itinerary = this.buildItinerary(order);

    // Create transcript at the assigned seat position
    const transcript: Transcript = {
      id: `transcript_${this.worldRefs.nextTranscriptId++}`,
      proteinId: order.proteinId,
      atHex: { q: seatPosition.q, r: seatPosition.r },
      ttlSeconds: 60, // 1 minute lifetime
      worldPos: this.worldRefs.hexGrid.hexToWorld(seatPosition),
      isCarried: false,
      moveAccumulator: 0,
      destHex: { q: order.destHex.q, r: order.destHex.r },
      state: 'traveling', // Start traveling to ER
      processingTimer: 1000, // 1 second in nucleus for processing
      glycosylationState: 'none', // Start with no glycosylation
      itinerary // Attach route plan
    };
    
    this.worldRefs.transcripts.set(transcript.id, transcript);
    console.log(`📝 Created transcript for ${order.proteinId} at nucleus seat (${seatPosition.q}, ${seatPosition.r}) with ${itinerary.stages.length} stage itinerary`);
  }

  // Milestone 13: Build itinerary for membrane transporter orders
  private buildItinerary(order: InstallOrder): CargoItinerary {
    const stages: CargoStage[] = [];
    
    // Stage 1: Nucleus processing
    stages.push({
      kind: 'NUCLEUS',
      requires: 'either',
      enterMs: 1000,
      processMs: 1000
    });

    // Stage 2: ER processing
    const erOrganelle = this.findNearestEROrganelle();
    stages.push({
      kind: 'ER',
      targetOrgId: erOrganelle?.id,
      requires: 'either', // Short path can use either, long path prefers microtubule
      enterMs: 1000,
      processMs: 2000
    });

    // Stage 3: Golgi processing
    const golgiOrganelle = this.findNearestGolgiOrganelle();
    stages.push({
      kind: 'GOLGI',
      targetOrgId: golgiOrganelle?.id,
      requires: 'microtubule',
      enterMs: 1000,
      processMs: 2000
    });

    // Stage 4: Membrane installation
    stages.push({
      kind: 'MEMBRANE_HOTSPOT',
      targetHex: { q: order.destHex.q, r: order.destHex.r },
      requires: 'actin',
      enterMs: 1000,
      processMs: 2000
    });

    return {
      stages,
      stageIndex: 0
    };
  }

  // === TRANSCRIPT ROUTING HELPERS ===

  private findNearestEROrganelle() {
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const organelle of organelles) {
      if (organelle.type === 'proto-er') {
        return organelle;
      }
    }
    return null;
  }

  private findNearestGolgiOrganelle() {
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const organelle of organelles) {
      if (organelle.type === 'golgi') {
        return organelle;
      }
    }
    return null;
  }

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

  private findEROrganelleAtPosition(position: HexCoord): any | null {
    // Check if there's an organelle at this exact position
    const organelle = this.worldRefs.organelleSystem.getOrganelleAtTile(position);
    if (organelle && organelle.type === 'proto-er') {
      return organelle;
    }
    
    // Also check nearby positions (within 1 hex) for ER organelles
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const org of organelles) {
      if (org.type === 'proto-er') {
        const distance = this.calculateHexDistance(position, org.coord);
        if (distance <= 1) {
          return org;
        }
      }
    }
    
    return null;
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

  private releaseTranscriptSeat(transcript: Transcript): void {
    const reservedSeatId = (transcript as any).reservedSeatId;
    const targetOrganelleId = (transcript as any).targetOrganelleId;
    
    if (reservedSeatId && targetOrganelleId) {
      const released = this.worldRefs.organelleSystem.releaseSeat(targetOrganelleId, reservedSeatId);
      if (released) {
        console.log(`🎫 Released ER seat ${reservedSeatId} for transcript ${transcript.proteinId}`);
      }
      
      // Clear seat references
      delete (transcript as any).reservedSeatId;
      delete (transcript as any).targetOrganelleId;
    }
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
    
    const aaAvailable = erTile.concentrations['AA'] || 0;
    const atpAvailable = erTile.concentrations['ATP'] || 0;

    if (aaAvailable >= aaRequired && atpAvailable >= atpRequired) {
      // Consume basic resources
      this.worldRefs.hexGrid.addConcentration(transcript.atHex, 'AA', -aaRequired);
      this.worldRefs.hexGrid.addConcentration(transcript.atHex, 'ATP', -atpRequired);

      // Milestone 8: Create vesicle with partial glycosylation (to be completed at Golgi)
      if (transcript.destHex) {
        const vesicle = createVesicleAtER(
          this.worldRefs,
          transcript.proteinId,
          transcript.destHex,
          transcript.atHex,
          'partial' // ER produces partially glycosylated vesicles
        );
        
        if (vesicle) {
          // Release ER seat before removing transcript
          this.releaseTranscriptSeat(transcript);
          
          // Remove transcript (replaced by vesicle)
          this.worldRefs.transcripts.delete(transcript.id);
          console.log(`📦 ${transcript.proteinId} transcript converted to vesicle at ER`);
        } else {
          console.log(`⚠️ Cannot create vesicle for ${transcript.proteinId} - budget exceeded, keeping transcript`);
        }
      } else {
        // Release ER seat before removing transcript
        this.releaseTranscriptSeat(transcript);
        
        // Remove transcript even if no destination
        this.worldRefs.transcripts.delete(transcript.id);
      }
    } else {
      // Insufficient resources - wait and try again next frame
      transcript.processingTimer = 0.1; // Short retry delay
      // console.log(`⚠️ ER lacks resources for ${transcript.proteinId}: AA=${aaAvailable.toFixed(1)}/${aaRequired}, ATP=${atpAvailable.toFixed(1)}/${atpRequired}`);
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
    
    // Render transcripts
    for (const transcript of this.worldRefs.transcripts.values()) {
      // Skip rendering locally carried transcripts (handled by local player)
      // But DO render network-controlled carried transcripts (from remote players)
      if (transcript.isCarried && !transcript.isNetworkControlled) continue;
      
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
    
    // Milestone 8: Render vesicles
    for (const vesicle of this.worldRefs.vesicles.values()) {
      // Skip rendering locally carried vesicles (handled by local player)
      // But DO render network-controlled carried vesicles (from remote players)
      if (vesicle.isCarried && !vesicle.isNetworkControlled) continue;
      
      // Choose color based on vesicle state
      let color = 0x6699ff; // Default blue for vesicles
      let size = 5; // Slightly larger than transcripts
      
      switch (vesicle.state) {
        case 'QUEUED_ER':
          color = 0xff6699; // Pink - waiting at ER
          break;
        case 'EN_ROUTE_GOLGI':
          color = 0x66ff99; // Green - traveling to Golgi
          break;
        case 'QUEUED_GOLGI':
          color = 0xffcc66; // Yellow - processing at Golgi
          break;
        case 'EN_ROUTE_MEMBRANE':
          color = 0x9966ff; // Purple - traveling to membrane
          break;
        case 'INSTALLING':
          color = 0xff6666; // Red - installing
          size = 6; // Larger during installation
          break;
        case 'BLOCKED':
          color = 0x666666; // Gray - blocked
          break;
      }
      
      // Modify color based on glycosylation
      if (vesicle.glyco === 'complete') {
        // Add bright ring for complete glycosylation
        this.transcriptGraphics.lineStyle(2, 0xffffff, 0.9);
        this.transcriptGraphics.strokeCircle(
          vesicle.worldPos.x,
          vesicle.worldPos.y,
          size + 2
        );
      }
      
      // Draw vesicle
      this.transcriptGraphics.fillStyle(color);
      this.transcriptGraphics.fillCircle(
        vesicle.worldPos.x, 
        vesicle.worldPos.y, 
        size
      );
      
      // Add directional indicator for moving vesicles
      if (vesicle.state.includes('EN_ROUTE') && vesicle.routeCache && vesicle.routeCache.length > 0) {
        const nextHex = vesicle.routeCache[0];
        const nextWorldPos = this.worldRefs.hexGrid.hexToWorld(nextHex);
        const angle = Math.atan2(
          nextWorldPos.y - vesicle.worldPos.y,
          nextWorldPos.x - vesicle.worldPos.x
        );
        
        // Draw small arrow
        this.transcriptGraphics.lineStyle(1, color, 0.8);
        const arrowLength = 8;
        const arrowX = vesicle.worldPos.x + Math.cos(angle) * arrowLength;
        const arrowY = vesicle.worldPos.y + Math.sin(angle) * arrowLength;
        
        this.transcriptGraphics.lineBetween(
          vesicle.worldPos.x, vesicle.worldPos.y,
          arrowX, arrowY
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
