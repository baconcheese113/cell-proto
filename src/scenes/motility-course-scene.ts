/**
 * Motility Course Scene - Mini test map for demonstrating motility modes
 * 
 * Three sequential zones:
 * A) Narrow soft maze (amoeboid wins)
 * B) Open low-adhesion runway (bleb wins) 
 * C) Dense ECM with chicanes (mesenchymal wins after anchors mature)
 */

import Phaser from "phaser";
import { SubstrateSystem } from "../core/substrate-system";
import { CellSpaceSystem } from "../core/cell-space-system";
import { CellMotility } from "../systems/cell-motility";
import { PlayerInventorySystem } from "../player/player-inventory";
import { setHud, addHud } from "../ui/hud";
import type { WorldRefs } from "../core/world-refs";
import { MotilityTelemetry } from "../systems/motility-telemetry";

export class MotilityCourseScene extends Phaser.Scene {
  private substrateSystem!: SubstrateSystem;
  private cellSpaceSystem!: CellSpaceSystem;
  private cellMotility!: CellMotility;
  private playerInventory!: PlayerInventorySystem;
  private worldRefs!: WorldRefs;
  
  private cellSprite!: Phaser.GameObjects.Arc;
  private keys!: any;
  
  // Course timing
  private courseStartTime = 0;
  private zoneStartTime = 0;
  private currentZone = 0;
  private zoneTimes: number[] = [];
  private isRunning = false;
  
  // V2: Debug mode for state meters
  private debugMode = false;

  // V2: Performance tracking for scoring
  private performanceData = {
    amoeboidLobeCount: 0,
    blebChainCount: 0,
    mesenchymalAnchorDrops: 0,
    totalAtpUsed: 0,
    skillEvents: [] as string[]
  };
  
  // V2: Telemetry system
  private telemetry!: MotilityTelemetry;
  private lastMode: string = 'amoeboid';
  
  // Zone positions
  private zonePositions = [
    { x: -300, y: 0, name: "Soft Maze" },
    { x: 0, y: 0, name: "Low-Adhesion Runway" },
    { x: 300, y: 0, name: "ECM Chicanes" }
  ];
  
  constructor() {
    super({ key: 'MotilityCourse' });
  }
  
  create() {
    this.cameras.main.setBackgroundColor(0x0b0f14);
    
    // Initialize systems
    this.setupSystems();
    this.setupCourse();
    this.setupVisuals();
    this.setupInput();
    this.setupHUD();
    
    // Position camera and cell at start
    this.resetCourse();
  }
  
  private setupSystems(): void {
    this.substrateSystem = new SubstrateSystem();
    this.playerInventory = new PlayerInventorySystem();
    this.telemetry = new MotilityTelemetry();
    
    // Give player plenty of ATP for testing
    this.playerInventory.take('ATP', 1000);
    
    this.worldRefs = {
      playerInventory: this.playerInventory,
      substrateSystem: this.substrateSystem
    } as WorldRefs;
    
    this.cellSpaceSystem = new CellSpaceSystem(-450, 0);
    this.cellMotility = new CellMotility(this, this.worldRefs, this.cellSpaceSystem);
    this.cellMotility.setDriveMode(true);
  }
  
  private setupCourse(): void {
    // Clear default substrates and create course layout
    (this.substrateSystem as any).substrates = [];
    (this.substrateSystem as any).obstacles = [];
    
    // Zone A: Soft maze with narrow corridors
    this.createSoftMaze();
    
    // Zone B: Low-adhesion runway (very soft substrate)
    this.createLowAdhesionRunway();
    
    // Zone C: ECM chicanes with dense matrix
    this.createECMChicanes();
    
    // Start/finish areas
    this.createStartFinishAreas();
  }
  
