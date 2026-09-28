// High-performance Controller Event Bus for zero-latency input delivery to TV and Games
type ControllerCallback = (command: any) => void;

class ControllerEventBus {
  private listeners: Set<ControllerCallback> = new Set();
  private lastCommand: any = null;

  subscribe(callback: ControllerCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  emit(command: any) {
    this.lastCommand = command;
    this.listeners.forEach(cb => {
      try {
        cb(command);
      } catch (err) {
        console.error('Error in controller listener:', err);
      }
    });
  }

  getLastCommand() {
    return this.lastCommand;
  }
}

export const controllerBus = new ControllerEventBus();

// Bind global window hook so native Android TvLanBridge can inject directly
if (typeof window !== 'undefined') {
  (window as any).onTvControllerInput = (cmd: any) => {
    controllerBus.emit(cmd);
    window.dispatchEvent(new CustomEvent('gamingshell_control_input', { detail: cmd }));
  };

  window.addEventListener('gamingshell_control_input', (e: any) => {
    if (e.detail) {
      controllerBus.emit(e.detail);
    }
  });
}
