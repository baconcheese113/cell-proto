// Small, strictly-typed message bus that wires decorated methods to the transport.

import type { NetworkTransport, PeerId } from './transport';
import { collectMethodMeta } from './decorators';

type EnvelopeKind = 'rpc' | 'cast';

interface Envelope {
  kind: EnvelopeKind;
  /** Addressed instance + method, e.g. "EmoteSystem#3._applyStatePatch" */
  target: string;
  /** For RPC, the destination peer id (host). For cast, unused. */
  to?: PeerId;
  /** Sender id (for debugging or filtering) */
  from: PeerId;
  /** Method arguments (positional) */
  args: unknown[];
}

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
  registerInstance(instance: any): void {
    const metas = collectMethodMeta(instance);
    for (const m of metas) {
      const key = this.makeTargetKey(instance.netAddress, m.name);
      // Bind the *original* (undecorated) function so we don't resend on inbound.
      const bound: Handler = (args: unknown[]) => (m.original as Function).apply(instance, args);
      this.handlers.set(key, bound);
    }
  }

  /** Send an RPC to the host to invoke the target method on its instance. */
  sendRpcToHost(address: string, method: string, args: unknown[]): void {
    if (this.isHost) {
      this.invokeLocal(address, method, args);
      return;
    }
    const env: Envelope = {
      kind: 'rpc',
      target: this.makeTargetKey(address, method),
      to: this.transport.hostId,
      from: this.transport.localId,
      args,
    };
    this.transport.send(this.transport.hostId, env, true);
  }

  /** Multicast a method invocation to all peers (loopback included). */
  sendCast(address: string, method: string, args: unknown[]): void {
    const env: Envelope = {
      kind: 'cast',
      target: this.makeTargetKey(address, method),
      from: this.transport.localId,
      args,
    };
    // Loopback: deliver to self immediately (mirrors native transports that echo).
    this.handleEnvelope(this.transport.localId, env);
    // Broadcast to others
    for (const pid of this.transport.peers()) {
      if (pid === this.transport.localId) continue;
      this.transport.send(pid, env, true);
    }
  }

  // ----------------
  // Internal helpers
  // ----------------

  private handleEnvelope(_from: PeerId, data: unknown): void {
    const env = data as Envelope;
    if (!env || typeof env !== 'object') return;

    if (env.kind === 'rpc') {
      // Only host should execute RPC envelopes
      if (!this.isHost) return;
      if (env.to && env.to !== this.transport.localId) return;
      this.invokeLocalByTarget(env.target, env.args);
    } else if (env.kind === 'cast') {
      // All peers invoke
      this.invokeLocalByTarget(env.target, env.args);
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
