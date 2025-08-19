// Base "component" with React-like stateChannel<T>() + automatic, batched replication.

import { Multicast } from './decorators';
import type { NetBus } from './net-bus';

type JSONObject = Record<string, unknown>;

export interface NetComponentOptions {
  /** Optional stable address used to route messages to the matching instance on peers. */
  address?: string;
}

/** Utility for unique default addresses if you don't pass one. */
let __autoAddrCounter = 0;
function autoAddress(ctorName: string) {
  __autoAddrCounter += 1;
  return `${ctorName}#${__autoAddrCounter}`;
}

/** Internal envelope for batched partial state updates. */
export interface StatePatch {
  __chan: string;   // state channel name (e.g., 'emotes', 'construction.blueprints')
  __rev: number;    // per-channel monotonic revision (ordering / idempotency)
  data: JSONObject; // partial object merge
}

/**
 * Base class for all networked components.
 * - Provides: isHost, netAddress, stateChannel<T>(), batch(fn), flushState()
 * - Implements: generic state replication via two multicast methods (_send/_apply)
 */
export abstract class NetComponent {
  /** Bus for RPC/multicast. Undefined in SP/offline. */
  protected _netBus?: NetBus;

  /** Is this instance running on the authoritative host/server? */
  protected _isHost = false;

  /** Stable address used to route messages to this *specific* instance on all peers. */
  readonly netAddress: string;

  constructor(netBus?: NetBus, opts?: NetComponentOptions) {
    this._netBus = netBus;
    this._isHost = !!netBus?.isHost;
    this.netAddress = opts?.address ?? autoAddress(this.constructor.name);

    // Let the bus register any decorated methods on this instance.
    this._netBus?.registerInstance(this);
  }

  // ---------------------------
  // React-like replicated state
  // ---------------------------

  /** Per-instance map: channel -> live state object */
  private __stateObjs = new Map<string, JSONObject>();

  /** Host-only: channel -> partial patch accumulated this tick */
  private __pending = new Map<string, JSONObject>();

  /** Host-only: channel -> last sent revision */
  private __revSend = new Map<string, number>();

  /** Receiver-side: channel -> last applied revision */
  private __revRecv = new Map<string, number>();

  /** Batch nesting (explicit .batch()) */
  private __batchDepth = 0;

  /** Whether a microtask flush is already scheduled. */
  private __flushScheduled = false;

  /**
   * Create (or get) a replicated "state object" for a named channel.
   * - Host: returns a Proxy that records property writes and auto-batches them.
   * - Clients: returns a sealed object updated by inbound patches.
   */
  protected stateChannel<T extends JSONObject>(channel: string, initial: T): T {
    if (this.__stateObjs.has(channel)) return this.__stateObjs.get(channel) as T;

    const base = { ...initial } as T;
    this.__stateObjs.set(channel, base);

    if (!this._isHost) {
      // Clients never emit; they only receive and mutate the sealed object via _applyStatePatch
      return Object.seal(base);
    }

    // Host: proxy writes (mutate then record deltas)
    const self = this;
    const proxy = new Proxy(base, {
      set(target, prop: string | symbol, value: unknown) {
        // 1) mutate authoritative local object
        (target as any)[prop] = value;

        // 2) accumulate partials
        const current = self.__pending.get(channel) ?? {};
        (current as any)[prop] = value;
        self.__pending.set(channel, current);

        // 3) schedule or defer flush
        if (self.__batchDepth === 0 && !self.__flushScheduled) {
          self.__flushScheduled = true;
          queueMicrotask(() => self.flushState());
        }
        return true;
      },
    });

    this.__stateObjs.set(channel, proxy);
    return proxy;
  }

  /**
   * Explicitly batch multiple state writes into a single patch per channel.
   * Useful across complex call stacks or when `await` is involved.
   */
  protected batch<T>(fn: () => T): T {
    this.__batchDepth++;
    try {
      return fn();
    } finally {
      this.__batchDepth--;
      if (this.__batchDepth === 0) this.flushState();
    }
  }

  /**
   * Flush all pending state channels into outbound patches (host only).
   * You may call this once per frame from your NetSyncSystem instead of relying on microtasks.
   */
  protected flushState(): void {
    this.__flushScheduled = false;
    if (!this._isHost || this.__pending.size === 0) return;

    for (const [chan, partial] of this.__pending) {
      const nextRev = (this.__revSend.get(chan) ?? 0) + 1;
      this.__revSend.set(chan, nextRev);
      const patch: StatePatch = { __chan: chan, __rev: nextRev, data: partial };
      this._sendStatePatch(patch); // multicast to all peers (including self)
    }
    this.__pending.clear();
  }

  /**
   * Generic sender for state patches. Marked @Multicast to transport to all peers,
   * and called by flushState(). Do not call directly from gameplay; just write to your state object.
   */
  @Multicast()
  protected _sendStatePatch(_patch: StatePatch): void {
    // The decorator handles network dispatch; local host will receive via _applyStatePatch below.
  }

  /**
   * Generic receiver for state patches; applies if newer per-channel revision.
   * This method is invoked on *all* peers (including sender) by @Multicast delivery.
   */
  @Multicast()
  protected _applyStatePatch(patch: StatePatch): void {
    const last = this.__revRecv.get(patch.__chan) ?? 0;
    if (patch.__rev <= last) return; // idempotent / ordering guard
    this.__revRecv.set(patch.__chan, patch.__rev);

    const obj = this.__stateObjs.get(patch.__chan);
    if (obj) Object.assign(obj, patch.data);
  }
}
