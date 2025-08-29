/**
 * Network HUD - Shows connection stats and debug info
 */

import type { NetworkTransport } from './transport';

export interface NetHUDConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
}

export class NetHUD extends Phaser.GameObjects.Container {
  private transport: NetworkTransport;
  private background!: Phaser.GameObjects.Rectangle;
  private statsText!: Phaser.GameObjects.Text;
  private predictionText!: Phaser.GameObjects.Text;
  private isNetHUDVisible: boolean = false;
  
  // Reference to NetSyncSystem for prediction stats
  private netSyncSystem?: any;
  
  constructor(config: NetHUDConfig, transport: NetworkTransport) {
    super(config.scene, config.x, config.y);
    this.transport = transport;
    
    this.createHUD();
    config.scene.add.existing(this);
    this.setDepth(999);
    this.setVisible(false);
  }
  
  private createHUD(): void {
    // Background (larger for more info)
    this.background = this.scene.add.rectangle(0, 0, 280, 200, 0x000000, 0.8);
    this.background.setStrokeStyle(1, 0x444444);
    
    // Main stats text
    this.statsText = this.scene.add.text(-135, -95, '', {
      fontSize: '11px',
      color: '#00ff00',
      fontFamily: 'monospace'
    });
    
    // Prediction stats text
    this.predictionText = this.scene.add.text(-135, -20, '', {
      fontSize: '10px',
      color: '#ffff00',
      fontFamily: 'monospace'
    });
    
    this.add([this.background, this.statsText, this.predictionText]);
  }
  
  public override update(): void {
    if (!this.isNetHUDVisible) return;
    
    this.transport.updateStats();
    const stats = this.transport.getStats();
    const devStats = this.transport.getDevStats();
    
    // Main network stats
    const mainText = [
      '=== NETWORK DEBUG ===',
      `Ping: ${stats.ping}ms`,
      `Send: ${stats.sendRate.toFixed(1)}/s`,
      `Recv: ${stats.recvRate.toFixed(1)}/s`,
      `Connected: ${stats.connected ? 'YES' : 'NO'}`,
      `Reliable: ${stats.reliableChannel ? 'OK' : 'FAIL'}`,
      `Unreliable: ${stats.unreliableChannel ? 'OK' : 'FAIL'}`,
      '',
      '=== DEV TOOLS ===',
      `Latency: +${devStats.artificialLatency}ms`,
      `Packet Loss: ${(devStats.packetLossRate * 100).toFixed(1)}%`,
      `Logging: ${devStats.networkLogging ? 'ON' : 'OFF'}`
    ].join('\n');
    
    this.statsText.setText(mainText);
    
    // Prediction stats (if available)
    let predictionText = '=== PREDICTION ===\n';
    if (this.netSyncSystem) {
      const predStats = this.netSyncSystem.getPredictionStats();
      const entityStats = this.netSyncSystem.getEntityStats?.() || {};
      
      predictionText += [
        `Input Buffer: ${predStats.inputBufferSize}`,
        `Snapshots: ${predStats.snapshotCount}`,
        `Last Ack: ${predStats.lastAckedInput}`,
        `Unacked: ${predStats.unackedInputs}`,
        '',
        '=== ENTITIES ===',
        `Cargo: ${entityStats.cargoCount || 0}`,
        `Seats: ${entityStats.seatCount || 0}`,
        `Rails: ${entityStats.railCount || 0}`
      ].join('\n');
    } else {
      predictionText += 'Not connected';
    }
    
    this.predictionText.setText(predictionText);
    
    // Color based on connection quality
    if (!stats.connected) {
      this.statsText.setColor('#ff6666');
    } else if (stats.ping > 200) {
      this.statsText.setColor('#ffff66');
    } else {
      this.statsText.setColor('#66ff66');
    }
  }
  
  public show(): void {
    this.isNetHUDVisible = true;
    this.setVisible(true);
  }
  
  public hide(): void {
    this.isNetHUDVisible = false;
    this.setVisible(false);
  }
  
  public toggle(): void {
    if (this.isNetHUDVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  /**
   * Set reference to NetSyncSystem for prediction stats
   */
  public setNetSyncSystem(netSyncSystem: any): void {
    this.netSyncSystem = netSyncSystem;
  }
}
