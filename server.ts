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

// Enable CORS for native mobile/TV APK clients
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// -------------------------------------------------------------
// REAL-TIME TV GAME WEBSOCKET SERVER & ROOM REGISTRY
// -------------------------------------------------------------
interface TvRoom {
  code: string;
  tvWs: WebSocket | null;
  tvName: string;
  controllers: Set<WebSocket>;
  createdAt: number;
}

const rooms = new Map<string, TvRoom>();

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function sendJson(ws: WebSocket | null, type: string, payload: Record<string, any> = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type, ...payload }));
    } catch (e) {
      console.error('Failed to send WS message:', e);
    }
  }
}

// REST API for checking active TV games or pairing
app.get('/api/tv/rooms', (_req, res) => {
  const result: Array<{ code: string; tvName: string }> = [];
  for (const [code, room] of rooms.entries()) {
    if (room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
      result.push({
        code,
        tvName: room.tvName
      });
    }
  }
  res.json({ rooms: result });
});

// WebSocket Server attached to same HTTP Server on /api/tv-ws
const wss = new WebSocketServer({ server, path: '/api/tv-ws' });

function disconnectController(ws: any) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  room.controllers.delete(ws);
  if (room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
    sendJson(room.tvWs, 'controller_left', {
      controllerName: ws.controllerName || 'يد تحكم'
    });
  }
  ws.roomCode = null;
}

function closeTvRoom(ws: any) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  for (const ctrl of room.controllers) {
    sendJson(ctrl, 'tv_disconnected', {
      message: 'تم إغلاق شاشة التلفاز'
    });
    (ctrl as any).roomCode = null;
  }
  rooms.delete(code);
  ws.roomCode = null;
}

wss.on('connection', (ws: WebSocket & { role?: string; roomCode?: string | null; controllerName?: string | null }) => {
  ws.role = undefined;
  ws.roomCode = null;
  ws.controllerName = null;

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());

      // 1. TV HOST REGISTERS A ROOM ("لعبة التلفزيون")
      if (data.type === 'register_tv_host') {
        const code = String(data.code || generatePin());
        const tvName = data.tvName || 'شاشة التلفاز';

        const room: TvRoom = {
          code,
          tvWs: ws,
          tvName,
          controllers: new Set<WebSocket>(),
          createdAt: Date.now()
        };
        rooms.set(code, room);

        ws.role = 'tv';
        ws.roomCode = code;

        sendJson(ws, 'tv_registered', {
          code,
          tvName
        });
      }

      // 2. PHONE CONTROLLER CONNECTS TO TV ("يد التلفاز")
      else if (data.type === 'connect_controller') {
        let targetCode = data.code ? String(data.code) : '';

        // Auto-find latest active waiting TV room if no specific code provided
        if (!targetCode) {
          const activeCodes = Array.from(rooms.keys());
          if (activeCodes.length > 0) {
            targetCode = activeCodes[activeCodes.length - 1];
          }
        }

        const room = targetCode ? rooms.get(targetCode) : null;

        if (room && room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
          ws.role = 'controller';
          ws.roomCode = targetCode;
          ws.controllerName = data.controllerName || 'يد تحكم الجوال';
          room.controllers.add(ws);

          // Notify Phone Controller: Connected!
          sendJson(ws, 'controller_connected', {
            code: targetCode,
            tvName: room.tvName
          });

          // Notify TV Screen: Controller Joined! Start/Unpause Game!
          sendJson(room.tvWs, 'controller_joined', {
            controllerName: ws.controllerName
          });
        } else {
          sendJson(ws, 'error', {
            message: 'لم يتم العثور على شاشة تلفاز نشطة. تأكد من فتح "لعبة التلفزيون" أولاً.'
          });
        }
      }

      // 3. PHONE CONTROLLER TRANSMITS LIVE INPUT COMMANDS TO TV GAME
      else if (data.type === 'controller_input') {
        if (ws.role === 'controller' && ws.roomCode) {
          const room = rooms.get(ws.roomCode);
          if (room && room.tvWs && room.tvWs.readyState === WebSocket.OPEN) {
            sendJson(room.tvWs, 'controller_command', {
              command: data.command
            });
          }
        }
      }

      // 4. DISCONNECT EXPLICIT ACTIONS
      else if (data.type === 'controller_disconnected') {
        disconnectController(ws);
      } else if (data.type === 'tv_closed') {
        closeTvRoom(ws);
      }

      // 5. PING / HEARTBEAT
      else if (data.type === 'ping') {
        sendJson(ws, 'pong');
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (ws.role === 'tv') {
      closeTvRoom(ws);
    } else if (ws.role === 'controller') {
      disconnectController(ws);
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
