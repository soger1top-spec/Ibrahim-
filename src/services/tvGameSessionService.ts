import { controllerBus } from './controllerBus';
import { getTvWebSocketUrl, getTvRoomsApiUrl } from './serverConfig';
import {
  isNativeLanAvailable,
  startNativeTvHost,
  stopNativeTvHost,
  startNativeTvDiscovery,
  type DiscoveredTv
} from './nativeLanBridge';

export type TvConnectionStatus = 'idle' | 'searching' | 'connecting' | 'connected' | 'disconnected';

export interface TvSessionState {
  isTvHost: boolean;
  tvStatus: TvConnectionStatus;
  isControllerConnected: boolean;
  tvName: string;
  controllerName: string | null;
  roomPin: string | null;
  localIp: string | null;
  localPort: number | null;
  discoveredTvs: DiscoveredTv[];
  selectedTv: DiscoveredTv | null;
  lastConnectedAt: number | null;
  error: string | null;
  wsConnected: boolean;
  isNative: boolean;
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
    localIp: null,
    localPort: null,
    discoveredTvs: [],
    selectedTv: null,
    lastConnectedAt: null,
    error: null,
    wsConnected: false,
    isNative: false
  };

  private listeners: Set<TvSessionListener> = new Set();
  private ws: WebSocket | null = null;
  private stopNativeDiscoveryFn: (() => void) | null = null;
  private heartbeatInterval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.state.isNative = isNativeLanAvailable();

      // Listen to native events dispatched from TvLanBridgePlugin
      window.addEventListener('sunset_tv_native_event', (e: any) => {
        if (e.detail) {
          this.handleNativeBridgeEvent(e.detail);
        }
      });
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
        console.warn('WebSocket send error:', e);
      }
    }
  }

  // -------------------------------------------------------------
  // TV HOST METHODS (لعبة التلفزيون: بدء الخادم المحلي الحقيقي)
  // -------------------------------------------------------------
  async startTvHost(customTvName = 'شاشة التلفاز الرئيسية') {
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

    // 1. Android Native Mode: Run embedded WebSocket Server + NSD mDNS Advertisement
    if (isNativeLanAvailable()) {
      try {
        const res = await startNativeTvHost(customTvName, pin, 8765);
        if (res && res.success) {
          this.updateState({
            localIp: res.ip,
            localPort: res.port,
            wsConnected: true
          });

          // Connect local WebView to the local native WebSocket server
          this.connectLocalTvSocket(res.wsUrl || `ws://127.0.0.1:${res.port}`);
          return;
        }
      } catch (err) {
        console.warn('Native TV Host start failed, falling back to Web TV server:', err);
      }
    }

    // 2. Web TV Fallback (for Smart TV browsers without Android APK)
    const wsUrl = getTvWebSocketUrl();
    if (wsUrl) {
      this.connectWebSocket(wsUrl, () => {
        this.sendWsMessage({
          type: 'register_tv_host',
          code: pin,
          tvName: customTvName,
          timestamp: Date.now()
        });
      });
    }
  }

  private connectLocalTvSocket(wsUrl: string) {
    try {
      if (this.ws) {
        this.ws.close();
      }
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.updateState({ wsConnected: true, error: null });
        this.sendWsMessage({
          type: 'register_tv_host',
          code: this.state.roomPin,
          tvName: this.state.tvName
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (err) {
          console.error('Error parsing TV WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.updateState({ wsConnected: false });
      };

      this.ws.onerror = (err) => {
        console.warn('TV Local WS error:', err);
      };
    } catch (e) {
      console.warn('Failed to connect local TV socket:', e);
    }
  }

  async stopTvHost() {
    this.sendWsMessage({
      type: 'tv_closed',
      timestamp: Date.now()
    });

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    if (isNativeLanAvailable()) {
      await stopNativeTvHost();
    }

    this.updateState({
      isTvHost: false,
      tvStatus: 'idle',
      isControllerConnected: false,
      controllerName: null,
      roomPin: null,
      localIp: null,
      localPort: null,
      wsConnected: false
    });
  }

  forceStartTvGameDirectly() {
    this.updateState({
      tvStatus: 'connected',
      isControllerConnected: true,
      controllerName: 'تحكم محلي / ريموت'
    });
  }

  // -------------------------------------------------------------
  // CONTROLLER METHODS (يد التلفاز: البحث التلقائي عبر NSD والاتصال)
  // -------------------------------------------------------------
  async searchAndConnectToTv(phoneControllerName = 'يد تحكم الجوال الذكية', specificPin?: string) {
    this.updateState({
      isTvHost: false,
      tvStatus: 'searching',
      isControllerConnected: false,
      controllerName: phoneControllerName,
      discoveredTvs: [],
      selectedTv: null,
      error: null
    });

    // Clean up previous discovery and connections
    if (this.stopNativeDiscoveryFn) {
      this.stopNativeDiscoveryFn();
      this.stopNativeDiscoveryFn = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    // 1. Android Native Mode: Auto-discover TV via Android NSD / mDNS on local Wi-Fi
    if (isNativeLanAvailable()) {
      this.stopNativeDiscoveryFn = await startNativeTvDiscovery(
        (discoveredTv) => {
          this.handleTvDiscovered(discoveredTv, specificPin);
        },
        (lostId) => {
          this.handleTvLost(lostId);
        }
      );
      return;
    }

    // 2. Web TV Fallback (for browser development or remote fallback)
    const wsUrl = getTvWebSocketUrl();
    if (wsUrl) {
      this.connectWebSocket(wsUrl, async () => {
        let targetCode = specificPin;
        if (!targetCode) {
          try {
            const roomsApi = getTvRoomsApiUrl();
            if (roomsApi) {
              const res = await fetch(roomsApi);
              if (res.ok) {
                const data = await res.json();
                if (data.rooms && data.rooms.length > 0) {
                  targetCode = data.rooms[data.rooms.length - 1].code;
                }
              }
            }
          } catch (e) {
            console.warn('Rooms API check error:', e);
          }
        }

        this.sendWsMessage({
          type: 'connect_controller',
          code: targetCode,
          controllerName: phoneControllerName,
          timestamp: Date.now()
        });
      });
    }
  }

  private handleTvDiscovered(tv: DiscoveredTv, targetPin?: string) {
    const list = [...this.state.discoveredTvs];
    const existingIndex = list.findIndex(t => t.id === tv.id || (t.ip === tv.ip && t.port === tv.port));

    if (existingIndex >= 0) {
      list[existingIndex] = tv;
    } else {
      list.push(tv);
    }

    this.updateState({ discoveredTvs: list });

    // Auto-connect rule:
    // If specific PIN matched OR exactly 1 TV is discovered and not connected yet:
    if (!this.state.isControllerConnected && this.state.tvStatus === 'searching') {
      if (targetPin && tv.pin === targetPin) {
        this.connectToDiscoveredTv(tv);
      } else if (!targetPin && list.length === 1) {
        this.connectToDiscoveredTv(tv);
      }
    }
  }

  private handleTvLost(tvId: string) {
    const list = this.state.discoveredTvs.filter(t => t.id !== tvId);
    this.updateState({ discoveredTvs: list });
  }

  connectToDiscoveredTv(tv: DiscoveredTv) {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.updateState({
      selectedTv: tv,
      tvStatus: 'connecting',
      error: null
    });

    try {
      this.ws = new WebSocket(tv.wsUrl);

      this.ws.onopen = () => {
        // Send initial connect_controller packet
        this.sendWsMessage({
          type: 'connect_controller',
          code: tv.pin,
          controllerName: this.state.controllerName || 'يد تحكم الجوال',
          timestamp: Date.now()
        });

        // Ping interval
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 12000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (err) {
          console.error('Error parsing controller WS message:', err);
        }
      };

      this.ws.onclose = () => {
        if (this.state.isControllerConnected) {
          this.updateState({
            tvStatus: 'disconnected',
            isControllerConnected: false,
            wsConnected: false,
            error: 'تم قطع الاتصال بشاشة التلفاز'
          });
        }
      };

      this.ws.onerror = (err) => {
        console.warn('Error connecting to TV WebSocket:', err);
        this.updateState({
          tvStatus: 'searching',
          error: `تعذر الاتصال بـ ${tv.name}`
        });
      };
    } catch (err: any) {
      this.updateState({
        tvStatus: 'searching',
        error: `خطأ في الاتصال: ${err?.message || ''}`
      });
    }
  }

  disconnectController() {
    this.sendWsMessage({
      type: 'controller_disconnected',
      timestamp: Date.now()
    });

    if (this.stopNativeDiscoveryFn) {
      this.stopNativeDiscoveryFn();
      this.stopNativeDiscoveryFn = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.updateState({
      isControllerConnected: false,
      tvStatus: 'idle',
      selectedTv: null,
      discoveredTvs: [],
      error: null
    });
  }

  // -------------------------------------------------------------
  // LIVE INPUT TRANSMISSION (<2ms Real-Time Controller Forwarding)
  // -------------------------------------------------------------
  sendTvControlCommand(command: any) {
    if (!command) return;

    // Emit locally for in-app handling
    controllerBus.emit(command);

    // Deliver across real-time local WebSocket directly to TV Host
    this.sendWsMessage({
      type: 'controller_input',
      command,
      timestamp: Date.now()
    });
  }

  // -------------------------------------------------------------
  // GENERIC WEBSOCKET CONNECTOR (Web TV Fallback)
  // -------------------------------------------------------------
  private connectWebSocket(url: string, onOpenCallback?: () => void) {
    try {
      if (this.ws) {
        this.ws.close();
      }
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.updateState({ wsConnected: true, error: null });
        if (onOpenCallback) onOpenCallback();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (err) {
          console.error('Error in WS message parse:', err);
        }
      };

      this.ws.onclose = () => {
        this.updateState({ wsConnected: false });
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
      };
    } catch (e) {
      console.warn('Failed to initiate WebSocket connection:', e);
    }
  }

  // -------------------------------------------------------------
  // PROTOCOL MESSAGE HANDLERS
  // -------------------------------------------------------------
  private handleServerMessage(data: any) {
    if (!data || !data.type) return;

    // 1. TV Host Registration Ack
    if (data.type === 'tv_registered') {
      this.updateState({
        isTvHost: true,
        roomPin: data.code,
        tvStatus: 'searching'
      });
    }
    // 2. Controller Connected (Phone receives handshake confirmation)
    else if (data.type === 'controller_connected') {
      this.updateState({
        tvStatus: 'connected',
        isControllerConnected: true,
        roomPin: data.code,
        tvName: data.tvName || this.state.tvName,
        wsConnected: true,
        lastConnectedAt: Date.now(),
        error: null
      });
    }
    // 3. Controller Joined (TV receives notification of controller connection)
    else if (data.type === 'controller_joined') {
      this.updateState({
        tvStatus: 'connected',
        isControllerConnected: true,
        controllerName: data.controllerName || 'يد تحكم الهاتف'
      });
    }
    // 4. Controller Command (TV receives live controller input)
    else if (data.type === 'controller_command') {
      if (data.command) {
        if (typeof (window as any).onTvControllerInput === 'function') {
          (window as any).onTvControllerInput(data.command);
        }
        controllerBus.emit(data.command);
      }
    }
    // 5. Controller Left
    else if (data.type === 'controller_left') {
      if (this.state.isTvHost) {
        this.updateState({
          tvStatus: 'searching',
          isControllerConnected: false,
          controllerName: null
        });
      }
    }
    // 6. TV Disconnected
    else if (data.type === 'tv_disconnected') {
      if (!this.state.isTvHost) {
        this.updateState({
          tvStatus: 'disconnected',
          isControllerConnected: false,
          error: data.message || 'تم قطع الاتصال بشاشة التلفاز'
        });
      }
    }
    // 7. Error
    else if (data.type === 'error') {
      this.updateState({
        tvStatus: 'idle',
        error: data.message || 'تعذر إتمام الاتصال'
      });
    }
  }

  private handleNativeBridgeEvent(event: { type: string; data: any }) {
    if (!event || !event.type) return;

    if (event.type === 'controller_joined') {
      this.updateState({
        tvStatus: 'connected',
        isControllerConnected: true,
        controllerName: event.data?.controllerName || 'يد تحكم الهاتف'
      });
    } else if (event.type === 'controller_left') {
      if (this.state.isTvHost) {
        this.updateState({
          tvStatus: 'searching',
          isControllerConnected: false,
          controllerName: null
        });
      }
    }
  }
}

export const tvGameSessionService = new TvGameSessionService();
