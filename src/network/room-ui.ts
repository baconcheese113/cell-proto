// room-ui.ts
// Minimal, self-contained lobby UI for hosting/joining a room with the new NetBus API.
// - Works out of the box with LoopbackTransport (local testing).
// - Can be wired to your WebRTC transport via a factory that returns NetworkTransport.
//
// Usage:
//   const ui = new RoomUI({
//     mount: '#net-room',
//     defaultRoom: 'dev',
//     createTransport: ({ role, roomId }) => new RtcAdapter(makeYourWebRtc(roomId, role))  // optional
//     onConnected: ({ bus, transport, isHost, roomId }) => { /* register your components */ },
//   });
//
// Notes:
// - This file owns only the lobby UX. Game logic should live elsewhere.
// - NetBus expects a NetworkTransport-like object with: isHost, hostId, localId, peers(), send(), onMessage().

import { NetBus } from './net-bus';
import type { NetworkTransport } from './transport';
import { LoopbackTransport } from './transport';

type Role = 'host' | 'client';

export interface RoomUIOptions {
  /** Element or selector to mount UI into. */
  mount: HTMLElement | string;
  /** Initial room id to prefill. */
  defaultRoom?: string;
  /**
   * Factory creating a transport for the selected role/room.
   * If omitted, a LoopbackTransport is used (great for local testing).
   */
  createTransport?: (opts: { role: Role; roomId: string }) => NetworkTransport;
  /** Called after a successful connection; register components here. */
  onConnected?: (ctx: {
    bus: NetBus;
    transport: NetworkTransport;
    isHost: boolean;
    role: Role;
    roomId: string;
  }) => void;
  /** Called after disconnect. */
  onDisconnected?: () => void;
  /** Optional: customize labels. */
  labels?: Partial<{
    title: string;
    roomPlaceholder: string;
    host: string;
    join: string;
    connect: string;
    disconnect: string;
    statusIdle: string;
    statusHosting: (roomId: string) => string;
    statusJoined: (roomId: string) => string;
    peers: string;
  }>;
}

export class RoomUI {
  // --- state ---
  private readonly root: HTMLElement;
  private readonly opts: RoomUIOptions;

  private transport?: NetworkTransport;
  private bus?: NetBus;
  private role: Role = 'client';
  private roomId = '';

  private isConnected = false;
  private peersTimer?: number;

  // --- DOM refs ---
  private elRoom!: HTMLInputElement;
  private elRoleHost!: HTMLInputElement;
  private elRoleClient!: HTMLInputElement;
  private elConnect!: HTMLButtonElement;
  private elDisconnect!: HTMLButtonElement;
  private elStatus!: HTMLDivElement;
  private elPeers!: HTMLUListElement;

  constructor(opts: RoomUIOptions) {
    this.opts = opts;
    this.root = resolveMount(opts.mount);
    this.build();
    this.bind();
    this.updateUi();
  }

  // ------------- public API -------------

  dispose() {
    this.clearPeersTimer();
    this.elConnect.removeEventListener('click', this.onConnect);
    this.elDisconnect.removeEventListener('click', this.onDisconnect);
    this.elRoleHost.removeEventListener('change', this.onRoleChange);
    this.elRoleClient.removeEventListener('change', this.onRoleChange);
    // Optional: clear contents
    // this.root.innerHTML = '';
  }

  // Expose current connection context if needed by caller
  getConnection() {
    return this.isConnected && this.transport && this.bus
      ? { transport: this.transport, bus: this.bus, isHost: this.transport.isHost, role: this.role as Role, roomId: this.roomId }
      : undefined;
  }

  // ------------- UI construction -------------

  private build() {
    const L = withDefaults(this.opts.labels, {
      title: 'Network Room',
      roomPlaceholder: 'room-id',
      host: 'Host',
      join: 'Join',
      connect: 'Connect',
      disconnect: 'Disconnect',
      statusIdle: 'Not connected',
      statusHosting: (id: string) => `Hosting room “${id}”`,
      statusJoined: (id: string) => `Joined room “${id}”`,
      peers: 'Peers',
    });

    this.root.classList.add('net-room');
    this.root.innerHTML = `
      <style>
        .net-room { font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e5e7eb; }
        .net-card { background: #111827; border: 1px solid #374151; border-radius: 10px; padding: 12px; max-width: 480px; }
        .net-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
        .net-row > label { opacity: .8; }
        .net-input { flex: 1; background: #0b1220; border: 1px solid #374151; color: #e5e7eb; border-radius: 8px; padding: 6px 8px; }
        .net-btn { background: #2563eb; border: 0; color: white; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
        .net-btn:disabled { opacity: .5; cursor: not-allowed; }
        .net-btn.outline { background: transparent; border: 1px solid #374151; }
        .net-status { margin: 8px 0; opacity: .9; }
        .net-peers { margin: 6px 0 0; padding-left: 18px; }
        .net-title { font-weight: 600; margin-bottom: 8px; }
        .net-sep { height: 1px; background: #1f2937; margin: 8px 0; }
      </style>
      <div class="net-card">
        <div class="net-title">${L.title}</div>
        <div class="net-row">
          <label>Room</label>
          <input class="net-input" id="net-room-id" placeholder="${L.roomPlaceholder}" />
        </div>
        <div class="net-row">
          <label>Role</label>
          <label><input type="radio" name="net-role" id="net-role-host" /> ${L.host}</label>
          <label><input type="radio" name="net-role" id="net-role-client" /> ${L.join}</label>
        </div>
        <div class="net-row">
          <button class="net-btn" id="net-connect">${L.connect}</button>
          <button class="net-btn outline" id="net-disconnect">${L.disconnect}</button>
        </div>
        <div class="net-sep"></div>
        <div class="net-status" id="net-status">${L.statusIdle}</div>
        <div><strong>${L.peers}</strong></div>
        <ul class="net-peers" id="net-peers"></ul>
      </div>
    `;

    this.elRoom = this.root.querySelector('#net-room-id') as HTMLInputElement;
    this.elRoleHost = this.root.querySelector('#net-role-host') as HTMLInputElement;
    this.elRoleClient = this.root.querySelector('#net-role-client') as HTMLInputElement;
    this.elConnect = this.root.querySelector('#net-connect') as HTMLButtonElement;
    this.elDisconnect = this.root.querySelector('#net-disconnect') as HTMLButtonElement;
    this.elStatus = this.root.querySelector('#net-status') as HTMLDivElement;
    this.elPeers = this.root.querySelector('#net-peers') as HTMLUListElement;

    // defaults
    this.elRoom.value = this.opts.defaultRoom ?? 'dev';
    this.elRoleHost.checked = true;
    this.elRoleClient.checked = false;
  }