  private createSoftMaze(): void {
    const baseX = -300;
    
    // Soft substrate base
    this.addSubstrate('SOFT', {
      type: 'circle',
      x: baseX,
      y: 0,
      radius: 150
    }, 0x4444AA);
    
    // Narrow corridors with walls
    const wallData = [
      { x: baseX - 100, y: -60, w: 20, h: 80 },
      { x: baseX - 50, y: -30, w: 80, h: 20 },
      { x: baseX + 20, y: -80, w: 20, h: 100 },
      { x: baseX + 60, y: 30, w: 60, h: 20 },
    ];
    
    wallData.forEach(wall => {
      this.addObstacle('wall', {
        type: 'polygon',
        points: [
          { x: wall.x - wall.w/2, y: wall.y - wall.h/2 },
          { x: wall.x + wall.w/2, y: wall.y - wall.h/2 },
          { x: wall.x + wall.w/2, y: wall.y + wall.h/2 },
          { x: wall.x - wall.w/2, y: wall.y + wall.h/2 }
        ]
      }, 0x333333);
    });

    // V2: Add micropores for amoeboid advantage
    this.addTerrainFeature('micropore', {
      type: 'circle',
      x: baseX - 80,
      y: -10,
      radius: 8
    }, { requiredMode: 'amoeboid' }, 0x6666FF);

    this.addTerrainFeature('micropore', {
      type: 'circle', 
      x: baseX + 40,
      y: 50,
      radius: 8
    }, { requiredMode: 'amoeboid' }, 0x6666FF);
  }
  
  private createLowAdhesionRunway(): void {
    const baseX = 0;
    
    // Very soft substrate for optimal blebbing
    this.addSubstrate('SOFT', {
      type: 'polygon',
      points: [
        { x: baseX - 150, y: -50 },
        { x: baseX + 150, y: -50 },
        { x: baseX + 150, y: 50 },
        { x: baseX - 150, y: 50 }
      ]
    }, 0x4444FF);
    
    // A few scattered obstacles to test steering
    this.addObstacle('rock', {
      type: 'circle',
      x: baseX - 50,
      y: 20,
      radius: 15
    }, 0x666666);
    
    this.addObstacle('rock', {
      type: 'circle',
      x: baseX + 30,
      y: -25,
      radius: 12
    }, 0x666666);

    // V2: Add run-up gates for speed detection (blebbing advantage)
    this.addTerrainFeature('runUpGate', {
      type: 'polygon',
      points: [
        { x: baseX - 100, y: -5 },
        { x: baseX - 95, y: -5 },
        { x: baseX - 95, y: 5 },
        { x: baseX - 100, y: 5 }
      ]
    }, { requiredSpeed: 25, rewardPoints: 10 }, 0xFFFF66);

    this.addTerrainFeature('runUpGate', {
      type: 'polygon',
      points: [
        { x: baseX + 50, y: -5 },
        { x: baseX + 55, y: -5 },
        { x: baseX + 55, y: 5 },
        { x: baseX + 50, y: 5 }
      ]
    }, { requiredSpeed: 30, rewardPoints: 15 }, 0xFFFF66);
  }
  
  private createECMChicanes(): void {
    const baseX = 300;
    
    // Dense ECM substrate
    this.addSubstrate('ECM', {
      type: 'circle',
      x: baseX,
      y: 0,
      radius: 150
    }, 0x664422);
    
    // Chicane obstacles requiring path-cutting
    const chicanes = [
      { x: baseX - 80, y: -40, w: 30, h: 60 },
      { x: baseX - 20, y: 40, w: 30, h: 60 },
      { x: baseX + 40, y: -50, w: 30, h: 70 },
      { x: baseX + 100, y: 20, w: 30, h: 50 },
    ];
    
    chicanes.forEach(chicane => {
      this.addObstacle('wall', {
        type: 'polygon',
        points: [
          { x: chicane.x - chicane.w/2, y: chicane.y - chicane.h/2 },
          { x: chicane.x + chicane.w/2, y: chicane.y - chicane.h/2 },
          { x: chicane.x + chicane.w/2, y: chicane.y + chicane.h/2 },
          { x: chicane.x - chicane.w/2, y: chicane.y + chicane.h/2 }
        ]
      }, 0x333333);
    });

    // V2: Add ECM lattice with S-curves for mesenchymal track advantage
    this.addTerrainFeature('ecmLattice', {
      type: 'polygon',
      points: [
        { x: baseX - 60, y: -20 },
        { x: baseX - 40, y: -20 },
        { x: baseX - 20, y: 0 },
        { x: baseX, y: 20 },
        { x: baseX + 20, y: 0 },
        { x: baseX + 40, y: -20 },
        { x: baseX + 60, y: -20 },
        { x: baseX + 60, y: -10 },
        { x: baseX + 45, y: -10 },
        { x: baseX + 25, y: 10 },
        { x: baseX + 5, y: 30 },
        { x: baseX - 15, y: 10 },
        { x: baseX - 35, y: -10 },
        { x: baseX - 60, y: -10 }
      ]
    }, { trackPersistence: 15, resistanceReduction: 0.4 }, 0xAA8844);
  }
  
