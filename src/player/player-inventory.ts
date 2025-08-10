/**
 * Player Inventory System - Milestone 4 Tasks 1-3
 * 
 * Lightweight inventory for carrying species between tiles.
 */

import type { HexGrid } from "../hex/hex-grid";
import type { HexCoord } from "../hex/hex-grid";

export interface PlayerInventory {
  contents: Record<string, number>; // species id -> amount
  maxCapacity: number; // total units
}

export class PlayerInventorySystem {
  private inventory: PlayerInventory;

  constructor(maxCapacity: number = 50) {
    this.inventory = {
      contents: {},
      maxCapacity
    };
  }

  /**
   * Get current total load
   */
  public getCurrentLoad(): number {
    return Object.values(this.inventory.contents).reduce((sum, amount) => sum + amount, 0);
  }

  /**
   * Get remaining capacity
   */
  public getRemainingCapacity(): number {
    return this.inventory.maxCapacity - this.getCurrentLoad();
  }

  /**
   * Get max capacity
   */
  public getMaxCapacity(): number {
    return this.inventory.maxCapacity;
  }

  /**
   * Check if we can take a certain amount of a species
   */
  public canTake(_speciesId: string, amount: number): boolean {
    if (amount <= 0) return false;
    return this.getRemainingCapacity() >= amount;
  }

  /**
   * Take species into inventory
   */
  public take(speciesId: string, amount: number): number {
    if (amount <= 0) return 0;
    
    const actualAmount = Math.min(amount, this.getRemainingCapacity());
    if (actualAmount <= 0) return 0;

    const current = this.inventory.contents[speciesId] || 0;
    this.inventory.contents[speciesId] = current + actualAmount;
    
    return actualAmount;
  }

  /**
   * Drop species from inventory
   */
  public drop(speciesId: string, amount: number): number {
    if (amount <= 0) return 0;
    
    const current = this.inventory.contents[speciesId] || 0;
    const actualAmount = Math.min(amount, current);
    
    if (actualAmount <= 0) return 0;

    this.inventory.contents[speciesId] = current - actualAmount;
    
    // Clean up zero entries
    if (this.inventory.contents[speciesId] <= 0) {
      delete this.inventory.contents[speciesId];
    }
    
    return actualAmount;
  }

  /**
   * Clear all inventory
   */
  public clear(): void {
    this.inventory.contents = {};
  }

  /**
   * Get amount of specific species
   */
  public getAmount(speciesId: string): number {
    return this.inventory.contents[speciesId] || 0;
  }

  /**
   * Get all non-zero species in inventory
   */
  public getNonZeroContents(): Array<{ speciesId: string; amount: number }> {
    return Object.entries(this.inventory.contents)
      .filter(([_, amount]) => amount > 0)
      .map(([speciesId, amount]) => ({ speciesId, amount }));
  }

  /**
   * Get inventory status for debugging
   */
  public getStatus(): string[] {
    const status = [
      `=== PLAYER INVENTORY ===`,
      `Load: ${this.getCurrentLoad().toFixed(1)}/${this.inventory.maxCapacity}`,
      `Capacity: ${this.getRemainingCapacity().toFixed(1)} remaining`
    ];

    const contents = this.getNonZeroContents();
    if (contents.length > 0) {
      status.push(`Contents:`);
      // Sort contents by species ID for consistent display
      const sortedContents = contents.sort((a, b) => a.speciesId.localeCompare(b.speciesId));
      for (const { speciesId, amount } of sortedContents) {
        status.push(`  ${speciesId}: ${amount.toFixed(2)}`);
      }
    } else {
      status.push(`Empty`);
    }

    return status;
  }

  /**
   * Task 8: Clear all inventory contents (emergency dump)
   */
  public clearInventory(): { totalCleared: number; contents: Array<{ speciesId: string; amount: number }> } {
    const clearedContents = this.getNonZeroContents();
    const totalCleared = this.getCurrentLoad();
    
    this.clear();
    
    return { totalCleared, contents: clearedContents };
  }

  /**
   * Get load ratio (0.0 to 1.0)
   */
  public getLoadRatio(): number {
    return this.getCurrentLoad() / this.inventory.maxCapacity;
  }

