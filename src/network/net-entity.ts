// Base "component" with React-like stateChannel<T>() + automatic, batched replication.

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

// Add global counter for debugging state channel updates
const STATE_SYNC_COUNTERS = new Map<string, number>();
const LOG_INTERVAL = 1000;

// Add global function to check state sync stats
(globalThis as any).getStateSyncStats = () => {
  const stats = Array.from(STATE_SYNC_COUNTERS.entries())
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);
  
  console.log('📊 Top state sync channels:');
  stats.forEach(([channel, count]) => {
    console.log(`  ${channel}: ${count} syncs`);
  });
  
  return stats;
};

/**
 * Base class for all networked components.
 * - Provides: isHost, netAddress, stateChannel<T>(), batch(fn), flushState()
 * - Implements: generic state replication via two multicast methods (_send/_apply)
 */
export abstract class NetComponent {
  /** Bus for RPC/multicast. Always defined, even in of SP/offline. */
  protected _netBus: NetBus;

  /** Is this instance running on the authoritative host/server? */
  protected _isHost = false;

  /** Stable address used to route messages to this *specific* instance on all peers. */
  readonly netAddress: string;

  constructor(netBus: NetBus, opts?: NetComponentOptions) {
    this._netBus = netBus;
    this._isHost = !!netBus.isHost;
    this.netAddress = opts?.address ?? autoAddress(this.constructor.name);

    // Let the bus register any decorated methods on this instance.
    this._netBus.registerInstance(this);
    
    // Manually register the patch receiver method (not decorated but needs routing)
    const patchTargetKey = `${this.netAddress}._applyStatePatch`;
    this._netBus.registerHandler(patchTargetKey, (args: unknown[]) => {
      const patch = args[0] as StatePatch;
      this._applyStatePatch(patch);
    });
  }

  // ---------------------------
  // React-like replicated state
  // ---------------------------

  /** Per-instance map: channel -> live state object */
  private __stateObjs = new Map<string, JSONObject>();

  /** Host-only: channel -> last sent revision */
  private __revSend = new Map<string, number>();

  /** Receiver-side: channel -> last applied revision */
  private __revRecv = new Map<string, number>();

  /** Host-only: channel -> last synced state snapshot for change detection */
  private __lastSynced = new Map<string, string>();

  /**
   * Create (or get) a replicated "state object" for a named channel.
   * - Host: returns a reactive proxy that auto-syncs on mutations
   * - Clients: returns a sealed object updated by full state sync
   */
  protected stateChannel<T extends JSONObject>(channel: string, initial: T): T {
    if (this.__stateObjs.has(channel)) return this.__stateObjs.get(channel) as T;
    
    const base = { ...initial } as T;
    this.__stateObjs.set(channel, base);
    
    if (!this._isHost) {
      // Clients receive full state updates via syncState()
      return Object.seal(base);
    }
    
    // Host: return reactive proxy that auto-syncs on mutations
    return this.createReactiveProxy(base, channel);
  }

  /**
   * Create a reactive proxy that automatically syncs state on mutations
   */
  private createReactiveProxy<T extends JSONObject>(target: T, channel: string): T {
    return new Proxy(target, {
      get: (obj, prop) => {
        const value = Reflect.get(obj, prop);
        
        // If the value is an object (but not null, array, Map, or Set), make it reactive too
        if (value && typeof value === 'object' && 
            !Array.isArray(value) && 
            !(value instanceof Map) && 
            !(value instanceof Set) && 
            value.constructor === Object) {
          return this.createReactiveProxy(value as JSONObject, channel);
        }
        
        return value;
      },
      
      set: (obj, prop, value) => {
        // Only trigger sync if the value actually changed
        const currentValue = Reflect.get(obj, prop);
        if (currentValue === value) {
          return true; // Value unchanged, don't trigger sync
        }
        
        // Apply the change
        const result = Reflect.set(obj, prop, value);
        
        // Auto-sync on next microtask (debounces multiple changes in same frame)
        queueMicrotask(() => {
          this.syncState(channel);
        });
        
        return result;
      },
      
      deleteProperty: (obj, prop) => {
        // Apply the deletion
        const result = Reflect.deleteProperty(obj, prop);
        
        // Auto-sync on next microtask
        queueMicrotask(() => {
          this.syncState(channel);
        });
        
        return result;
      }
    });
  }

  /**
   * Host: Send the complete state of a channel to all clients.
   * Only syncs if the state has actually changed since last sync.
   */
  protected syncState(channel: string): void {
    if (!this._isHost) return;
    
    const stateObj = this.__stateObjs.get(channel);
    if (!stateObj) return;
    
    // Check if state has changed since last sync
    const currentState = JSON.stringify(stateObj);
    const lastSynced = this.__lastSynced.get(channel);
    
    if (currentState === lastSynced) {
      // No changes detected, skip sync
      return;
    }
    
    // Track sync frequency for debugging
    const channelKey = `${this.netAddress}.${channel}`;
    const currentCount = STATE_SYNC_COUNTERS.get(channelKey) || 0;
    STATE_SYNC_COUNTERS.set(channelKey, currentCount + 1);
    
    if (currentCount % LOG_INTERVAL === 0) {
      console.log(`📊 State sync #${currentCount + 1} for ${channelKey}`);
    }
    
    // State has changed, proceed with sync
    const nextRev = (this.__revSend.get(channel) ?? 0) + 1;
    this.__revSend.set(channel, nextRev);
    this.__lastSynced.set(channel, currentState);
    
    // Send complete state to all clients
    this._netBus.sendPatch(this.netAddress, channel, nextRev, stateObj);
  }

  /**
   * Receiver for state patches; applies if newer per-channel revision.
   * This method is invoked by NetBus when patches arrive.
   */
  _applyStatePatch(patch: StatePatch): void {
    const last = this.__revRecv.get(patch.__chan) ?? 0;
    if (patch.__rev <= last) return; // idempotent / ordering guard
    this.__revRecv.set(patch.__chan, patch.__rev);

    const obj = this.__stateObjs.get(patch.__chan);
    if (obj) {
      Object.assign(obj, patch.data);
      // Call optional hook after applying the patch
      this.onStatePatched(patch.__chan);
    }
  }

  /**
   * Optional hook called after a state patch is applied to a channel.
   * Override in subclasses to react to state changes.
   */
  protected onStatePatched(_chan: string): void {
    // Optional override in subclasses
  }
}