  private createStartFinishAreas(): void {
    // Start area
    this.addSubstrate('FIRM', {
      type: 'circle',
      x: -450,
      y: 0,
      radius: 40
    }, 0x00FF00);
    
    // Finish area
    this.addSubstrate('FIRM', {
      type: 'circle',
      x: 450,
      y: 0,
      radius: 40
    }, 0xFF0000);
  }
  
  private addSubstrate(type: any, bounds: any, color: number): void {
    (this.substrateSystem as any).substrates.push({
      type,
      bounds,
      color
    });
  }
  
  private addObstacle(type: any, bounds: any, color: number): void {
    (this.substrateSystem as any).obstacles.push({
      type,
      bounds,
      color,
      alpha: 0.8
    });
  }

  // V2: Add terrain features for mode differentiation
  private addTerrainFeature(type: any, bounds: any, properties: any, color: number): void {
    this.substrateSystem.addTerrainFeature({
      type,
      bounds,
      properties,
      color,
      alpha: 0.6
    });
  }
  
  private setupVisuals(): void {
    // Create substrate visualization
    const graphics = this.add.graphics();
    
    // Draw substrates
    (this.substrateSystem as any).substrates.forEach((substrate: any) => {
      graphics.fillStyle(substrate.color, 0.3);
      if (substrate.bounds.type === 'circle') {
        graphics.fillCircle(substrate.bounds.x, substrate.bounds.y, substrate.bounds.radius);
      } else if (substrate.bounds.type === 'polygon') {
        graphics.beginPath();
        graphics.moveTo(substrate.bounds.points[0].x, substrate.bounds.points[0].y);
        for (let i = 1; i < substrate.bounds.points.length; i++) {
          graphics.lineTo(substrate.bounds.points[i].x, substrate.bounds.points[i].y);
        }
        graphics.closePath();
        graphics.fillPath();
      }
    });
    
    // Draw obstacles
    (this.substrateSystem as any).obstacles.forEach((obstacle: any) => {
      graphics.fillStyle(obstacle.color, obstacle.alpha || 0.8);
      if (obstacle.bounds.type === 'circle') {
        graphics.fillCircle(obstacle.bounds.x, obstacle.bounds.y, obstacle.bounds.radius);
      } else if (obstacle.bounds.type === 'polygon') {
        graphics.beginPath();
        graphics.moveTo(obstacle.bounds.points[0].x, obstacle.bounds.points[0].y);
        for (let i = 1; i < obstacle.bounds.points.length; i++) {
          graphics.lineTo(obstacle.bounds.points[i].x, obstacle.bounds.points[i].y);
        }
        graphics.closePath();
        graphics.fillPath();
      }
    });
    
    // Zone labels
    this.zonePositions.forEach((zone, index) => {
      this.add.text(zone.x, zone.y - 120, `Zone ${String.fromCharCode(65 + index)}: ${zone.name}`, {
        fontSize: '16px',
        color: '#ffffff',
        align: 'center'
      }).setOrigin(0.5);
    });
    
    // Create cell visual
    this.cellSprite = this.add.circle(0, 0, 30, 0x66ffcc, 0.8);
    this.cellSprite.setStrokeStyle(2, 0xbfffe6);
  }
  
