
export interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      // Single durable object instance keyed by a constant name
      const id = env.ROOM.idFromName("cellproto-default-room");
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    // Optional health endpoint
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return new Response("Use /ws for WebSocket", { status: 404 });
  },
};

export class RoomDO {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private readonly clients = new Set<WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    // Clean up any stale connections on startup
    this.clients.clear();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    // Enforce 2-peers max for the single room
    if (this.clients.size >= 2) {
      server.send(JSON.stringify({ type: "room-full" }));
      server.close(1013, "Room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.clients.add(server);

    server.addEventListener("message", (evt) => this.onMessage(server, evt));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, evt: MessageEvent) {
    let msg: any;
    try {
      msg = JSON.parse(typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer));
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
      return;
    }

    const { type } = msg as { type: string };

    switch (type) {
      case "create-room": {
        // For single room model: if there are already clients, room exists
        if (this.clients.size > 1) {
          ws.send(JSON.stringify({ type: "error", error: "Room already exists" }));
        } else {
          ws.send(JSON.stringify({ type: "room-created", roomCode: "default" }));
        }
        break;
      }
      case "join-room": {
        // Check if room is full (more than 2 clients)
        if (this.clients.size > 2) {
          ws.send(JSON.stringify({ type: "room-full" }));
        } else {
          // First client becomes host, second becomes client
          if (this.clients.size === 1) {
            // This is the first (and only) client - they become the host
            ws.send(JSON.stringify({ type: "room-created", roomCode: "default" }));
          } else {
            // This is the second client - notify the host that a peer joined
            this.broadcast({ type: "peer-joined" }, ws);
            ws.send(JSON.stringify({ type: "room-joined", roomCode: "default" }));
          }
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice-candidate": {
        // Forward signaling messages to other peers
        this.broadcast(msg, ws);
        break;
      }
      default: {
        ws.send(JSON.stringify({ type: "error", error: "Unknown message type" }));
      }
    }
  }

  private onClose(ws: WebSocket) {
    if (this.clients.delete(ws)) {
      this.broadcast({ type: "peer-left" }, ws);
    }
  }

  private broadcast(message: unknown, exclude?: WebSocket) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== exclude && client.readyState === 1) {
        try { client.send(data); } catch {}
      }
    }
  }
}