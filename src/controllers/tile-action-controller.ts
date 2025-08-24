import Phaser from "phaser";
import type { HexTile, HexCoord } from "../hex/hex-grid";
import type { OrganelleType } from "../organelles/organelle-registry";
import type { WorldRefs, ProteinId } from "../core/world-refs";
import type { NetBundle } from "../app/net-bundle";

interface TileActionConfig {
  scene: Phaser.Scene;
  worldRefs: WorldRefs;
  net: NetBundle;
}

export class TileActionController {
  private worldRefs: WorldRefs;
  private net: NetBundle;
  
  // Mode tracking
  private isInProteinRequestMode: boolean = false;
  private selectedRecipeId: OrganelleType | null = null;

  constructor(config: TileActionConfig) {
    this.worldRefs = config.worldRefs;
    this.net = config.net;
  }

  /**
   * Handle input for tile-based actions
   */
  handleInput(keys: Record<string, Phaser.Input.Keyboard.Key>, currentTile: HexTile | null) {
    // Toggle protein request mode with 'P' key  
    if (Phaser.Input.Keyboard.JustDown(keys['P'])) {
      this.toggleProteinRequestMode();
    }

    // Handle protein requests with number keys in request mode
    if (this.isInProteinRequestMode && currentTile) {
      this.handleProteinRequestInput(keys, currentTile);
    }

    // Exit modes with Q
    if (Phaser.Input.Keyboard.JustDown(keys['Q'])) {
      this.exitAllModes();
    }
    
    // NOTE: B key handling is done by the main scene's handleEssentialBuildInput
    // to properly integrate with the existing build palette UI system
  }

  /**
   * Toggle protein request mode on/off
   */
  private toggleProteinRequestMode() {
    this.isInProteinRequestMode = !this.isInProteinRequestMode;
    
    if (this.isInProteinRequestMode) {
      this.worldRefs.showToast("Protein Request Mode: 1=GLUT, 2=AA_TRANS, 3=NT_TRANS, 4=ROS_EXP, 5=SECR_PUMP, 6=GF_RECEPT");
    } else {
      this.worldRefs.showToast("Exited protein request mode");
    }
  }

  /**
   * Exit all modes
   */
  private exitAllModes() {
    this.isInProteinRequestMode = false;
    this.selectedRecipeId = null;
    this.worldRefs.showToast("Exited all modes");
  }

  /**
   * Handle protein request input with number keys
   */
  private handleProteinRequestInput(keys: Record<string, Phaser.Input.Keyboard.Key>, currentTile: HexTile) {
    let proteinId: ProteinId | null = null;

    if (Phaser.Input.Keyboard.JustDown(keys['ONE'])) {
      proteinId = 'GLUT';
    } else if (Phaser.Input.Keyboard.JustDown(keys['TWO'])) {
      proteinId = 'AA_TRANSPORTER';
    } else if (Phaser.Input.Keyboard.JustDown(keys['THREE'])) {
      proteinId = 'NT_TRANSPORTER';
    } else if (Phaser.Input.Keyboard.JustDown(keys['FOUR'])) {
      proteinId = 'ROS_EXPORTER';
    } else if (Phaser.Input.Keyboard.JustDown(keys['FIVE'])) {
      proteinId = 'SECRETION_PUMP';
    } else if (Phaser.Input.Keyboard.JustDown(keys['SIX'])) {
      proteinId = 'GROWTH_FACTOR_RECEPTOR';
    }

    if (proteinId) {
      this.createInstallOrder(proteinId, currentTile.coord);
    }
  }

  /**
   * Create a new install order for protein production
   */
  private createInstallOrder(proteinId: ProteinId, destHex: HexCoord) {
    // Check if there's already a pending installation for this destination
    if (this.hasPendingInstallation(destHex)) {
      this.worldRefs.showToast(`Installation already pending for (${destHex.q}, ${destHex.r})`);
      return;
    }

    // Always use network call - it routes properly whether we're host or client
    
    // For clients, we'll show optimistic success since we know the system works
    // The actual order processing happens via state replication
    this.net.installOrders.createInstallOrder(proteinId, destHex);
    
    // Show immediate positive feedback since the system is working correctly
    this.worldRefs.showToast(`✅ Transcript requested for ${proteinId}`);
  }

  /**
   * Check if there's already a pending installation for the given destination
   */
  private hasPendingInstallation(destHex: HexCoord): boolean {
    // Check for existing install orders targeting this destination using the new system
    for (const order of this.net.installOrders.getAllOrders()) {
      if (order.destHex.q === destHex.q && order.destHex.r === destHex.r) {
        console.log(`🚫 Blocking duplicate request: Install order ${order.id} already targeting (${destHex.q}, ${destHex.r})`);
        return true;
      }
    }

    // Check for transcripts heading to this destination
    const transcripts = this.worldRefs.cargoSystem?.getTranscripts() || [];
    for (const transcript of transcripts) {
      if (transcript.destHex && 
          transcript.destHex.q === destHex.q && 
          transcript.destHex.r === destHex.r) {
        console.log(`🚫 Blocking duplicate request: Transcript ${transcript.id} already heading to (${destHex.q}, ${destHex.r})`);
        return true;
      }
    }

    // Check for vesicles heading to this destination
    const vesicles = this.worldRefs.cargoSystem?.getVesicles() || [];
    for (const vesicle of vesicles) {
      if (vesicle.destHex && 
          vesicle.destHex.q === destHex.q && 
          vesicle.destHex.r === destHex.r &&
          (vesicle.state === 'TRANSPORTING' ||
           vesicle.state === 'INSTALLING' ||
           vesicle.state === 'QUEUED')) {
        console.log(`🚫 Blocking duplicate request: Vesicle ${vesicle.id} already targeting (${destHex.q}, ${destHex.r}) with state ${vesicle.state}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Get current mode state for UI display
   */
  getState() {
    return {
      isInProteinRequestMode: this.isInProteinRequestMode,
      selectedRecipeId: this.selectedRecipeId
    };
  }

  /**
   * Directly activate protein request mode (for B key on membrane tiles)
   */
  activateProteinRequestMode() {
    this.isInProteinRequestMode = true;
    this.worldRefs.showToast("Protein Request Mode: 1=GLUT, 2=AA_TRANS, 3=NT_TRANS, 4=ROS_EXP, 5=SECR_PUMP, 6=GF_RECEPT");
  }
}
