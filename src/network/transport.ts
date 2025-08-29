// Minimal transport interface the NetBus expects, plus a tiny in-process LoopbackTransport
// you can use for local testing or single-tab prototypes.

export type PeerId = string;

export interface NetworkTransport {
  /** True if this peer is the authoritative host. */
  readonly isHost: boolean;
  /** Host's peer id (used by clients to send RPC). */
  readonly hostId: PeerId;
  /** Local peer id. */
  readonly localId: PeerId;

  /**
   * Send a message to a specific peer.
   * `reliable` is a hint for transports that support unreliable modes (ignored if unsupported).
   */
  send(to: PeerId, data: unknown, reliable?: boolean): void;

  /**
   * Subscribe to all inbound messages for this peer.
   * Returns an unsubscribe function.
   */
  onMessage(cb: (from: PeerId, data: unknown) => void): () => void;

  /** Current connected peers, including self. */
  peers(): ReadonlyArray<PeerId>;
}

/**
 * Simple local transport (same-process). Useful for single-player or unit tests.
 * - One instance represents one "peer".
 * - Peers register themselves in a static registry keyed by roomId.
 */
export class LoopbackTransport implements NetworkTransport {
  readonly isHost: boolean;
  readonly hostId: PeerId;
  readonly localId: PeerId;

  private static rooms = new Map<string, Map<PeerId, LoopbackTransport>>();
  private static counters = new Map<string, number>();

  private readonly roomId: string;
  private listeners = new Set<(from: PeerId, data: unknown) => void>();

  constructor(opts: { roomId: string; isHost: boolean }) {
    this.roomId = opts.roomId;
    const n = (LoopbackTransport.counters.get(this.roomId) ?? 0) + 1;
    LoopbackTransport.counters.set(this.roomId, n);
    this.localId = `peer-${n}`;
    this.isHost = opts.isHost;

    const room = LoopbackTransport.rooms.get(this.roomId) ?? new Map();
    LoopbackTransport.rooms.set(this.roomId, room);

    // First host we see becomes the hostId for the room.
    const existingHost = [...room.values()].find(t => t.isHost);
    this.hostId = existingHost?.localId ?? (this.isHost ? this.localId : 'peer-1');

    room.set(this.localId, this);
  }

  send(to: PeerId, data: unknown): void {
    const room = LoopbackTransport.rooms.get(this.roomId);
    const target = room?.get(to);
    if (!target) return;
    // Deliver on a microtask to mimic async transport behavior
    queueMicrotask(() => {
      for (const cb of target.listeners) cb(this.localId, data);
    });
  }

  onMessage(cb: (from: PeerId, data: unknown) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  peers(): ReadonlyArray<PeerId> {
    const room = LoopbackTransport.rooms.get(this.roomId);
    return room ? [...room.keys()] : [this.localId];
  }
}

/**
 * WebRTC transport that connects peers via signaling server.
 */
export class WebRTCTransport implements NetworkTransport {
  isHost: boolean; // Mutable since it gets set during room join/create
  readonly hostId: PeerId = "host";
  localId: PeerId;

  private roomId: string;
  private ws: WebSocket;
  private pc: RTCPeerConnection;
  private reliableChannel?: RTCDataChannel;
  private unreliableChannel?: RTCDataChannel;
  private listeners = new Set<(from: PeerId, data: unknown) => void>();
  private connected = false;
  private readyResolve?: () => void;
  
  readonly ready: Promise<void>;
  
  constructor(opts: {
    roomId: string;
    signalingUrl: string;
    iceServers?: RTCIceServer[];
  }) {
    this.localId = 'peer-1'; // crypto.randomUUID();
    this.isHost = false; // Will be set during room join/create
    this.roomId = opts.roomId;
    
    const signalingUrl = opts.signalingUrl;
    const iceServers = opts.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
    
    this.pc = new RTCPeerConnection({ iceServers });
    this.ws = new WebSocket(signalingUrl);
    
    // Create ready promise
    this.ready = new Promise(resolve => {
      this.readyResolve = resolve;
    });
    
    this.setupWebSocket(opts.roomId);
    this.setupPeerConnection();
  }
  
  private setupWebSocket(roomId: string): void {
    this.ws.onopen = () => {
      console.log("🔗 Connected to signaling server");
      // Try to join room first
      this.ws.send(JSON.stringify({
        type: "join-room",
        roomCode: roomId
      }));
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSignalingMessage(message, roomId);
    };
    
    this.ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
    };
    
    this.ws.onclose = () => {
      console.log("🔌 WebSocket connection closed");
    };
  }
  
