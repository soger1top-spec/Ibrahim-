import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// -------------------------------------------------------------
// REAL-TIME TV GAME WEBSOCKET SERVER & ROOM REGISTRY
// -------------------------------------------------------------
interface TvRoom {
  code: string;
  tvWs: WebSocket | null;
  tvName: string;
  controllerWs: WebSocket | null;
  controllerName: string | null;
  createdAt: number;
  lastActive: number;
}

const rooms = new Map<string, TvRoom>();

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// REST API for checking active TV games or pairing
app.get('/api/tv/rooms', (_req, res) => {
  const activeRooms = Array.from(rooms.values())
    .filter(r => r.tvWs && r.tvWs.readyState === WebSocket.OPEN)
    .map(r => ({
      code: r.code,
      tvName: r.tvName,
      isOccupied: !!r.controllerWs && r.controllerWs.readyState === WebSocket.OPEN,
      createdAt: r.createdAt
    }));
  res.json({ rooms: activeRooms });
});

// WebSocket Server attached to same HTTP Server on /api/tv-ws
const wss = new WebSocketServer({ server, path: '/api/tv-ws' });

wss.on('connection', (ws: WebSocket, req) => {
  let userRole: 'tv_host' | 'controller' | null = null;
  let userRoomCode: string | null = null;

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());

      // 1. TV HOST REGISTERS A ROOM ("لعبة التلفزيون")
      if (data.type === 'register_tv_host') {
        userRole = 'tv_host';
        const code = data.code || generatePin();
        userRoomCode = code;

        const room: TvRoom = {
          code,
          tvWs: ws,
          tvName: data.tvName || 'شاشة التلفاز الرئيسية',
          controllerWs: null,
          controllerName: null,
          createdAt: Date.now(),
          lastActive: Date.now()
        };
        rooms.set(code, room);

        ws.send(JSON.stringify({
          type: 'tv_registered',
          code,
          tvName: room.tvName,
          status: 'searching'
        }));
      }

      // 2. PHONE CONTROLLER CONNECTS TO TV ("اتصال التلفاز / بحث عن طالب اتصال")
      else if (data.type === 'connect_controller') {
        userRole = 'controller';
        let targetCode = data.code;

        // Auto-find latest active waiting TV room if no specific code provided
        if (!targetCode) {
          const waitingRooms = Array.from(rooms.values()).filter(
            r => r.tvWs && r.tvWs.readyState === WebSocket.OPEN && (!r.controllerWs || r.controllerWs.readyState !== WebSocket.OPEN)
          );
          if (waitingRooms.length > 0) {
            targetCode = waitingRooms[waitingRooms.length - 1].code;
          }
        }

        const room = targetCode ? rooms.get(targetCode) : null;

        if (room && room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
          userRoomCode = targetCode;
          room.controllerWs = ws;
          room.controllerName = data.controllerName || 'يد تحكم الجوال الذكية';
          room.lastActive = Date.now();

          // Notify Phone Controller: Connected!
          ws.send(JSON.stringify({
            type: 'controller_connected',
            code: targetCode,
            tvName: room.tvName,
            status: 'connected'
          }));

          // Notify TV Screen: Controller Connected! Start Game!
          room.tvWs.send(JSON.stringify({
            type: 'controller_joined',
            controllerName: room.controllerName,
            status: 'connected'
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'لم يتم العثور على شاشة تلفاز نشطة في وضع البحث. يرجى فتح (لعبة التلفزيون) أولاً.'
          }));
        }
      }

      // 3. PHONE CONTROLLER TRANSMITS LIVE INPUT COMMANDS TO TV GAME
      else if (data.type === 'controller_input') {
        if (userRoomCode) {
          const room = rooms.get(userRoomCode);
          if (room && room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
            room.lastActive = Date.now();
            room.tvWs.send(JSON.stringify({
              type: 'controller_command',
              command: data.command
            }));
          }
        }
      }

      // 4. PING / HEARTBEAT
      else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (userRoomCode) {
      const room = rooms.get(userRoomCode);
      if (room) {
        if (userRole === 'tv_host') {
          if (room.controllerWs && room.controllerWs.readyState === WebSocket.OPEN) {
            room.controllerWs.send(JSON.stringify({
              type: 'tv_disconnected',
              message: 'تم إغلاق شاشة التلفاز'
            }));
          }
          rooms.delete(userRoomCode);
        } else if (userRole === 'controller') {
          room.controllerWs = null;
          room.controllerName = null;
          if (room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
            room.tvWs.send(JSON.stringify({
              type: 'controller_left',
              status: 'searching'
            }));
          }
        }
      }
    }
  });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE (DEV) & STATIC FILE SERVING (PROD)
// -------------------------------------------------------------
async function setupServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunset Highway Real-Time Full-Stack Server running on port ${PORT}`);
  });
}

setupServer();