  private setupInput(): void {
    this.keys = this.input.keyboard?.addKeys('W,A,S,D,SPACE,TAB,X,Z,R,ESC,M') as any;
    
    // Reset course
    this.input.keyboard?.on('keydown-R', () => {
      this.resetCourse();
    });
    
    // Return to main game
    this.input.keyboard?.on('keydown-ESC', () => {
      this.scene.start('game');
    });
    
    // V2: Toggle debug mode for state meters
    this.input.keyboard?.on('keydown-M', () => {
      this.debugMode = !this.debugMode;
    });
  }
  
  private setupHUD(): void {
    addHud(this);
  }
  
  private resetCourse(): void {
    // Position cell at start
    this.cellSpaceSystem.setTargetPosition(-450, 0);
    this.cellSpaceSystem.setTargetRotation(0);
    
    // Reset timing
    this.courseStartTime = this.time.now;
    this.zoneStartTime = this.time.now;
    this.currentZone = 0;
    this.zoneTimes = [];
    this.isRunning = true;
    
    // V2: Reset performance tracking
    this.performanceData = {
      amoeboidLobeCount: 0,
      blebChainCount: 0,
      mesenchymalAnchorDrops: 0,
      totalAtpUsed: 0,
      skillEvents: []
    };
    
    // Center camera on start area
    this.cameras.main.centerOn(-450, 0);
  }
  
  override update(): void {
    // Update systems
    this.cellMotility.updateInput(this.keys);
    
    // V2: Track skill usage for scoring
    if (this.isRunning) {
      this.trackPerformanceMetrics();
    }
    
    // Update cell visual position
    const transform = this.cellSpaceSystem.getTransform();
    this.cellSprite.setPosition(transform.position.x, transform.position.y);
    this.cellSprite.setRotation(transform.rotation);
    
    // Update camera to follow cell
    this.cameras.main.centerOn(transform.position.x, transform.position.y);
    
    // Check zone progression
    if (this.isRunning) {
      this.checkZoneProgression(transform.position.x);
    }
    
    // Update HUD
    this.updateCourseHUD();
  }

  // V2: Track performance metrics for star rating
  private trackPerformanceMetrics(): void {
    const modeState = this.cellMotility.getModeRegistry().getState();
    const motilityState = this.cellMotility.getState();
    
    // V2: Track mode changes for telemetry
    const currentMode = modeState.currentModeId;
    if (currentMode !== this.lastMode) {
      this.telemetry.logEvent('mode_switch', {
        newMode: currentMode,
        oldMode: this.lastMode,
        timestamp: this.time.now
      });
      this.lastMode = currentMode;
    }
    
    // V2: Track terrain interactions
    const currentSubstrate = motilityState.currentSubstrate;
    if (Math.random() < 0.02) { // Sample terrain interactions occasionally to avoid spam
      this.telemetry.logEvent('terrain_interaction', {
        terrainType: currentSubstrate,
        modeId: currentMode,
        speed: motilityState.speed,
        timestamp: this.time.now
      });
    }
    
    // Track ATP usage (simplified)
    this.performanceData.totalAtpUsed += motilityState.atpDrainPerSecond * 0.016; // ~60fps
    
    // Track mode-specific skill usage
    if (modeState.currentModeId === 'amoeboid' && modeState.amoeboid.isAiming) {
      // Count pseudopod lobe usage
      if (!this.performanceData.skillEvents.includes('aimingLobe')) {
        this.performanceData.amoeboidLobeCount++;
        this.performanceData.skillEvents.push('aimingLobe');
        
        // V2: Telemetry - track skill usage
        this.telemetry.logEvent('skill_usage', {
          skillType: 'pseudopodLobe',
          modeId: 'amoeboid',
          timestamp: this.time.now
        });
      }
    } else {
      this.performanceData.skillEvents = this.performanceData.skillEvents.filter(e => e !== 'aimingLobe');
    }
    
    // Track bleb chains
    if (modeState.currentModeId === 'blebbing' && modeState.blebbing.chainCount > 1) {
      if (!this.performanceData.skillEvents.includes('chainActive')) {
        this.performanceData.blebChainCount++;
        this.performanceData.skillEvents.push('chainActive');
        
        // V2: Telemetry - track skill usage
        this.telemetry.logEvent('skill_usage', {
          skillType: 'blebChain',
          modeId: 'blebbing',
          chainLength: modeState.blebbing.chainCount,
          timestamp: this.time.now
        });
      }
    } else {
      this.performanceData.skillEvents = this.performanceData.skillEvents.filter(e => e !== 'chainActive');
    }
    
    // Track anchor drops (penalty)
    if (modeState.currentModeId === 'mesenchymal' && modeState.mesenchymal.anchorDropWarning) {
      if (!this.performanceData.skillEvents.includes('anchorDrop')) {
        this.performanceData.mesenchymalAnchorDrops++;
        this.performanceData.skillEvents.push('anchorDrop');
        
        // V2: Telemetry - track negative skill usage
        this.telemetry.logEvent('skill_usage', {
          skillType: 'anchorDropPenalty',
          modeId: 'mesenchymal',
          timestamp: this.time.now
        });
        
        setTimeout(() => {
          this.performanceData.skillEvents = this.performanceData.skillEvents.filter(e => e !== 'anchorDrop');
        }, 1000);
      }
    }
  }
  
