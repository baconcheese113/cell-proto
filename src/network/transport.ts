/**
 * Network Transport Layer - WebRTC DataChannels for Cell Proto
 * 
 * Handles WebRTC connection establishment, data channel management,
 * and message routing for multiplayer gameplay.
 */

export interface RoomConfig {
  code: string;
  isHost: boolean;
  signalingUrl?: string; // Default to local dev server
}

export interface NetworkMessage {
  type: string;
  seq?: number;
  timestamp: number;
  data: any;
}

export interface ConnectionStats {
  ping: number;
  sendRate: number; // messages per second
  recvRate: number;
  connected: boolean;
  reliableChannel: boolean;
  unreliableChannel: boolean;
}

export type ConnectionEventType = 'connected' | 'disconnected' | 'error' | 'message';

export interface ConnectionEvent {
  type: ConnectionEventType;
  data?: any;
  error?: string;
}

export class NetworkTransport extends EventTarget {
  private peerConnection?: RTCPeerConnection;
  private reliableChannel?: RTCDataChannel;
  private unreliableChannel?: RTCDataChannel;
  private websocket?: WebSocket;
  
  private roomCode: string = '';
  private isHost: boolean = false;
  private connected: boolean = false;
  
  // Dev tools for testing
  private artificialLatency: number = 0; // ms
  private packetLossRate: number = 0; // 0-1
  private networkLogging: boolean = false;
  
  // Stats tracking
  private stats: ConnectionStats = {
    ping: 0,
    sendRate: 0,
    recvRate: 0,
    connected: false,
    reliableChannel: false,
    unreliableChannel: false
  };
  
  private lastPingTime: number = 0;
  private messagesSent: number = 0;
  private messagesReceived: number = 0;
  private lastStatsUpdate: number = 0;
  
  private signalingUrl: string;
  
  constructor() {
    super();
    this.signalingUrl = this.getSignalingUrl();
  }
  
  private getSignalingUrl(): string {
    // Use local dev server by default, can be overridden for production
    return 'ws://localhost:8080';
  }
  
  /**
   * Create a new room as host
   */
  async createRoom(roomCode?: string): Promise<string> {
    this.roomCode = roomCode || this.generateRoomCode();
    this.isHost = true;
    
    await this.setupPeerConnection();
    await this.connectToSignaling();
    
    return this.roomCode;
  }
  
  /**
   * Join an existing room as client
   */
  async joinRoom(code: string): Promise<void> {
    this.roomCode = code;
    this.isHost = false;
    
    await this.setupPeerConnection();
    await this.connectToSignaling();
  }
  
  /**
   * Send a message over the reliable channel
   */
  sendReliable(message: NetworkMessage): void {
    // Only log channel state on errors or first few messages
    if (!this.reliableChannel || this.reliableChannel.readyState !== 'open') {
      console.log(`🔍 Attempting to send reliable message, channel state:`, {
        hasChannel: !!this.reliableChannel,
        readyState: this.reliableChannel?.readyState,
        connected: this.connected
      });
    }
    
    if (!this.reliableChannel || this.reliableChannel.readyState !== 'open') {
      console.warn('❌ Reliable channel not ready:', {
        hasChannel: !!this.reliableChannel,
        readyState: this.reliableChannel?.readyState
      });
      return;
    }
    
    // Apply artificial packet loss simulation
    if (this.packetLossRate > 0 && Math.random() < this.packetLossRate) {
      if (this.networkLogging) {
        console.log('📉 DROPPED reliable message (simulated packet loss)');
      }
      return;
    }
    
    message.timestamp = Date.now();
    const messageStr = JSON.stringify(message);
    
    if (this.networkLogging) {
      console.log('📤 SEND reliable:', message.type, messageStr.length, 'bytes');
    }
    
    // Only log sending for important messages, not routine network traffic
    if (message.type !== 'snapshot' && message.type !== 'input' && message.type !== 'command') {
      console.log(`🚀 Sending reliable message: ${message.type}, ${messageStr.length} bytes`);
    }
    
    // Apply artificial latency
    if (this.artificialLatency > 0) {
      setTimeout(() => {
        this.reliableChannel!.send(messageStr);
      }, this.artificialLatency);
    } else {
      this.reliableChannel.send(messageStr);
    }
    
    this.messagesSent++;
  }
  
  /**
   * Send a message over the unreliable channel (for high-frequency updates)
   */
  sendUnreliable(message: NetworkMessage): void {
    if (!this.unreliableChannel || this.unreliableChannel.readyState !== 'open') {
      console.warn('Unreliable channel not ready');
      return;
    }
    
    // Apply artificial packet loss simulation (higher rate for unreliable)
    if (this.packetLossRate > 0 && Math.random() < this.packetLossRate * 1.5) {
      if (this.networkLogging) {
        console.log('📉 DROPPED unreliable message (simulated packet loss)');
      }
      return;
    }
    
    message.timestamp = Date.now();
    const messageStr = JSON.stringify(message);
    
    if (this.networkLogging) {
      console.log('📤 SEND unreliable:', message.type, messageStr.length, 'bytes');
    }
    
    // Apply artificial latency
    if (this.artificialLatency > 0) {
      setTimeout(() => {
        this.unreliableChannel!.send(messageStr);
      }, this.artificialLatency);
    } else {
      this.unreliableChannel.send(messageStr);
    }
    
    this.messagesSent++;
  }
  
