// Minimal Quick Join Room UI for networking without codes or transport events
// Simple Phaser-based UI with a single "Quick Join" button

import type { NetworkTransport } from './transport';

export interface RoomUIOptions {
  /** Phaser scene to create UI in */
  scene: Phaser.Scene;
  /** Function to connect quickly via WebRTC */
  connectQuick: () => Promise<{ transport: NetworkTransport; isHost: boolean; roomId: string }>;
  /** Called after successful connection */
  onConnected: (ctx: { transport: NetworkTransport; isHost: boolean; roomId: string }) => void;
}

/**
 * Simple Room UI with just a Quick Join button, no codes or transport events
 */
export class RoomUI {
  private scene: Phaser.Scene;
  private opts: RoomUIOptions;
  private visible = false;
  
  // UI Elements
  private container?: Phaser.GameObjects.Container;
  private blockingBackground?: Phaser.GameObjects.Graphics;
  private background?: Phaser.GameObjects.Graphics;
  private titleText?: Phaser.GameObjects.Text;
  private quickJoinButton?: Phaser.GameObjects.Graphics;
  private quickJoinText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  
  constructor(opts: RoomUIOptions) {
    this.scene = opts.scene;
    this.opts = opts;
    this.createUI();
    this.hide(); // Start hidden
  }

  private createUI(): void {
    const camera = this.scene.cameras.main;
    const screenCenterX = camera.width / 2;
    const screenCenterY = camera.height / 2;
    
    // Full-screen blocking background to prevent interaction with the rest of the game
    this.blockingBackground = this.scene.add.graphics();
    this.blockingBackground.fillStyle(0x000000, 0.3); // Semi-transparent black
    this.blockingBackground.fillRect(0, 0, camera.width, camera.height);
    this.blockingBackground.setInteractive(new Phaser.Geom.Rectangle(0, 0, camera.width, camera.height), Phaser.Geom.Rectangle.Contains);
    this.blockingBackground.setDepth(10000); // Much higher depth to ensure it's on top
    this.blockingBackground.setScrollFactor(0); // Fixed to camera, not affected by camera movement
    
    // Add click handler to blocking background to prevent clicks from going through
    this.blockingBackground.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Stop the event from propagating to objects behind the modal
      pointer.event.stopPropagation();
    });
    
    // Container for all UI elements - position in screen space
    this.container = this.scene.add.container(screenCenterX, screenCenterY);
    this.container.setDepth(10001); // Highest depth to ensure it's above everything
    this.container.setScrollFactor(0); // Fixed to camera, not affected by camera movement
    
    // Background panel
    this.background = this.scene.add.graphics();
    this.background.fillStyle(0x1a1a2e, 0.9);
    this.background.fillRoundedRect(-150, -100, 300, 200, 10);
    this.background.lineStyle(2, 0x16213e);
    this.background.strokeRoundedRect(-150, -100, 300, 200, 10);
    
    // Make background interactive to block clicks
    this.background.setInteractive(new Phaser.Geom.Rectangle(-150, -100, 300, 200), Phaser.Geom.Rectangle.Contains);
    this.background.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Stop event propagation for clicks on the modal background
      pointer.event.stopPropagation();
    });
    
    this.container.add(this.background);
    
    // Title
    this.titleText = this.scene.add.text(0, -60, 'Quick Join Room', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'Arial'
    });
    this.titleText.setOrigin(0.5);
    this.container.add(this.titleText);
    
    // Quick Join Button - add directly to scene at high depth, not to container
    this.quickJoinButton = this.scene.add.graphics();
    this.quickJoinButton.fillStyle(0x0077ff, 1);
    this.quickJoinButton.fillRoundedRect(-80, -15, 160, 30, 5);
    this.quickJoinButton.setInteractive(new Phaser.Geom.Rectangle(-80, -15, 160, 30), Phaser.Geom.Rectangle.Contains);
    this.quickJoinButton.setDepth(10002); // Ensure button is above everything else
    this.quickJoinButton.setScrollFactor(0); // Fixed to camera
    this.quickJoinButton.setPosition(screenCenterX, screenCenterY); // Position manually at container center
    
    this.quickJoinButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Stop event propagation and handle the click
      pointer.event.stopPropagation();
      this.onQuickJoin();
    });
    
    this.quickJoinButton.on('pointerover', () => {
      this.quickJoinButton!.clear();
      this.quickJoinButton!.fillStyle(0x0088ff, 1);
      this.quickJoinButton!.fillRoundedRect(-80, -15, 160, 30, 5);
    });
    this.quickJoinButton.on('pointerout', () => {
      this.quickJoinButton!.clear();
      this.quickJoinButton!.fillStyle(0x0077ff, 1);
      this.quickJoinButton!.fillRoundedRect(-80, -15, 160, 30, 5);
    });
    // Don't add button to container - it's positioned directly in scene
    
    // Button text - also add directly to scene
    this.quickJoinText = this.scene.add.text(screenCenterX, screenCenterY, 'Quick Join', {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial'
    });
    this.quickJoinText.setOrigin(0.5);
    this.quickJoinText.setDepth(10003); // Above button
    this.quickJoinText.setScrollFactor(0); // Fixed to camera
    
    // Status text
    this.statusText = this.scene.add.text(screenCenterX, screenCenterY + 40, 'Press F10 to open', {
      fontSize: '12px',
      color: '#aaaaaa',
      fontFamily: 'Arial'
    });
    this.statusText.setOrigin(0.5);
    this.statusText.setDepth(10003); // High depth
    this.statusText.setScrollFactor(0); // Fixed to camera
  }

  private async onQuickJoin(): Promise<void> {
    this.setStatus('Connecting...');
    this.quickJoinButton!.disableInteractive();
    
    try {
      const result = await this.opts.connectQuick();
      this.setStatus('Connected!');
      this.opts.onConnected(result);
      this.hide();
    } catch (error) {
      console.error('Quick join failed:', error);
      this.setStatus('Connection failed');
      this.quickJoinButton!.setInteractive();
    }
  }

  private setStatus(text: string): void {
    if (this.statusText) {
      this.statusText.setText(text);
    }
  }

  show(): void {
    this.visible = true;
    if (this.container) {
      this.container.setVisible(true);
    }
    if (this.blockingBackground) {
      this.blockingBackground.setVisible(true);
    }
    if (this.quickJoinButton) {
      this.quickJoinButton.setVisible(true);
    }
    if (this.quickJoinText) {
      this.quickJoinText.setVisible(true);
    }
    if (this.statusText) {
      this.statusText.setVisible(true);
    }
  }

  hide(): void {
    this.visible = false;
    if (this.container) {
      this.container.setVisible(false);
    }
    if (this.blockingBackground) {
      this.blockingBackground.setVisible(false);
    }
    if (this.quickJoinButton) {
      this.quickJoinButton.setVisible(false);
    }
    if (this.quickJoinText) {
      this.quickJoinText.setVisible(false);
    }
    if (this.statusText) {
      this.statusText.setVisible(false);
    }
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  destroy(): void {
    if (this.container) {
      this.container.destroy();
    }
    if (this.blockingBackground) {
      this.blockingBackground.destroy();
    }
    if (this.quickJoinButton) {
      this.quickJoinButton.destroy();
    }
    if (this.quickJoinText) {
      this.quickJoinText.destroy();
    }
    if (this.statusText) {
      this.statusText.destroy();
    }
  }
}