  private async handleSignalingMessage(message: any, roomId: string): Promise<void> {
    switch (message.type) {
      case "room-not-found":
        console.log("🏠 Room not found, creating new room");
        this.isHost = true;
        this.ws.send(JSON.stringify({
          type: "create-room",
          roomCode: roomId
        }));
        break;
        
      case "room-created":
        this.isHost = true;
        this.localId = "host-01";
        console.log(`🎉 Room created successfully by ${this.localId}`);
        this.setupHostChannels();
        break;
        
      case "room-joined":
        console.log("🚪 Joined existing room");
        break;
        
      case "room-full":
        this.ws.close();
        throw new Error("Room is full. Please try again later or use a different room.");
        
      case "peer-joined":
        console.log("👋 Peer joined, creating offer");
        if (this.isHost) {
          await this.createOffer(roomId);
        }
        break;
        
      case "offer":
        this.localId = "client-01";
        console.log(`📨 Received offer for ${this.localId}`);
        await this.handleOffer(message.sdp, roomId);
        break;
        
      case "answer":
        console.log("📬 Received answer");
        await this.handleAnswer(message.sdp);
        break;
        
      case "ice-candidate":
        console.log("🧊 Received ICE candidate");
        if (message.candidate) {
          await this.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
        break;
        
      case "error":
        console.error("❌ Server error:", message.error);
        this.ws.close();
        throw new Error(`Server error: ${message.error}`);
        
      default:
        console.warn("🤷 Unknown message type:", message.type);
    }
  }
  
  private setupPeerConnection(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({
          type: "ice-candidate",
          roomCode: this.getRoomFromWs(),
          candidate: event.candidate
        }));
      }
    };
    
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      
      if (channel.label === "reliable") {
        this.reliableChannel = channel;
        this.setupChannelHandlers(channel);
      } else if (channel.label === "unreliable") {
        this.unreliableChannel = channel;
        this.setupChannelHandlers(channel);
      }
    };
  }
  
  private setupHostChannels(): void {
    // Create reliable channel
    this.reliableChannel = this.pc.createDataChannel("reliable", {
      ordered: true
    });
    this.setupChannelHandlers(this.reliableChannel);
    
    // Create unreliable channel
    this.unreliableChannel = this.pc.createDataChannel("unreliable", {
      ordered: false,
      maxRetransmits: 0
    });
    this.setupChannelHandlers(this.unreliableChannel);
  }
  
  private setupChannelHandlers(channel: RTCDataChannel): void {
    channel.onopen = () => {
      if (channel.label === "reliable" && !this.connected) {
        this.connected = true;
        this.readyResolve?.();
      }
    };
    
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const cb of this.listeners) {
          cb(this.isHost ? "client" : "host", data);
        }
      } catch (error) {
        console.error("❌ Failed to parse message:", error);
      }
    };
    
    channel.onerror = (error) => {
      console.error(`❌ Data channel '${channel.label}' error:`, error);
    };
    
    channel.onclose = () => {
      console.log(`📴 Data channel '${channel.label}' closed`);
    };
  }
  
  private async createOffer(roomId: string): Promise<void> {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      
      this.ws.send(JSON.stringify({
        type: "offer",
        roomCode: roomId,
        sdp: offer
      }));
    } catch (error) {
      console.error("❌ Failed to create offer:", error);
    }
  }
  
  private async handleOffer(sdp: RTCSessionDescriptionInit, roomId: string): Promise<void> {
    try {
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      
      this.ws.send(JSON.stringify({
        type: "answer",
        roomCode: roomId,
        sdp: answer
      }));
    } catch (error) {
      console.error("❌ Failed to handle offer:", error);
    }
  }
  
  private async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      await this.pc.setRemoteDescription(sdp);
    } catch (error) {
      console.error("❌ Failed to handle answer:", error);
    }
  }
  
  private getRoomFromWs(): string {
    return this.roomId;
  }
  
  send(_to: PeerId, data: unknown, reliable = true): void {
    const channel = reliable ? this.reliableChannel : (this.unreliableChannel || this.reliableChannel);
    
    if (channel && channel.readyState === "open") {
      try {
        channel.send(JSON.stringify(data));
      } catch (error) {
        console.error("❌ Failed to send message:", error);
      }
    } else {
      console.warn("⚠️ Cannot send message: channel not ready");
    }
  }
  
  onMessage(cb: (from: PeerId, data: unknown) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  
  peers(): ReadonlyArray<PeerId> {
    if (!this.connected) return [];
    return [this.isHost ? "client" : "host"];
  }
}

/**
 * Helper to create a WebRTC transport with Quick Join flow
 */
export async function createQuickJoinWebRTC(roomId = "CELL01"): Promise<NetworkTransport> {
  // Auto-detect signaling URL: use local if on localhost, otherwise production
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const signalingUrl = isLocalhost 
    ? "ws://127.0.0.1:8787/ws"
    // ? "ws://localhost:8080" 
    : "wss://cellproto-signaling.baconcheese113.workers.dev/ws";

  console.log(`🌐 Using signaling server: ${signalingUrl}`);
    
  const transport = new WebRTCTransport({ 
    roomId, 
    signalingUrl
  });
  await transport.ready; // Ensure data channel is open
  return transport;
}