  /**
   * Send a ping to measure RTT
   */
  ping(): void {
    if (!this.connected) return;
    
    this.lastPingTime = Date.now();
    this.sendReliable({
      type: 'ping',
      timestamp: this.lastPingTime,
      data: null
    });
  }
  
  /**
   * Get current connection statistics
   */
  getStats(): ConnectionStats {
    return { ...this.stats };
  }
  
  /**
   * Update connection statistics (call periodically)
   */
  updateStats(): void {
    const now = Date.now();
    const deltaTime = (now - this.lastStatsUpdate) / 1000;
    
    if (deltaTime > 0) {
      this.stats.sendRate = this.messagesSent / deltaTime;
      this.stats.recvRate = this.messagesReceived / deltaTime;
      
      this.messagesSent = 0;
      this.messagesReceived = 0;
      this.lastStatsUpdate = now;
    }
    
    this.stats.connected = this.connected;
    this.stats.reliableChannel = this.reliableChannel?.readyState === 'open';
    this.stats.unreliableChannel = this.unreliableChannel?.readyState === 'open';
  }
  
  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.connected = false;
    
    if (this.reliableChannel) {
      this.reliableChannel.close();
    }
    
    if (this.unreliableChannel) {
      this.unreliableChannel.close();
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    
    if (this.websocket) {
      this.websocket.close();
    }
    
    this.dispatchConnectionEvent('disconnected');
  }
  
  // Development Tools
  
  /**
   * Set artificial latency for testing (0 to disable)
   */
  setArtificialLatency(ms: number): void {
    this.artificialLatency = Math.max(0, ms);
    console.log(`🌐 Artificial latency set to ${this.artificialLatency}ms`);
  }
  
  /**
   * Set packet loss rate for testing (0-1, 0 to disable)
   */
  setPacketLossRate(rate: number): void {
    this.packetLossRate = Math.max(0, Math.min(1, rate));
    console.log(`📉 Packet loss rate set to ${(this.packetLossRate * 100).toFixed(1)}%`);
  }
  
  /**
   * Toggle network message logging
   */
  toggleNetworkLogging(): boolean {
    this.networkLogging = !this.networkLogging;
    console.log(`📋 Network logging ${this.networkLogging ? 'enabled' : 'disabled'}`);
    return this.networkLogging;
  }
  
  /**
   * Get development statistics
   */
  getDevStats() {
    return {
      artificialLatency: this.artificialLatency,
      packetLossRate: this.packetLossRate,
      networkLogging: this.networkLogging,
      ...this.stats
    };
  }
  
  private async setupPeerConnection(): Promise<void> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
    
