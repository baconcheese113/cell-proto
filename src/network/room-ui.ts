/**
 * Room Management UI for Cell Proto Multiplayer
 * 
 * Handles creating/joining rooms and connection status display
 */

import type { NetworkTransport, ConnectionEvent } from './transport';

export interface RoomUIConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
}

export class RoomUI extends Phaser.GameObjects.Container {
  private transport: NetworkTransport;
  private background!: Phaser.GameObjects.Rectangle;
  private titleText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private codeText!: Phaser.GameObjects.Text;
  private createButton!: Phaser.GameObjects.Rectangle;
  private createButtonText!: Phaser.GameObjects.Text;
  private joinButton!: Phaser.GameObjects.Rectangle;
  private joinButtonText!: Phaser.GameObjects.Text;
  private codeInput!: HTMLInputElement;
  private isVisible: boolean = false;
  
  // Connection state
  private roomCode: string = '';
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private isHost: boolean = false;
  private inputHasFocus: boolean = false;
  
  constructor(config: RoomUIConfig, transport: NetworkTransport) {
    super(config.scene, config.x, config.y);
    this.transport = transport;
    
    this.createUI();
    this.setupEventHandlers();
    
    config.scene.add.existing(this);
    this.setDepth(1000); // High depth to appear above game elements
    this.setVisible(false);
  }
  
  private createUI(): void {
    // Background panel
    this.background = this.scene.add.rectangle(0, 0, 400, 300, 0x1a1a1a, 0.95);
    this.background.setStrokeStyle(2, 0x444444);
    
    // Title
    this.titleText = this.scene.add.text(0, -120, 'Cell Proto Multiplayer', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial'
    });
    this.titleText.setOrigin(0.5);
    
    // Status text
    this.statusText = this.scene.add.text(0, -80, 'Ready to connect', {
      fontSize: '16px',
      color: '#cccccc',
      fontFamily: 'Arial'
    });
    this.statusText.setOrigin(0.5);
    
    // Room code display
    this.codeText = this.scene.add.text(0, -40, '', {
      fontSize: '20px',
      color: '#00ff00',
      fontFamily: 'monospace'
    });
    this.codeText.setOrigin(0.5);
    
    // Create Room button
    this.createButton = this.scene.add.rectangle(-80, 20, 140, 40, 0x4a90e2);
    this.createButton.setStrokeStyle(2, 0x6ba6f2);
    this.createButton.setInteractive();
    
    this.createButtonText = this.scene.add.text(-80, 20, 'Quick Join', {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial'
    });
    this.createButtonText.setOrigin(0.5);
    
    // Join Room button
    this.joinButton = this.scene.add.rectangle(80, 20, 140, 40, 0x5cb85c);
    this.joinButton.setStrokeStyle(2, 0x7cc87c);
    this.joinButton.setInteractive();
    
    this.joinButtonText = this.scene.add.text(80, 20, 'Join Code', {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial'
    });
    this.joinButtonText.setOrigin(0.5);
    
    // Create HTML input for room code (positioned absolutely)
    this.codeInput = document.createElement('input');
    this.codeInput.type = 'text';
    this.codeInput.placeholder = 'Enter Room Code';
    this.codeInput.maxLength = 6;
    this.codeInput.style.position = 'absolute';
    this.codeInput.style.left = '50%';
    this.codeInput.style.top = '60%';
    this.codeInput.style.transform = 'translate(-50%, -50%)';
    this.codeInput.style.width = '150px';
    this.codeInput.style.height = '30px';
    this.codeInput.style.fontSize = '16px';
    this.codeInput.style.textAlign = 'center';
    this.codeInput.style.textTransform = 'uppercase';
    this.codeInput.style.border = '2px solid #444444';
    this.codeInput.style.backgroundColor = '#2a2a2a';
    this.codeInput.style.color = '#ffffff';
    this.codeInput.style.display = 'none';
    document.body.appendChild(this.codeInput);
    
