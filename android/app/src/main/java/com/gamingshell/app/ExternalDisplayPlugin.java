package com.gamingshell.app;

import android.graphics.Point;
import android.os.Build;
import android.util.Log;
import android.view.Display;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin bridging Android's real DisplayManager and Presentation architecture
 * to the web layer.
 */
@CapacitorPlugin(name = "ExternalDisplay")
public class ExternalDisplayPlugin extends Plugin implements ExternalDisplayManager.ExternalDisplayListener {
    private static final String TAG = "ExternalDisplayPlugin";
    private ExternalDisplayManager mDisplayManager;

    @Override
    public void load() {
        super.load();
        Log.i(TAG, "Initializing ExternalDisplayPlugin");
        mDisplayManager = new ExternalDisplayManager(getContext());
        mDisplayManager.addListener(this);
        mDisplayManager.startListening();
    }

    @Override
    protected void handleOnDestroy() {
        if (mDisplayManager != null) {
            mDisplayManager.removeListener(this);
            mDisplayManager.stopListening();
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void openDisplaySelection(PluginCall call) {
        Log.i(TAG, "Invoking system display selection");
        if (mDisplayManager == null) {
            call.reject("DisplayManager is not initialized");
            return;
        }

        ExternalDisplayManager.SelectionResult result = mDisplayManager.openDisplaySelection(getActivity());
        JSObject ret = new JSObject();
        ret.put("initiated", result.success);
        ret.put("action", result.actionOrReason);
        // Note: isConnected is NOT set here. It will only be set when DisplayManager actually reports the display.
        call.resolve(ret);
    }

    @PluginMethod
    public void getConnectedDisplay(PluginCall call) {
        JSObject ret = new JSObject();
        if (mDisplayManager != null && mDisplayManager.getActiveDisplay() != null) {
            Display display = mDisplayManager.getActiveDisplay();
            ret.put("isConnected", true);
            ret.put("display", serializeDisplay(display));
        } else {
            ret.put("isConnected", false);
            ret.put("display", null);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void getPresentationDisplays(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray displaysArray = new JSArray();

        if (mDisplayManager != null) {
            Display[] displays = mDisplayManager.getAllPresentationDisplays();
            if (displays != null) {
                for (Display display : displays) {
                    displaysArray.put(serializeDisplay(display));
                }
            }
        }

        ret.put("displays", displaysArray);
        call.resolve(ret);
    }

    @PluginMethod
    public void dismissPresentation(PluginCall call) {
        if (mDisplayManager != null) {
            mDisplayManager.dismissActivePresentation();
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void sendControlCommand(PluginCall call) {
        String command = call.getString("command");
        if (command != null && mDisplayManager != null) {
            mDisplayManager.sendControllerCommand(command);
        }
        call.resolve();
    }

    private JSObject serializeDisplay(Display display) {
        JSObject obj = new JSObject();
        if (display == null) {
            return obj;
        }

        obj.put("displayId", display.getDisplayId());
        // Android's real display name - never hardcoded
        obj.put("name", display.getName());
        obj.put("flags", display.getFlags());
        obj.put("state", display.getState());
        obj.put("refreshRate", display.getRefreshRate());

        Point size = new Point();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display.getRealSize(size);
        } else {
            display.getSize(size);
        }
        obj.put("width", size.x);
        obj.put("height", size.y);

        return obj;
    }

    // --- ExternalDisplayManager.ExternalDisplayListener Callbacks ---

    @Override
    public void onExternalDisplayConnected(Display display) {
        Log.i(TAG, "Native event: onExternalDisplayConnected ID=" + display.getDisplayId() + ", Name=" + display.getName());
        JSObject data = serializeDisplay(display);
        notifyListeners("externalDisplayConnected", data);
    }

    @Override
    public void onExternalDisplayDisconnected(int displayId) {
        Log.i(TAG, "Native event: onExternalDisplayDisconnected ID=" + displayId);
        JSObject data = new JSObject();
        data.put("displayId", displayId);
        notifyListeners("externalDisplayDisconnected", data);
    }

    @Override
    public void onExternalDisplayChanged(Display display) {
        Log.i(TAG, "Native event: onExternalDisplayChanged ID=" + display.getDisplayId());
        JSObject data = serializeDisplay(display);
        notifyListeners("externalDisplayChanged", data);
    }

    @Override
    public void onDisplayAdded(Display display) {
        Log.i(TAG, "Native event: onDisplayAdded ID=" + display.getDisplayId());
        JSObject data = serializeDisplay(display);
        notifyListeners("displayAdded", data);
    }

    @Override
    public void onDisplayRemoved(int displayId) {
        Log.i(TAG, "Native event: onDisplayRemoved ID=" + displayId);
        JSObject data = new JSObject();
        data.put("displayId", displayId);
        notifyListeners("displayRemoved", data);
    }
}