  private bind() {
    this.onConnect = this.onConnect.bind(this);
    this.onDisconnect = this.onDisconnect.bind(this);
    this.onRoleChange = this.onRoleChange.bind(this);

    this.elConnect.addEventListener('click', this.onConnect);
    this.elDisconnect.addEventListener('click', this.onDisconnect);
    this.elRoleHost.addEventListener('change', this.onRoleChange);
    this.elRoleClient.addEventListener('change', this.onRoleChange);
  }

  // ------------- events -------------

  private async onConnect() {
    if (this.isConnected) return;

    const roomId = this.elRoom.value.trim();
    const role: Role = this.elRoleHost.checked ? 'host' : 'client';
    if (!roomId) {
      this.setStatus('Please enter a room id.');
      return;
    }

    try {
      // Pick transport: factory or loopback
      const transport =
        this.opts.createTransport?.({ role, roomId }) ??
        new LoopbackTransport({ roomId, isHost: role === 'host' });

      // Build bus on top of transport
      const bus = new NetBus(transport);

      this.transport = transport;
      this.bus = bus;
      this.isConnected = true;
      this.role = role;
      this.roomId = roomId;

      // Kick peers polling
      this.startPeersTimer();

      // Inform user code to register components now
      this.opts.onConnected?.({
        bus,
        transport,
        isHost: transport.isHost,
        role,
        roomId,
      });

      // UI
      const L = withDefaults(this.opts.labels, {});
      this.setStatus(
        role === 'host'
          ? (this.opts.labels?.statusHosting?.(roomId) ??
              `Hosting room “${roomId}”`)
          : (this.opts.labels?.statusJoined?.(roomId) ??
              `Joined room “${roomId}”`),
      );
      this.updateUi();
    } catch (err) {
      console.error('Failed to connect:', err);
      this.setStatus('Failed to connect (see console).');
      this.isConnected = false;
      this.updateUi();
    }
  }

  private onDisconnect() {
    if (!this.isConnected) return;

    try {
      this.clearPeersTimer();
      // Let caller tear down components; we only clear UI + transport listeners
      this.opts.onDisconnected?.();

      // Best-effort: some transports expose a close/disconnect API—call if present
      try {
        (this.transport as any)?.close?.();
        (this.transport as any)?.disconnect?.();
      } catch {
        /* ignore */
      }

      this.transport = undefined;
      this.bus = undefined;
      this.isConnected = false;
      this.setStatus(this.opts.labels?.statusIdle ?? 'Not connected');
      this.updateUi();
    } catch (err) {
      console.error('Failed to disconnect:', err);
      this.setStatus('Failed to disconnect (see console).');
    }
  }

  private onRoleChange() {
    this.role = this.elRoleHost.checked ? 'host' : 'client';
  }

  // ------------- helpers -------------

  private updateUi() {
    const connected = this.isConnected;
    this.elRoom.disabled = connected;
    this.elRoleHost.disabled = connected;
    this.elRoleClient.disabled = connected;
    this.elConnect.disabled = connected;
    this.elDisconnect.disabled = !connected;
  }

  private setStatus(text: string) {
    this.elStatus.textContent = text;
  }

  private startPeersTimer() {
    this.clearPeersTimer();
    this.refreshPeers();
    this.peersTimer = window.setInterval(() => this.refreshPeers(), 1000);
  }

  private clearPeersTimer() {
    if (this.peersTimer) {
      window.clearInterval(this.peersTimer);
      this.peersTimer = undefined;
    }
  }

  private refreshPeers() {
    const list = this.transport?.peers() ?? [];
    this.elPeers.innerHTML = '';
    for (const p of list) {
      const li = document.createElement('li');
      const isSelf = this.transport?.localId === p;
      const isHost = this.transport?.hostId === p;
      li.textContent = `${p}${isSelf ? ' (you)' : ''}${isHost ? ' [host]' : ''}`;
      this.elPeers.appendChild(li);
    }
  }
}

// ---------------- utils ----------------

function resolveMount(el: HTMLElement | string): HTMLElement {
  if (typeof el !== 'string') return el;
  const found = document.querySelector<HTMLElement>(el);
  if (!found) throw new Error(`RoomUI.mount: selector not found: ${el}`);
  return found;
}

function withDefaults<T extends Record<string, any>>(value: T | undefined, defaults: T): T {
  return Object.assign({}, defaults, value ?? {}) as T;
}
