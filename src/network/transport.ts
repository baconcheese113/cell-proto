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