  private checkZoneProgression(cellX: number): void {
    let newZone = 0;
    
    if (cellX > -150) newZone = 1; // Entered zone B
    if (cellX > 150) newZone = 2;  // Entered zone C
    if (cellX > 410) {             // Reached finish
      if (this.isRunning) {
        this.finishCourse();
      }
      return;
    }
    
    if (newZone > this.currentZone) {
      // Entered new zone
      const zoneTime = (this.time.now - this.zoneStartTime) / 1000;
      this.zoneTimes.push(zoneTime);
      
      this.currentZone = newZone;
      this.zoneStartTime = this.time.now;
    }
  }
  
  private finishCourse(): void {
    const finalTime = (this.time.now - this.zoneStartTime) / 1000;
    this.zoneTimes.push(finalTime);
    
    const totalTime = (this.time.now - this.courseStartTime) / 1000;
    this.isRunning = false;
    
    // V2: Calculate star rating based on performance
    const stars = this.calculateStarRating(totalTime, this.performanceData.totalAtpUsed);
    const tips = this.generatePerformanceTips();
    
    // V2: Telemetry - log course completion
    this.telemetry.logEvent('performance_metric', {
      type: 'course_completion',
      score: stars,
      totalTime,
      atpUsed: this.performanceData.totalAtpUsed,
      skillEvents: { ...this.performanceData },
      timestamp: this.time.now
    });
    
    // Export enhanced stats
    const stats = {
      totalTime,
      zoneTimes: this.zoneTimes,
      finalMode: this.cellMotility.getModeRegistry().getCurrentMode().name,
      stars,
      performance: {
        ...this.performanceData,
        atpEfficiency: this.calculateAtpEfficiency(totalTime),
        tips
      }
    };
    
    console.log('🏁 Course completed!', stats);
    this.displayResults(stats);
  }

  // V2: Calculate 3-star rating system
  private calculateStarRating(totalTime: number, atpUsed: number): number {
    let stars = 0;
    
    // ⭐ Finish under target time (90 seconds)
    if (totalTime <= 90) stars++;
    
    // ⭐ Use each mode's micro-skill at least twice
    const skillUsage = 
      (this.performanceData.amoeboidLobeCount >= 2 ? 1 : 0) +
      (this.performanceData.blebChainCount >= 2 ? 1 : 0) +
      (this.performanceData.mesenchymalAnchorDrops <= 1 ? 1 : 0); // Good = few drops
    
    if (skillUsage >= 2) stars++;
    
    // ⭐ ≤ target ATP usage (300 ATP total)
    if (atpUsed <= 300) stars++;
    
    return stars;
  }

  // V2: Generate performance tips
  private generatePerformanceTips(): string[] {
    const tips: string[] = [];
    
    if (this.performanceData.amoeboidLobeCount < 2) {
      tips.push("Try holding SPACE to aim pseudopod lobes in amoeboid mode");
    }
    
    if (this.performanceData.blebChainCount < 2) {
      tips.push("Try chaining your blebs within the timing window for speed bonus");
    }
    
    if (this.performanceData.mesenchymalAnchorDrops > 2) {
      tips.push("Maintain adhesion anchors in mesenchymal mode - avoid sharp turns");
    }
    
    if (this.performanceData.totalAtpUsed > 300) {
      tips.push("Use mode-specific advantages to reduce energy consumption");
    }
    
    return tips;
  }

