import { controllerBus } from './controllerBus';
import { getTvWebSocketUrl, getTvRoomsApiUrl } from './serverConfig';

export type TvConnectionStatus = 'idle' | 'searching' | 'connecting' | 'connected' | 'disconnected';

export interface TvSessionState {
  isTvHost: boolean;
  tvStatus: TvConnectionStatus;
  isControllerConnected: boolean;
  tvName: string;
  controllerName: string | null;
  roomPin: string | null;
  lastConnectedAt: number | null;
  error: string | null;
  wsConnected: boolean;
}

type TvSessionListener = (state: TvSessionState) => void;

class TvGameSessionService {
  private state: TvSessionState = {
    isTvHost: false,
    tvStatus: 'idle',
    isControllerConnected: false,
    tvName: 'شاشة التلفاز الذكية (طريق الغروب)',
    controllerName: null,
    roomPin: null,
    lastConnectedAt: null,
    error: null,
    wsConnected: false
  };

  private listeners: Set<TvSessionListener> = new Set();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private storageKey = 'sunset_tv_game_sync_v3';
  private heartbeatInterval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      // Connect to real WebSocket Server
      this.initWebSocket();

      // Local browser fallback channels
      if ('BroadcastChannel' in window) {
        try {
          this.broadcastChannel = new BroadcastChannel('sunset_tv_game_sync_v3');
          this.broadcastChannel.onmessage = (event) => this.handleLocalMessage(event.data);
        } catch (e) {
          console.warn('BroadcastChannel error', e);
        }
      }

