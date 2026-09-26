import { registerPlugin, Capacitor, PluginListenerHandle } from '@capacitor/core';
import { controllerBus } from './controllerBus';

export interface DisplayInfo {
  displayId: number;
  name: string;
  flags: number;
  state: number;
  width: number;
  height: number;
  refreshRate: number;
}

export interface SelectionResult {
  initiated: boolean;
  action: string;
}

export interface ConnectedDisplayResult {
  isConnected: boolean;
  display: DisplayInfo | null;
}

export interface PresentationDisplaysResult {
  displays: DisplayInfo[];
}

export interface ExternalDisplayPlugin {
  openDisplaySelection(): Promise<SelectionResult>;
  getConnectedDisplay(): Promise<ConnectedDisplayResult>;
  getPresentationDisplays(): Promise<PresentationDisplaysResult>;
  dismissPresentation(): Promise<{ success: boolean }>;
  sendControlCommand(options: { command: string }): Promise<void>;

  addListener(
    eventName: 'externalDisplayConnected',
    listenerFunc: (display: DisplayInfo) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'externalDisplayDisconnected',
    listenerFunc: (data: { displayId: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'externalDisplayChanged',
    listenerFunc: (display: DisplayInfo) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'displayAdded',
    listenerFunc: (display: DisplayInfo) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'displayRemoved',
    listenerFunc: (data: { displayId: number }) => void
  ): Promise<PluginListenerHandle>;
}

// Register the native Capacitor plugin
const NativeExternalDisplay = registerPlugin<ExternalDisplayPlugin>('ExternalDisplay');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Service providing connection handling and display lifecycle methods.
 * Strictly reflects REAL native Android DisplayManager state.
 */
class ExternalDisplayService {
  private listeners: { [event: string]: Array<(...args: any[]) => void> } = {};

  async openDisplaySelection(): Promise<SelectionResult> {
    if (isNativeAndroid()) {
      try {
        return await NativeExternalDisplay.openDisplaySelection();
      } catch (err: any) {
        console.error('Failed to open native display selection:', err);
        return { initiated: false, action: err?.message || 'Error' };
      }
    }

    // In web browser environment, report that native display selection is on Android
    return {
      initiated: false,
      action: 'Web environment: Native DisplayManager & Cast Settings available on Android device'
    };
  }

  async getConnectedDisplay(): Promise<ConnectedDisplayResult> {
    if (isNativeAndroid()) {
      try {
        return await NativeExternalDisplay.getConnectedDisplay();
      } catch (err) {
        console.error('Failed to get connected display:', err);
        return { isConnected: false, display: null };
      }
    }
    // Web environment: No real Android display attached
    return { isConnected: false, display: null };
  }

  async getPresentationDisplays(): Promise<PresentationDisplaysResult> {
    if (isNativeAndroid()) {
      try {
        return await NativeExternalDisplay.getPresentationDisplays();
      } catch (err) {
        console.error('Failed to get presentation displays:', err);
        return { displays: [] };
      }
    }
    return { displays: [] };
  }

  async dismissPresentation(): Promise<{ success: boolean }> {
    if (isNativeAndroid()) {
      try {
        return await NativeExternalDisplay.dismissPresentation();
      } catch (err) {
        console.error('Failed to dismiss presentation:', err);
        return { success: false };
      }
    }
    return { success: true };
  }

  async sendControlCommand(command: object): Promise<void> {
    controllerBus.emit(command);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gamingshell_control_input', { detail: command }));
    }
    if (isNativeAndroid()) {
      try {
        const jsonStr = JSON.stringify(command);
        await NativeExternalDisplay.sendControlCommand({ command: jsonStr });
      } catch (err) {
        console.error('Failed to send control command:', err);
      }
    }
  }

  async addListener(
    eventName:
      | 'externalDisplayConnected'
      | 'externalDisplayDisconnected'
      | 'externalDisplayChanged'
      | 'displayAdded'
      | 'displayRemoved',
    callback: (...args: any[]) => void
  ): Promise<PluginListenerHandle> {
    if (isNativeAndroid()) {
      return await (NativeExternalDisplay as any).addListener(eventName, callback);
    }

    // Browser event listener fallback
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback);

    return {
      remove: async () => {
        this.listeners[eventName] = (this.listeners[eventName] || []).filter(cb => cb !== callback);
      }
    };
  }

  // Developer simulation helper for browser preview ONLY
  // Allows testing the TV Presentation view during web development without falsifying native state
  simulateBrowserDisplayConnect(display: DisplayInfo): void {
    if (!isNativeAndroid()) {
      (this.listeners['externalDisplayConnected'] || []).forEach(cb => cb(display));
    }
  }

  simulateBrowserDisplayDisconnect(displayId: number): void {
    if (!isNativeAndroid()) {
      (this.listeners['externalDisplayDisconnected'] || []).forEach(cb => cb({ displayId }));
    }
  }
}

export const externalDisplayService = new ExternalDisplayService();
