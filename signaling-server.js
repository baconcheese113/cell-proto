/**
 * Simple WebSocket Signaling Server for Cell Proto Development
 * 
 * Run with: node signaling-server.js
 * This handles room creation, joining, and WebRTC signaling exchange
 */

import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ 
  port: 8080,
  perMessageDeflate: false
});

const rooms = new Map(); // roomCode -> Set of WebSocket connections

console.log('Cell Proto Signaling Server running on ws://localhost:8080');

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (error) {
      console.error('Failed to parse message:', error);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    // Remove from all rooms
    for (const [roomCode, clients] of rooms) {
      if (clients.has(ws)) {
        clients.delete(ws);
        if (clients.size === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (empty)`);
        } else {
          // Notify remaining clients
          broadcastToRoom(roomCode, { type: 'peer-left' }, ws);
        }
        break;
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function handleMessage(ws, message) {
  const { type, roomCode } = message;
  
  switch (type) {
    case 'create-room':
      if (rooms.has(roomCode)) {
        ws.send(JSON.stringify({ 
          type: 'error', 
          error: 'Room already exists'
        }));
        return;
      }
      
      rooms.set(roomCode, new Set([ws]));
      console.log(`Room ${roomCode} created`);
      
      ws.send(JSON.stringify({ 
        type: 'room-created', 
        roomCode 
      }));
      break;
      
    case 'join-room':
      if (!rooms.has(roomCode)) {
        ws.send(JSON.stringify({ 
          type: 'room-not-found' 
        }));
        return;
      }
      
      const room = rooms.get(roomCode);
      if (room.size >= 2) {
        ws.send(JSON.stringify({ 
          type: 'room-full' 
        }));
        return;
      }
      
      room.add(ws);
      console.log(`Client joined room ${roomCode} (${room.size}/2)`);
      
      // Notify existing clients
      broadcastToRoom(roomCode, { type: 'peer-joined' }, ws);
      
      ws.send(JSON.stringify({ 
        type: 'room-joined', 
        roomCode 
      }));
      break;
      
    case 'offer':
    case 'answer':
    case 'ice-candidate':
      // Forward signaling messages to other peers in the room
      if (rooms.has(roomCode)) {
        broadcastToRoom(roomCode, message, ws);
      }
      break;
      
    default:
      console.warn('Unknown message type:', type);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Unknown message type' 
      }));
  }
}

function broadcastToRoom(roomCode, message, excludeWs) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  for (const client of room) {
    if (client !== excludeWs && client.readyState === 1) { // WebSocket.OPEN = 1
      client.send(JSON.stringify(message));
    }
  }
}

process.on('SIGINT', () => {
  console.log('Shutting down signaling server...');
  wss.close(() => {
    process.exit(0);
  });
});
