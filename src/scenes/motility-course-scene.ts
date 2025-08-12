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
    this.keys = this.input.keyboard?.addKeys('W,A,S,D,SPACE,TAB,X,Z,R,ESC') as any;
    
    // Reset course
    this.input.keyboard?.on('keydown-R', () => {
      this.resetCourse();
    });
    
    // Return to main game
    this.input.keyboard?.on('keydown-ESC', () => {
      this.scene.start('GameScene');
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
    
    // Center camera on start area
    this.cameras.main.centerOn(-450, 0);
  }
  
  override update(): void {
    // Update systems
    this.cellMotility.updateInput(this.keys);
    
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
    
    // Export stats
    const stats = {
      totalTime,
      zoneTimes: this.zoneTimes,
      finalMode: this.cellMotility.getModeRegistry().getCurrentMode().name
    };
    
    console.log('Course completed!', stats);
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
      substrateEffects: substrateScalars
    };
    
    setHud(this, { 
      message: courseStatus,
      motilityInfo,
      driveMode: true
    });
  }
}
