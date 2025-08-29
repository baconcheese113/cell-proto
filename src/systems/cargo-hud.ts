/**
 * Milestone 12 - Cargo HUD Component
 * 
 * Story 12.1: HUD chip shows carried item type, TTL, and next valid targets
 * Displays unified cargo information with visual indicators
 */

import type { UnifiedCargoSystem, CargoType } from "./unified-cargo-system";

export interface CargoHUDConfig {
  position: { x: number; y: number };
  width: number;
  height: number;
  backgroundColor: number;
  textColor: string;
  fontSize: number;
}

export class CargoHUD {
  private container!: Phaser.GameObjects.Container;
  private background!: Phaser.GameObjects.Graphics;
  private cargoIcon!: Phaser.GameObjects.Graphics;
  private cargoTypeText!: Phaser.GameObjects.Text;
  private ttlBar!: Phaser.GameObjects.Graphics;
  private ttlText!: Phaser.GameObjects.Text;
  private targetsText!: Phaser.GameObjects.Text;
  
  private config: CargoHUDConfig;
  private isVisible = false;
  
  constructor(
    private scene: Phaser.Scene,
    private cargoSystem: UnifiedCargoSystem,
    config: Partial<CargoHUDConfig> = {}
  ) {
    this.config = {
      position: { x: 20, y: 20 },
      width: 220,
      height: 100,
      backgroundColor: 0x000000,
      textColor: '#ffffff',
      fontSize: 12,
      ...config
    };
    
    this.createHUDElements();
  }
  
  private createHUDElements(): void {
    // Create container
    this.container = this.scene.add.container(this.config.position.x, this.config.position.y);
    this.container.setDepth(100); // High depth for UI
    
    // Background
    this.background = this.scene.add.graphics();
    this.background.fillStyle(this.config.backgroundColor, 0.8);
    this.background.lineStyle(1, 0x444444, 1);
    this.background.fillRoundedRect(0, 0, this.config.width, this.config.height, 8);
    this.background.strokeRoundedRect(0, 0, this.config.width, this.config.height, 8);
    this.container.add(this.background);
    
    // Cargo icon
    this.cargoIcon = this.scene.add.graphics();
    this.container.add(this.cargoIcon);
    
    // Cargo type text
    this.cargoTypeText = this.scene.add.text(50, 10, '', {
      fontSize: this.config.fontSize + 2,
      color: this.config.textColor,
      fontFamily: 'Arial'
    });
    this.container.add(this.cargoTypeText);
    
    // TTL bar background
    this.ttlBar = this.scene.add.graphics();
    this.container.add(this.ttlBar);
    
    // TTL text
    this.ttlText = this.scene.add.text(50, 30, '', {
      fontSize: this.config.fontSize,
      color: this.config.textColor,
      fontFamily: 'Arial'
    });
    this.container.add(this.ttlText);
    
    // Targets text
    this.targetsText = this.scene.add.text(10, 50, '', {
      fontSize: this.config.fontSize - 1,
      color: this.config.textColor,
      fontFamily: 'Arial',
      wordWrap: { width: this.config.width - 20 }
    });
    this.container.add(this.targetsText);
    
    // Initially hidden
    this.container.setVisible(false);
  }
  
  public update(): void {
    const hudInfo = this.cargoSystem.getHUDInfo();
    
    if (hudInfo) {
      if (!this.isVisible) {
        this.container.setVisible(true);
        this.isVisible = true;
      }
      
      this.updateCargoDisplay(hudInfo);
    } else {
      if (this.isVisible) {
        this.container.setVisible(false);
        this.isVisible = false;
      }
    }
  }
  
  private updateCargoDisplay(hudInfo: {
    type: CargoType;
    ttlRemaining: number;
    ttlPercent: number;
    targets: Array<{ targetType: string; distance: number; isValid: boolean }>;
  }): void {
    // Update cargo icon
    this.updateCargoIcon(hudInfo.type);
    
    // Update cargo type text
    this.cargoTypeText.setText(this.getCargoDisplayName(hudInfo.type));
    
    // Update TTL display
    this.updateTTLDisplay(hudInfo.ttlRemaining, hudInfo.ttlPercent);
    
    // Update targets display
    this.updateTargetsDisplay(hudInfo.targets);
  }
  