  // V2: Calculate ATP efficiency
  private calculateAtpEfficiency(_totalTime: number): number {
    const distance = 900; // Approximate course length
    return this.performanceData.totalAtpUsed > 0 ? distance / this.performanceData.totalAtpUsed : 0;
  }

  // V2: Display results (placeholder for UI)
  private displayResults(stats: any): void {
    // TODO: Create proper results UI
    const starString = '⭐'.repeat(stats.stars) + '☆'.repeat(3 - stats.stars);
    console.log(`\n${starString} Performance Report ${starString}`);
    console.log(`Time: ${stats.totalTime.toFixed(1)}s (target: ≤90s)`);
    console.log(`ATP Used: ${stats.performance.totalAtpUsed} (target: ≤300)`);
    console.log(`Efficiency: ${stats.performance.atpEfficiency.toFixed(2)} distance/ATP`);
    
    if (stats.performance.tips.length > 0) {
      console.log('\n💡 Tips for improvement:');
      stats.performance.tips.forEach((tip: string) => console.log(`  • ${tip}`));
    }
  }
  
  private updateCourseHUD(): void {
    if (!this.cellMotility) return;
    
    const motilityState = this.cellMotility.getState();
    const modeRegistry = this.cellMotility.getModeRegistry();
    const currentMode = modeRegistry.getCurrentMode();
    const modeState = modeRegistry.getState();
    const substrateScalars = modeRegistry.getSubstrateScalars(motilityState.currentSubstrate);
    
    // Course status
    let courseStatus = "";
    if (this.isRunning) {
      const elapsed = (this.time.now - this.courseStartTime) / 1000;
      const currentZoneName = this.zonePositions[this.currentZone]?.name || "Finish";
      courseStatus = `Course: ${elapsed.toFixed(1)}s | Zone: ${currentZoneName}`;
    } else {
      courseStatus = "Course Complete! Press R to restart, ESC to return";
    }

    // V2: State meters for debug mode
    const stateMeters = this.debugMode ? {
      pulse: this.cellMotility.getStateMeter('pulse') / 10.0, // Normalize to 0-1
      pressure: this.cellMotility.getStateMeter('pressure'),
      leftMaturity: this.cellMotility.getStateMeter('leftMaturity'),
      rightMaturity: this.cellMotility.getStateMeter('rightMaturity'),
      trackStrength: this.cellMotility.getStateMeter('trackStrength'),
      chainWindow: this.cellMotility.getChainWindowProgress()
    } : undefined;

    // V2: Action availability
    const actionStates = this.debugMode ? {
      blebBurst: this.cellMotility.isActionAvailable('blebBurst'),
      proteaseToggle: this.cellMotility.isActionAvailable('proteaseToggle'),
      handbrake: this.cellMotility.isActionAvailable('handbrake'),
      pseudopodLobe: this.cellMotility.isActionAvailable('pseudopodLobe')
    } : undefined;
    
    const motilityInfo = {
      speed: motilityState.speed,
      adhesionCount: motilityState.adhesion.count,
      atpDrain: motilityState.atpDrainPerSecond,
      mode: motilityState.mode,
      substrate: motilityState.currentSubstrate,
      currentMotilityMode: {
        id: currentMode.id,
        name: currentMode.name,
        icon: currentMode.icon
      },
      modeState: {
        blebCooldown: modeState.blebbing.cooldownRemaining / 1000,
        adhesionMaturity: motilityState.adhesion.maturity,
        proteaseActive: modeState.mesenchymal.proteaseActive,
        handbrakeAvailable: modeState.amoeboid.handbrakeAvailable
      },
      substrateEffects: substrateScalars,
      stateMeters,
      actionStates,
      visualEffects: this.cellMotility.getVisualEffects()
    };
    
    setHud(this, { 
      message: `${courseStatus}\n\n💡 Press M to toggle debug meters`,
      motilityInfo,
      driveMode: true,
      debugMode: this.debugMode
    });
  }
}
