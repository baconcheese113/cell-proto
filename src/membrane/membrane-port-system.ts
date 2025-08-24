/**
 * Membrane Port System - Story 8.11: External Interface Scaffolding
 * 
 * Provides standardized interfaces for external systems to interact with the 
 * secretory pathway and membrane protein infrastructure.
 * 
 * ## Purpose
 * 
 * This system creates clean, stable APIs that external patches/mods can use to:
 * - Register new protein types
 * - Hook into vesicle processing events
 * - Customize glycosylation pathways
 * - Monitor secretory pipeline metrics
 * 
 * ## Design Principles
 * 
 * - **Stable API**: Interfaces remain backward-compatible
 * - **Event-driven**: Uses events for loose coupling
 * - **Extensible**: Easy to add new protein types and processing steps
 * - **Observable**: Comprehensive telemetry for external monitoring
 */

import type { ProteinId, CargoState, GlycosylationState, SystemPerformanceMetrics } from "../core/world-refs";
import type { HexCoord } from "../hex/hex-grid";

/**
 * Story 8.11: External interface for registering new membrane proteins
 */
export interface MembraneProteinDefinition {
  id: ProteinId;
  displayName: string;
  description: string;
  glycosylationRequired: GlycosylationState;
  installationTime: number; // seconds
  throughputMultiplier: number; // effect on transport rates
  energyCost: number; // ATP required for installation
}

/**
 * Story 8.11: External interface for vesicle processing events
 */
export interface VesicleProcessingEvent {
  vesicleId: string;
  proteinId: ProteinId;
  fromState: CargoState;
  toState: CargoState;
  atHex: HexCoord;
  timestamp: number;
  glycosylationState: GlycosylationState;
}

/**
 * Story 8.11: External interface for secretory pipeline monitoring
 */
export interface SecretoryPipelineMetrics extends SystemPerformanceMetrics {
  vesiclesByState: Record<CargoState, number>;
  glycosylationCompletionRate: number; // vesicles/second completing glycosylation
  membraneInstallationRate: number; // proteins/second being installed
  averageTransitTime: number; // seconds from ER to membrane
  blockageEvents: number; // number of blockages in current period
}

/**
 * Story 8.11: External interface for custom glycosylation processors
 */
export interface GlycosylationProcessor {
  id: string;
  canProcess: (proteinId: ProteinId, currentState: GlycosylationState) => boolean;
  processTime: (proteinId: ProteinId) => number; // seconds
  resultState: (proteinId: ProteinId, currentState: GlycosylationState) => GlycosylationState;
  energyCost: (proteinId: ProteinId) => number; // ATP cost
}

/**
 * Story 8.11: Main external interface for the membrane port system
 */
export class MembranePortSystem {
  private proteinDefinitions = new Map<ProteinId, MembraneProteinDefinition>();
  private eventListeners = new Map<string, Function[]>();
  private glycosylationProcessors = new Map<string, GlycosylationProcessor>();

  /**
   * Register a new membrane protein type for external systems
   */
  registerProteinType(definition: MembraneProteinDefinition): void {
    this.proteinDefinitions.set(definition.id, definition);
    this.emit('protein-registered', { proteinId: definition.id, definition });
    console.log(`🔌 Registered external protein type: ${definition.id} (${definition.displayName})`);
  }

  /**
   * Register a custom glycosylation processor
   */
  registerGlycosylationProcessor(processor: GlycosylationProcessor): void {
    this.glycosylationProcessors.set(processor.id, processor);
    this.emit('processor-registered', { processorId: processor.id, processor });
    console.log(`🧬 Registered external glycosylation processor: ${processor.id}`);
  }

  /**
   * Subscribe to vesicle processing events
   */
  onVesicleEvent(eventType: 'state-change' | 'created' | 'expired' | 'blocked', 
                 callback: (event: VesicleProcessingEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(callback);
  }

  /**
   * Get current secretory pipeline metrics for external monitoring
   */
  getSecretoryMetrics(): SecretoryPipelineMetrics {
    // TODO: Implement metrics collection from active vesicle system
    return {
      activeEntities: 0,
      processingRate: 0,
      memoryUsage: 0,
      averageLifetime: 0,
      vesiclesByState: {
        'TRANSPORTING': 0,
        'QUEUED': 0,
        'INSTALLING': 0,
        'DONE': 0,
        'EXPIRED': 0
      },
      glycosylationCompletionRate: 0,
      membraneInstallationRate: 0,
      averageTransitTime: 0,
      blockageEvents: 0
    };
  }

  /**
   * Get available glycosylation processors for a protein
   */
  getProcessorsForProtein(proteinId: ProteinId, currentState: GlycosylationState): GlycosylationProcessor[] {
    return Array.from(this.glycosylationProcessors.values())
      .filter(processor => processor.canProcess(proteinId, currentState));
  }

  /**
   * Get protein definition by ID
   */
  getProteinDefinition(proteinId: ProteinId): MembraneProteinDefinition | undefined {
    return this.proteinDefinitions.get(proteinId);
  }

  /**
   * Internal: Emit event to registered listeners
   */
  private emit(eventType: string, data: any): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in membrane port event listener for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Internal: Notify about vesicle state change (called by vesicle system)
   */
  notifyCargoStateChange(event: VesicleProcessingEvent): void {
    this.emit('state-change', event);
  }

  /**
   * Internal: Notify about vesicle creation (called by vesicle system)
   */
  notifyVesicleCreated(event: VesicleProcessingEvent): void {
    this.emit('created', event);
  }
}

/**
 * Story 8.11: Global instance for external patches to use
 */
export const membranePortSystem = new MembranePortSystem();

// Story 8.11: Example of how external systems can register proteins
export function registerExampleExternalProtein(): void {
  membranePortSystem.registerProteinType({
    id: 'GLUT' as ProteinId, // Example: registering existing protein through external interface
    displayName: 'Glucose Transporter',
    description: 'Facilitates glucose transport across cell membrane',
    glycosylationRequired: 'complete',
    installationTime: 3.0,
    throughputMultiplier: 1.2,
    energyCost: 5
  });
}

// Story 8.11: Example of how external systems can monitor events
export function setupExampleEventMonitoring(): void {
  membranePortSystem.onVesicleEvent('state-change', (event) => {
    console.log(`📡 External monitor: Vesicle ${event.vesicleId} changed from ${event.fromState} to ${event.toState}`);
  });

  membranePortSystem.onVesicleEvent('blocked', (event) => {
    console.warn(`🚨 External monitor: Vesicle ${event.vesicleId} blocked at ${event.atHex.q},${event.atHex.r}`);
  });
}