  /**
   * Task 2: Scoop species from a tile (take all available of a species)
   */
  public scoopFromTile(hexGrid: HexGrid, coord: HexCoord, speciesId: string): { taken: number; available: number } {
    console.log(`DEBUG: scoopFromTile called for ${speciesId} at (${coord.q}, ${coord.r})`);
    
    const tile = hexGrid.getTile(coord);
    if (!tile) {
      console.log(`DEBUG: No tile found at (${coord.q}, ${coord.r})`);
      return { taken: 0, available: 0 };
    }

    const available = tile.concentrations[speciesId] || 0;
    console.log(`DEBUG: Available amount: ${available}, concentrations object:`, tile.concentrations);
    
    if (available <= 0) {
      console.log(`DEBUG: No available amount (${available} <= 0)`);
      return { taken: 0, available: 0 };
    }

    const canTakeAmount = this.getRemainingCapacity();
    const actualTaken = Math.min(available, canTakeAmount);
    console.log(`DEBUG: Can take: ${canTakeAmount}, actual taken: ${actualTaken}`);
    
    if (actualTaken > 0) {
      // Take from inventory
      this.take(speciesId, actualTaken);
      
      // Remove from tile
      const newAmount = Math.max(0, available - actualTaken);
      console.log(`DEBUG: Setting tile concentration from ${available} to ${newAmount}`);
      tile.concentrations[speciesId] = newAmount;
      
      console.log(`DEBUG: Final concentrations:`, tile.concentrations);
    }

    return { taken: actualTaken, available };
  }

  /**
   * Task 6: Partial scoop - take specific amount from tile
   */
  public scoopAmountFromTile(hexGrid: HexGrid, coord: HexCoord, speciesId: string, amount: number): { taken: number; available: number } {
    const tile = hexGrid.getTile(coord);
    if (!tile) {
      return { taken: 0, available: 0 };
    }

    const available = tile.concentrations[speciesId] || 0;
    if (available <= 0 || amount <= 0) {
      return { taken: 0, available };
    }

    const canTakeAmount = Math.min(amount, this.getRemainingCapacity());
    const actualTaken = Math.min(available, canTakeAmount);
    
    if (actualTaken > 0) {
      // Take from inventory
      this.take(speciesId, actualTaken);
      
      // Remove from tile
      tile.concentrations[speciesId] = Math.max(0, available - actualTaken);
      if (tile.concentrations[speciesId] <= 0) {
        delete tile.concentrations[speciesId];
      }
    }

    return { taken: actualTaken, available };
  }

  /**
   * Task 3: Drop species onto a tile (drop all held of a species)
   */
  public dropOntoTile(hexGrid: HexGrid, coord: HexCoord, speciesId: string): { dropped: number; had: number } {
    const tile = hexGrid.getTile(coord);
    if (!tile) {
      return { dropped: 0, had: 0 };
    }

    const had = this.getAmount(speciesId);
    if (had <= 0) {
      return { dropped: 0, had: 0 };
    }

    // Drop all of this species from inventory
    const actualDropped = this.drop(speciesId, had);
    
    if (actualDropped > 0) {
      // Add to tile
      const current = tile.concentrations[speciesId] || 0;
      tile.concentrations[speciesId] = current + actualDropped;
    }

    return { dropped: actualDropped, had };
  }

  /**
   * Task 7: Partial drop - drop specific amount onto tile
   */
  public dropAmountOntoTile(hexGrid: HexGrid, coord: HexCoord, speciesId: string, amount: number): { dropped: number; had: number } {
    const tile = hexGrid.getTile(coord);
    if (!tile) {
      return { dropped: 0, had: 0 };
    }

    const had = this.getAmount(speciesId);
    if (had <= 0 || amount <= 0) {
      return { dropped: 0, had };
    }

    // Drop specified amount (clamped to what we have)
    const actualDropped = this.drop(speciesId, Math.min(amount, had));
    
    if (actualDropped > 0) {
      // Add to tile
      const current = tile.concentrations[speciesId] || 0;
      tile.concentrations[speciesId] = current + actualDropped;
    }

    return { dropped: actualDropped, had };
  }
}