  private updateCargoIcon(type: CargoType): void {
    this.cargoIcon.clear();
    
    const iconSize = 30;
    const iconX = 10;
    const iconY = 10;
    
    if (type === 'transcript') {
      // Draw transcript icon (DNA-like double helix)
      this.cargoIcon.lineStyle(2, 0xff4444, 1);
      this.cargoIcon.fillStyle(0xff4444, 0.6);
      
      // Simple representation as a coiled line
      this.cargoIcon.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const x = iconX + t * iconSize;
        const y = iconY + iconSize/2 + Math.sin(t * Math.PI * 4) * 8;
        
        if (i === 0) {
          this.cargoIcon.moveTo(x, y);
        } else {
          this.cargoIcon.lineTo(x, y);
        }
      }
      this.cargoIcon.strokePath();
      
    } else {
      // Draw vesicle icon (circle with membrane)
      this.cargoIcon.lineStyle(2, 0x4444ff, 1);
      this.cargoIcon.fillStyle(0x4444ff, 0.3);
      this.cargoIcon.fillCircle(iconX + iconSize/2, iconY + iconSize/2, iconSize/2 - 2);
      this.cargoIcon.strokeCircle(iconX + iconSize/2, iconY + iconSize/2, iconSize/2 - 2);
      
      // Add inner cargo representation
      this.cargoIcon.fillStyle(0x6666ff, 0.8);
      this.cargoIcon.fillCircle(iconX + iconSize/2, iconY + iconSize/2, 4);
    }
  }
  
  private updateTTLDisplay(ttlRemaining: number, ttlPercent: number): void {
    // Update TTL text
    const minutes = Math.floor(ttlRemaining / 60);
    const seconds = Math.floor(ttlRemaining % 60);
    this.ttlText.setText(`TTL: ${minutes}:${seconds.toString().padStart(2, '0')}`);

    // Update TTL bar
    this.ttlBar.clear();
    
    const barWidth = 150;
    const barHeight = 8;
    const barX = 50;
    const barY = 40;
    
    // Background bar
    this.ttlBar.fillStyle(0x333333, 1);
    this.ttlBar.fillRect(barX, barY, barWidth, barHeight);
    
    // TTL bar (color changes based on remaining time)
    let barColor = 0x44ff44; // Green
    if (ttlPercent < 0.5) barColor = 0xffff44; // Yellow
    if (ttlPercent < 0.25) barColor = 0xff4444; // Red
    
    this.ttlBar.fillStyle(barColor, 1);
    this.ttlBar.fillRect(barX, barY, barWidth * Math.max(0, ttlPercent), barHeight);
    
    // Border
    this.ttlBar.lineStyle(1, 0x666666, 1);
    this.ttlBar.strokeRect(barX, barY, barWidth, barHeight);
  }
  
  private updateTargetsDisplay(targets: Array<{ targetType: string; distance: number; isValid: boolean }>): void {
    let targetsText = "Targets:\n";
    
    if (targets.length === 0) {
      targetsText += "None available";
    } else {
      for (let i = 0; i < Math.min(3, targets.length); i++) { // Show max 3 targets
        const target = targets[i];
        const distance = Math.round(target.distance);
        const status = target.isValid ? "✓" : "○";
        
        targetsText += `${status} ${target.targetType} (${distance}px)\n`;
      }
      
      if (targets.length > 3) {
        targetsText += `... +${targets.length - 3} more`;
      }
    }
    
    this.targetsText.setText(targetsText);
  }
  
  private getCargoDisplayName(type: CargoType): string {
    switch (type) {
      case 'transcript':
        return "Transcript";
      case 'vesicle':
        return "Vesicle";
      default:
        return "Unknown";
    }
  }
  
  public setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }
  
  public setVisible(visible: boolean): void {
    this.container.setVisible(visible);
    this.isVisible = visible;
  }
  
  public destroy(): void {
    this.container.destroy();
  }
}