    // Add all elements to container
    this.add([
      this.background,
      this.titleText,
      this.statusText,
      this.codeText,
      this.createButton,
      this.createButtonText,
      this.joinButton,
      this.joinButtonText
    ]);
  }
  
  private setupEventHandlers(): void {
    // Simple "Join Game" button - tries to join default room first, creates if needed
    this.createButton.on('pointerdown', async () => {
      if (this.connectionStatus === 'connected') return;
      
      this.setConnectionStatus('connecting');
      const defaultRoomCode = 'CELL01'; // Fixed room code for easy testing
      
      // First try to join the default room
      this.updateStatus('Looking for existing game...');
      
      try {
        await this.transport.joinRoom(defaultRoomCode);
        this.roomCode = defaultRoomCode;
        this.isHost = false;
        this.codeText.setText(`Room Code: ${this.roomCode} (CLIENT)`);
        this.updateStatus('Connecting to host...');
      } catch (error) {
        // If join fails, create the room as host
        console.log('No existing game found, creating as host...');
        try {
          this.roomCode = await this.transport.createRoom(defaultRoomCode);
          this.isHost = true;
          this.codeText.setText(`Room Code: ${this.roomCode} (HOST)`);
          this.updateStatus('Waiting for players to join...');
        } catch (createError) {
          console.error('Failed to create room:', createError);
          this.updateStatus('Failed to create game');
          this.setConnectionStatus('disconnected');
        }
      }
    });
    
    // Keep join button for manual room codes if needed
    this.joinButton.on('pointerdown', async () => {
      if (this.connectionStatus === 'connected') return;
      
      const code = this.codeInput.value.trim().toUpperCase();
      if (code.length !== 6) {
        this.updateStatus('Please enter a 6-character room code');
        return;
      }
      
      this.setConnectionStatus('connecting');
      this.updateStatus('Joining room...');
      
      try {
        await this.transport.joinRoom(code);
        this.roomCode = code;
        this.isHost = false;
        this.codeText.setText(`Room Code: ${this.roomCode} (CLIENT)`);
        this.updateStatus('Connecting to host...');
      } catch (error) {
        console.error('Failed to join room:', error);
        this.updateStatus('Failed to join room');
        this.setConnectionStatus('disconnected');
      }
    });
    
    // Network transport events
    this.transport.addEventListener('connection', (event: any) => {
      const connectionEvent = event.detail as ConnectionEvent;
      this.handleConnectionEvent(connectionEvent);
    });
    
    // Room code input validation
    this.codeInput.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      target.value = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
    
    // Focus management to prevent game input interference
    this.codeInput.addEventListener('focus', () => {
      this.inputHasFocus = true;
    });
    
    this.codeInput.addEventListener('blur', () => {
      this.inputHasFocus = false;
    });
    
    // Consume all keyboard events when input has focus (except escape and F keys)
    this.codeInput.addEventListener('keydown', (e) => {
      if (this.inputHasFocus) {
        // Allow escape to close and F keys for dev tools
        if (e.key === 'Escape' || e.key.startsWith('F')) {
          return; // Let these pass through
        }
        // Consume all other keys to prevent game input
        e.stopPropagation();
      }
    });
  }
  
  private handleConnectionEvent(event: ConnectionEvent): void {
    switch (event.type) {
      case 'connected':
        this.setConnectionStatus('connected');
        if (this.isHost) {
          this.updateStatus('Player connected! Ready to play.');
        } else {
          this.updateStatus('Connected to host! Ready to play.');
        }
        
        // Auto-hide UI after successful connection
        this.scene.time.delayedCall(2000, () => {
          this.setVisible(false);
        });
        break;
        
      case 'disconnected':
        this.setConnectionStatus('disconnected');
        this.updateStatus('Disconnected from game');
        this.setVisible(true);
        break;
        
      case 'error':
        this.setConnectionStatus('disconnected');
        this.updateStatus(`Error: ${event.data?.error || 'Unknown error'}`);
        break;
    }
  }
  
  private setConnectionStatus(status: 'disconnected' | 'connecting' | 'connected'): void {
    this.connectionStatus = status;
    
    // Update button interactivity
    const buttonsEnabled = status === 'disconnected';
    this.createButton.setInteractive(buttonsEnabled);
    this.joinButton.setInteractive(buttonsEnabled);
    
    // Update button colors
    if (buttonsEnabled) {
      this.createButton.setFillStyle(0x4a90e2);
      this.joinButton.setFillStyle(0x5cb85c);
    } else {
      this.createButton.setFillStyle(0x666666);
      this.joinButton.setFillStyle(0x666666);
    }
  }
  
  private updateStatus(message: string): void {
    this.statusText.setText(message);
    
    // Color coding based on status
    if (message.includes('Error') || message.includes('Failed')) {
      this.statusText.setColor('#ff6b6b');
    } else if (message.includes('Connected') || message.includes('Ready')) {
      this.statusText.setColor('#51cf66');
    } else {
      this.statusText.setColor('#ffd43b');
    }
  }
  
  public show(): void {
    this.setVisible(true);
    this.isVisible = true;
    this.codeInput.style.display = 'block';
    
    // Auto-focus the input field when room UI opens
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      this.codeInput.focus();
    }, 50);
  }
  
  public hide(): void {
    this.setVisible(false);
    this.isVisible = false;
    this.codeInput.style.display = 'none';
    
    // Clear focus when hiding
    this.codeInput.blur();
    this.inputHasFocus = false;
  }
  
  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  public isConnected(): boolean {
    return this.connectionStatus === 'connected';
  }
  
  public getRoomCode(): string {
    return this.roomCode;
  }
  
  public isHostPlayer(): boolean {
    return this.isHost;
  }
  
  public getTransport(): NetworkTransport {
    return this.transport;
  }
  
  public hasInputFocus(): boolean {
    return this.inputHasFocus && this.isVisible;
  }
  
  public override destroy(): void {
    if (this.codeInput) {
      document.body.removeChild(this.codeInput);
    }
    super.destroy();
  }
}