      window.addEventListener('storage', (e) => {
        if (e.key === this.storageKey && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            this.handleLocalMessage(data);
          } catch {}
        }
      });

      window.addEventListener('sunset_tv_internal_message', (e: any) => {
        if (e.detail) {
          this.handleLocalMessage(e.detail);
        }
      });
    }
  }

  // -------------------------------------------------------------
  // REAL WEBSOCKET CONNECTION
  // -------------------------------------------------------------
  private initWebSocket() {
    if (typeof window === 'undefined') return;

    const wsUrl = getTvWebSocketUrl();

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.updateState({ wsConnected: true, error: null });

        // If this client is TV host, re-register
        if (this.state.isTvHost && this.state.roomPin) {
          this.ws?.send(JSON.stringify({
            type: 'register_tv_host',
            code: this.state.roomPin,
            tvName: this.state.tvName
          }));
        }

        // Start ping interval
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.updateState({ wsConnected: false });
        // Attempt automatic reconnection
        if (!this.wsReconnectTimer) {
          this.wsReconnectTimer = setTimeout(() => {
            this.wsReconnectTimer = null;
            this.initWebSocket();
          }, 2000);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('TV Game WebSocket error, using multi-channel fallback', err);
      };
    } catch (e) {
      console.warn('Failed to establish WebSocket, using local bus fallback', e);
    }
  }

  subscribe(listener: TvSessionListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): TvSessionState {
    return { ...this.state };
  }

  private updateState(partial: Partial<TvSessionState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((cb) => {
      try {
        cb({ ...this.state });
      } catch (err) {
        console.error('Error in tv session listener', err);
      }
    });
  }

  private sendWsMessage(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        console.warn('WS send error', e);
      }
    }
    // Also post locally across tabs
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg);
      } catch {}
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify({ ...msg, _t: Date.now() + Math.random() }));
      } catch {}
    }
  }

  // -------------------------------------------------------------
  // TV GAME HOST METHODS (يتم تفعيلها عند فتح لعبة التلفزيون)
  // -------------------------------------------------------------
  startTvHost(customTvName = 'شاشة التلفاز الرئيسية') {
    const pin = this.state.roomPin || Math.floor(1000 + Math.random() * 9000).toString();

    this.updateState({
      isTvHost: true,
      tvStatus: 'searching',
      isControllerConnected: false,
      tvName: customTvName,
      roomPin: pin,
      controllerName: null,
      error: null
    });

    // Register room on server over WebSocket
    this.sendWsMessage({
      type: 'register_tv_host',
      code: pin,
      tvName: customTvName,
      timestamp: Date.now()
    });
  }

  stopTvHost() {
    this.sendWsMessage({
      type: 'tv_closed',
      timestamp: Date.now()
    });
    this.updateState({
      isTvHost: false,
      tvStatus: 'idle',
      isControllerConnected: false,
      controllerName: null
    });
  }

  forceStartTvGameDirectly() {
    this.updateState({
      tvStatus: 'connected',
      isControllerConnected: true,
      controllerName: 'تحكم محلي / مباشر'
    });
  }

  // -------------------------------------------------------------
  // PHONE CONTROLLER METHODS (يتم تفعيلها عند الضغط على "اتصال التلفاز")
  // -------------------------------------------------------------
  async searchAndConnectToTv(phoneControllerName = 'يد تحكم الجوال الذكية', specificPin?: string) {
    this.updateState({
      isTvHost: false,
      tvStatus: 'connecting',
      isControllerConnected: false,
      controllerName: phoneControllerName,
      error: null
    });

    // Check REST API for active TV rooms if specific PIN not provided
    let targetCode = specificPin;
    if (!targetCode) {
      try {
        const roomsApi = getTvRoomsApiUrl();
        const res = await fetch(roomsApi);
        if (res.ok) {
          const data = await res.json();
          if (data.rooms && data.rooms.length > 0) {
            targetCode = data.rooms[data.rooms.length - 1].code;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch active TV rooms via REST, relying on WebSocket discovery', err);
      }
    }

    // Send connection request via WebSocket
    this.sendWsMessage({
      type: 'connect_controller',
      code: targetCode,
      controllerName: phoneControllerName,
      timestamp: Date.now()
    });
  }

  disconnectController() {
    this.sendWsMessage({
      type: 'controller_disconnected',
      timestamp: Date.now()
    });
    this.updateState({
      isControllerConnected: false,
      tvStatus: 'idle',
      error: null
    });
  }

  // Forward live controller inputs straight to TV Game (<5ms latency)
  sendTvControlCommand(command: any) {
    // Deliver locally
    controllerBus.emit(command);

    // Deliver across real-time WebSocket to TV server room
    this.sendWsMessage({
      type: 'controller_input',
      command,
      timestamp: Date.now()
    });
  }

  // -------------------------------------------------------------
  // SERVER & LOCAL MESSAGE HANDLERS
  // -------------------------------------------------------------
  private handleServerMessage(data: any) {
    if (!data || !data.type) return;

    if (data.type === 'tv_registered') {
      this.updateState({
        isTvHost: true,
        roomPin: data.code,
        tvStatus: 'searching'
      });
    } else if (data.type === 'controller_joined') {
      // TV receives controller connection confirmation from server
      this.updateState({
        tvStatus: 'connected',
        isControllerConnected: true,
        controllerName: data.controllerName || 'يد تحكم الهاتف'
      });
    } else if (data.type === 'controller_connected') {
      // Phone controller receives connection confirmation
      this.updateState({
        tvStatus: 'connected',
        isControllerConnected: true,
        roomPin: data.code,
        tvName: data.tvName || 'شاشة التلفاز'
      });
    } else if (data.type === 'controller_command') {
      // TV receives live input command from server
      if (data.command) {
        controllerBus.emit(data.command);
      }
    } else if (data.type === 'controller_left') {
      if (this.state.isTvHost) {
        this.updateState({
          tvStatus: 'searching',
          isControllerConnected: false,
          controllerName: null
        });
      }
    } else if (data.type === 'tv_disconnected') {
      if (!this.state.isTvHost) {
        this.updateState({
          tvStatus: 'idle',
          isControllerConnected: false,
          error: data.message || 'تم قطع الاتصال بشاشة التلفاز'
        });
      }
    } else if (data.type === 'error') {
      this.updateState({
        tvStatus: 'idle',
        error: data.message || 'تعذر الاتصال بالتلفاز'
      });
    }
  }

  private handleLocalMessage(data: any) {
    if (!data || !data.type) return;

    if (data.type === 'register_tv_host') {
      // TV Host registered locally
      if (!this.state.isTvHost && this.state.tvStatus === 'connecting') {
        this.sendWsMessage({
          type: 'connect_controller',
          code: data.code,
          controllerName: this.state.controllerName || 'يد تحكم الجوال'
        });
      }
    } else if (data.type === 'connect_controller') {
      // TV host receives local connection
      if (this.state.isTvHost) {
        this.updateState({
          tvStatus: 'connected',
          isControllerConnected: true,
          controllerName: data.controllerName || 'يد تحكم الجوال'
        });
        this.sendWsMessage({
          type: 'controller_connected',
          code: this.state.roomPin,
          tvName: this.state.tvName
        });
      }
    } else if (data.type === 'controller_connected') {
      this.updateState({
        tvStatus: 'connected',
        isControllerConnected: true,
        tvName: data.tvName || this.state.tvName
      });
    } else if (data.type === 'controller_input') {
      if (data.command) {
        controllerBus.emit(data.command);
      }
    }
  }
}

export const tvGameSessionService = new TvGameSessionService();