    // Set up data channels
    if (this.isHost) {
      this.setupDataChannels();
    } else {
      this.peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        
        if (channel.label === 'reliable') {
          this.reliableChannel = channel;
          this.setupChannelHandlers(this.reliableChannel);
        } else if (channel.label === 'unreliable') {
          this.unreliableChannel = channel;
          this.setupChannelHandlers(this.unreliableChannel);
        }
      };
    }
    
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.websocket) {
        this.websocket.send(JSON.stringify({
          type: 'ice-candidate',
          roomCode: this.roomCode,
          candidate: event.candidate
        }));
      }
    };
    
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection!.connectionState;
      console.log('WebRTC connection state:', state);
      
      if (state === 'connected') {
        this.connected = true;
        this.lastStatsUpdate = Date.now();
        this.dispatchConnectionEvent('connected');
      } else if (state === 'disconnected' || state === 'failed') {
        this.connected = false;
        this.dispatchConnectionEvent('disconnected');
      }
    };
  }
  
  private setupDataChannels(): void {
    if (!this.peerConnection) return;
    
    // Reliable channel for critical messages
    this.reliableChannel = this.peerConnection.createDataChannel('reliable', {
      ordered: true,
      maxRetransmits: 3
    });
    
    // Unreliable channel for high-frequency updates
    this.unreliableChannel = this.peerConnection.createDataChannel('unreliable', {
      ordered: false,
      maxRetransmits: 0
    });
    
    this.setupChannelHandlers(this.reliableChannel);
    this.setupChannelHandlers(this.unreliableChannel);
  }
  
  private setupChannelHandlers(channel: RTCDataChannel): void {
    channel.onopen = () => {
      console.log(`✅ Data channel ${channel.label} opened - ready for communication!`);
      
      // Update stats when channels open
      if (channel.label === 'reliable') {
        this.stats.reliableChannel = true;
      } else if (channel.label === 'unreliable') {
        this.stats.unreliableChannel = true;
      }
      
      // Check if both channels are ready
      if (this.stats.reliableChannel && this.stats.unreliableChannel && !this.stats.connected) {
        console.log('🎉 Both data channels ready - marking as connected');
        this.stats.connected = true;
        this.connected = true;
        this.dispatchConnectionEvent('connected');
      }
    };
    
    channel.onmessage = (event) => {
      try {
        const message: NetworkMessage = JSON.parse(event.data);
        // Only log non-routine messages and occasionally log routine ones to reduce spam
        if (message.type !== 'input' && message.type !== 'snapshot') {
          console.log(`📥 Received ${channel.label} message:`, message.type);
        } else if (Math.random() < 0.002) { // Log ~0.2% of routine messages
          console.log(`📥 Received ${channel.label} message:`, message.type);
        }
        this.handleMessage(message);
        this.messagesReceived++;
      } catch (error) {
        console.error('Failed to parse network message:', error);
      }
    };
    
    channel.onerror = (error) => {
      console.error(`❌ Data channel ${channel.label} error:`, error);
      this.dispatchConnectionEvent('error', { error: error.toString() });
    };
    
    channel.onclose = () => {
      console.warn(`❌ Data channel ${channel.label} closed`);
      if (channel.label === 'reliable') {
        this.stats.reliableChannel = false;
      } else if (channel.label === 'unreliable') {
        this.stats.unreliableChannel = false;
      }
    };
  }
  
  private async connectToSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(this.signalingUrl);
      
      // Store resolve/reject for room response handling
      let roomResponseReceived = false;
      
      this.websocket.onopen = () => {
        console.log('Connected to signaling server');
        
        // Join or create room
        this.websocket!.send(JSON.stringify({
          type: this.isHost ? 'create-room' : 'join-room',
          roomCode: this.roomCode
        }));
        
        // Don't resolve yet - wait for room response
      };
      
      this.websocket.onerror = (error) => {
        console.error('Signaling WebSocket error:', error);
        if (!roomResponseReceived) {
          reject(error);
        }
      };
      
      this.websocket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle room-related responses first
          if (!roomResponseReceived) {
            switch (message.type) {
              case 'room-created':
                console.log(`Room ${message.roomCode} created successfully`);
                roomResponseReceived = true;
                resolve();
                return;
                
              case 'room-joined':
                console.log(`Joined room ${message.roomCode} successfully`);
                roomResponseReceived = true;
                resolve();
                return;
                
              case 'room-not-found':
                console.log('Room not found');
                roomResponseReceived = true;
                reject(new Error('Room not found'));
                return;
                
              case 'room-full':
                console.log('Room is full');
                roomResponseReceived = true;
                reject(new Error('Room is full'));
                return;
                
              case 'error':
                console.error('Signaling error:', message.error);
                roomResponseReceived = true;
                reject(new Error(message.error));
                return;
            }
          }
          
          // Handle other signaling messages
          await this.handleSignalingMessage(message);
        } catch (error) {
          console.error('Failed to handle signaling message:', error);
          if (!roomResponseReceived) {
            reject(error);
          }
        }
      };
    });
  }
  
  private async handleSignalingMessage(message: any): Promise<void> {
    if (!this.peerConnection) return;
    
    switch (message.type) {
      case 'offer':
        await this.peerConnection.setRemoteDescription(message.offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.websocket!.send(JSON.stringify({
          type: 'answer',
          roomCode: this.roomCode,
          answer: answer
        }));
        break;
        
      case 'answer':
        await this.peerConnection.setRemoteDescription(message.answer);
        break;
        
      case 'ice-candidate':
        await this.peerConnection.addIceCandidate(message.candidate);
        break;
        
      case 'peer-joined':
        if (this.isHost) {
          // Create offer for new peer
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          
          this.websocket!.send(JSON.stringify({
            type: 'offer',
            roomCode: this.roomCode,
            offer: offer
          }));
        }
        break;
        
      // Room responses are now handled in connectToSignaling()
      // Just ignore them here if they come through after connection is established
      case 'room-full':
      case 'room-not-found':
      case 'room-created':
      case 'room-joined':
        // Already handled during connection establishment
        break;
    }
  }
  
  private handleMessage(message: NetworkMessage): void {
    // Handle special messages
    switch (message.type) {
      case 'ping':
        // Reply with pong
        this.sendReliable({
          type: 'pong',
          timestamp: Date.now(),
          data: { originalTimestamp: message.timestamp }
        });
        break;
        
      case 'pong':
        // Calculate RTT
        if (message.data?.originalTimestamp === this.lastPingTime) {
          this.stats.ping = Date.now() - this.lastPingTime;
        }
        break;
        
      default:
        // Forward to application layer
        this.dispatchConnectionEvent('message', message);
        break;
    }
  }
  
  private dispatchConnectionEvent(type: ConnectionEventType, data?: any): void {
    this.dispatchEvent(new CustomEvent('connection', {
      detail: { type, data } as ConnectionEvent
    }));
  }
  
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
