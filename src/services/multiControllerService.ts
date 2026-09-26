import { controllerBus } from './controllerBus';

export interface ConnectedPlayer {
  id: number;
  name: string;
  connectedAt: number;
}

export interface MultiControllerState {
  isHost: boolean;
  isConnected: boolean;
  sessionCode: string | null;
  myPlayerId: number;
  players: ConnectedPlayer[];
  error: string | null;
}

type StateListener = (state: MultiControllerState) => void;

class MultiControllerService {
  private state: MultiControllerState = {
    isHost: false,
    isConnected: false,
    sessionCode: null,
    myPlayerId: 1,
    players: [],
    error: null
  };

  private listeners: Set<StateListener> = new Set();
  private broadcastChannel: BroadcastChannel | null = null;
  private storageKey = 'gamingshell_multi_session';

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('gamingshell_multicontroller');
        this.broadcastChannel.onmessage = (event) => this.handleMessage(event.data);
      } catch (err) {
        console.warn('BroadcastChannel not supported', err);
      }

      // Storage event listener fallback for multi-window / tabs
      window.addEventListener('storage', (e) => {
        if (e.key === this.storageKey && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            this.handleMessage(data);
          } catch {
            // ignore
          }
        }
      });
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): MultiControllerState {
    return { ...this.state };
  }

  private updateState(partial: Partial<MultiControllerState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l({ ...this.state }));
  }

  private postMessage(msg: any) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg);
      } catch (e) {
        console.warn('Error posting broadcast message', e);
      }
    }
    // Also dispatch to local storage with timestamp to trigger storage events across origins/windows
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify({ ...msg, _t: Date.now() + Math.random() }));
      } catch {
        // ignore
      }
    }
  }

  // Host creates a new join session with a 4-digit code
  async createHostSession(): Promise<string> {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    this.updateState({
      isHost: true,
      isConnected: true,
      sessionCode: code,
      myPlayerId: 1,
      players: [],
      error: null
    });

    this.postMessage({
      type: 'session_created',
      code
    });

    return code;
  }

  // Second phone joins using the code
  async joinSession(inputCode: string): Promise<boolean> {
    const trimmed = inputCode.trim().toUpperCase();
    if (!trimmed) {
      this.updateState({ error: 'يرجى كتابة رمز الاتصال' });
      return false;
    }

    this.updateState({ error: null });

    // Send join request
    const tempPlayerId = 2; // default extra player
    this.postMessage({
      type: 'join_request',
      code: trimmed,
      playerId: tempPlayerId,
      name: 'اللاعب 2 (يد إضافية)'
    });

    // Mark client connected
    this.updateState({
      isHost: false,
      isConnected: true,
      sessionCode: trimmed,
      myPlayerId: tempPlayerId,
      error: null
    });

    return true;
  }

  // Client sends control command to Host & Game
  sendClientCommand(command: any) {
    const payload = {
      ...command,
      playerId: this.state.myPlayerId
    };

    // Emit locally
    controllerBus.emit(payload);

    // Broadcast to host and other displays
    this.postMessage({
      type: 'client_control',
      code: this.state.sessionCode,
      payload
    });
  }

  // Message handler for session lifecycle and inputs
  private handleMessage(data: any) {
    if (!data || !data.type) return;

    if (data.type === 'session_created') {
      // Info broadcast
    } else if (data.type === 'join_request') {
      if (this.state.isHost && (!this.state.sessionCode || this.state.sessionCode === data.code)) {
        const newPlayer: ConnectedPlayer = {
          id: data.playerId || this.state.players.length + 2,
          name: data.name || `اللاعب ${this.state.players.length + 2}`,
          connectedAt: Date.now()
        };

        const updated = [...this.state.players.filter((p) => p.id !== newPlayer.id), newPlayer];
        this.updateState({ players: updated });

        // Notify game bus that player joined
        controllerBus.emit({
          type: 'player_joined',
          playerId: newPlayer.id,
          name: newPlayer.name
        });

        // Acknowledge join to the client
        this.postMessage({
          type: 'join_accepted',
          code: data.code,
          assignedPlayerId: newPlayer.id,
          players: updated
        });
      }
    } else if (data.type === 'join_accepted') {
      if (!this.state.isHost && this.state.sessionCode === data.code) {
        this.updateState({
          isConnected: true,
          myPlayerId: data.assignedPlayerId || 2,
          players: data.players || []
        });
      }
    } else if (data.type === 'client_control') {
      if (this.state.isHost && this.state.sessionCode === data.code) {
        // Host delivers client controller input into game
        if (data.payload) {
          controllerBus.emit(data.payload);
        }
      }
    } else if (data.type === 'session_closed') {
      if (!this.state.isHost && this.state.sessionCode === data.code) {
        this.cleanup();
        this.updateState({ error: 'تم إنهاء الجلسة من قبل المضيف' });
      }
    }
  }

  cleanup() {
    if (this.state.isHost && this.state.sessionCode) {
      this.postMessage({
        type: 'session_closed',
        code: this.state.sessionCode
      });
    }
    this.updateState({
      isHost: false,
      isConnected: false,
      sessionCode: null,
      myPlayerId: 1,
      players: [],
      error: null
    });
  }
}

export const multiControllerService = new MultiControllerService();
