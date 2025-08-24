// Small, strictly-typed message bus that wires decorated methods to the transport.

import type { NetworkTransport, PeerId } from './transport';
import { collectMethodMeta } from './decorators';

/** (address + method) -> bound original function */
type Handler = (args: unknown[]) => void;

export class NetBus {
  private readonly transport: NetworkTransport;

  /** Is this peer the authoritative host? */
  get isHost(): boolean { return this.transport.isHost; }

  /** Local peer id (debugging/targeting) */
  get localId(): PeerId { return this.transport.localId; }

  // Active inbound handlers for (address.method)
  private handlers = new Map<string, Handler>();

  constructor(transport: NetworkTransport) {
    this.transport = transport;
    this.transport.onMessage((from, data) => this.handleEnvelope(from, data));
  }

  /** Register all decorated methods on the instance: both RPC and multicast receivers. */
  registerInstance(instance: any, key?: string): void {
    // Assign deterministic __netKey
    instance.__netKey = key || instance.constructor.name;
    
    const metas = collectMethodMeta(instance);
    for (const m of metas) {
      const targetKey = this.makeTargetKey(instance.__netKey, m.name);
      // Bind the *original* (undecorated) function so we don't resend on inbound.
      const bound: Handler = (args: unknown[]) => (m.original as Function).apply(instance, args);
      this.handlers.set(targetKey, bound);
    }
  }

  /** Register a handler manually (for non-decorated methods like _applyStatePatch) */
  registerHandler(targetKey: string, handler: Handler): void {
    this.handlers.set(targetKey, handler);
  }

  /** Send state patch to all peers */
  sendPatch(key: string, chan: string, rev: number, data: unknown): void {
    const patchMsg = { t: 'patch', key, chan, rev, data };
    for (const pid of this.transport.peers()) {
      if (pid === this.transport.localId) continue;
      this.transport.send(pid, patchMsg, true);
    }
  }

  /** Multicast a method invocation to all peers (for @Multicast decorator) */
  sendMulticast(address: string, method: string, args: unknown[]): void {
    const msg = { t: 'multicast', key: address, method, args };
    
    // Send to all other peers
    for (const pid of this.transport.peers()) {
      if (pid === this.transport.localId) continue;
      this.transport.send(pid, msg, true);
    }
    
    // Apply locally (self-loopback)
    const targetKey = this.makeTargetKey(address, method);
    const handler = this.handlers.get(targetKey);
    if (handler) handler(args);
  }

  /** Send an RPC to the host to invoke the target method on its instance. */
  sendRpcToHost(address: string, method: string, args: unknown[]): void {
    if (this.isHost) {
      this.invokeLocal(address, method, args);
      return;
    }
    const rpcMsg = { t: 'rpc', key: address, method, args };
    this.transport.send(this.transport.hostId, rpcMsg, true);
  }

  // ----------------
  // Internal helpers
  // ----------------

  private handleEnvelope(_from: PeerId, data: unknown): void {
    // Handle RPC and patch message format
    if (typeof data === 'object' && data && 't' in data) {
      const msg = data as any;
      
      if (msg.t === 'rpc') {
        // Only host should execute RPC
        if (!this.isHost) return;
        
        const targetKey = this.makeTargetKey(msg.key, msg.method);
        const handler = this.handlers.get(targetKey);
        if (handler) handler(msg.args);
        return;
      }
      
      if (msg.t === 'patch') {
        // Apply state patch to the matching component
        const targetKey = this.makeTargetKey(msg.key, '_applyStatePatch');
        const handler = this.handlers.get(targetKey);
        if (handler) {
          const patch = {
            __chan: msg.chan,
            __rev: msg.rev,
            data: msg.data
          };
          handler([patch]);
        }
        return;
      }
      
      if (msg.t === 'multicast') {
        const targetKey = this.makeTargetKey(msg.key, msg.method);
        const handler = this.handlers.get(targetKey);
        if (handler) handler(msg.args);
        return;
      }
    }
  }

  private invokeLocal(address: string, method: string, args: unknown[]): void {
    this.invokeLocalByTarget(this.makeTargetKey(address, method), args);
  }

  private invokeLocalByTarget(target: string, args: unknown[]): void {
    const handler = this.handlers.get(target);
    if (handler) handler(args);
  }

  private makeTargetKey(address: string, method: string): string {
    return `${address}.${method}`;
  }
}
