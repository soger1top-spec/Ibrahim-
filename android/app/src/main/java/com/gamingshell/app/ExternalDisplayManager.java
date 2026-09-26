package com.gamingshell.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Display;

import java.util.ArrayList;
import java.util.List;

/**
 * Manages detection and presentation lifecycle for external displays reported by Android's DisplayManager.
 * Strictly adheres to Android's real DisplayManager API and DisplayListener callbacks.
 */
public class ExternalDisplayManager {
    private static final String TAG = "ExternalDisplayManager";

    public interface ExternalDisplayListener {
        void onExternalDisplayConnected(Display display);
        void onExternalDisplayDisconnected(int displayId);
        void onExternalDisplayChanged(Display display);
        void onDisplayAdded(Display display);
        void onDisplayRemoved(int displayId);
    }

    private final Context mContext;
    private final DisplayManager mDisplayManager;
    private final Handler mMainHandler = new Handler(Looper.getMainLooper());
    private final List<ExternalDisplayListener> mListeners = new ArrayList<>();

    private Display mActiveDisplay = null;
    private TvPresentation mTvPresentation = null;
    private boolean mIsListening = false;

    private final DisplayManager.DisplayListener mDisplayListener = new DisplayManager.DisplayListener() {
        @Override
        public void onDisplayAdded(int displayId) {
            Log.i(TAG, "DisplayManager onDisplayAdded displayId=" + displayId);
            Display display = mDisplayManager.getDisplay(displayId);
            if (display == null) {
                return;
            }

            notifyDisplayAdded(display);

            // Check if this display is eligible for Presentation
            if (isEligiblePresentationDisplay(display)) {
                Log.i(TAG, "Eligible presentation display added: " + display.getName() + " (ID: " + displayId + ")");
                showPresentationForDisplay(display);
            }
        }

        @Override
        public void onDisplayRemoved(int displayId) {
            Log.i(TAG, "DisplayManager onDisplayRemoved displayId=" + displayId);
            notifyDisplayRemoved(displayId);

            if (mActiveDisplay != null && mActiveDisplay.getDisplayId() == displayId) {
                Log.i(TAG, "Active presentation display was removed: ID " + displayId);
                dismissActivePresentation();
            }
        }

        @Override
        public void onDisplayChanged(int displayId) {
            Log.i(TAG, "DisplayManager onDisplayChanged displayId=" + displayId);
            Display display = mDisplayManager.getDisplay(displayId);
            if (display == null) {
                return;
            }

            if (mActiveDisplay != null && mActiveDisplay.getDisplayId() == displayId) {
                mActiveDisplay = display;
                if (mTvPresentation != null) {
                    mTvPresentation.dispatchDisplayInfo();
                }
                notifyExternalDisplayChanged(display);
            }
        }
    };

    public ExternalDisplayManager(Context context) {
        this.mContext = context.getApplicationContext();
        this.mDisplayManager = (DisplayManager) mContext.getSystemService(Context.DISPLAY_SERVICE);
    }

    public synchronized void startListening() {
        if (mIsListening) {
            return;
        }
        mDisplayManager.registerDisplayListener(mDisplayListener, mMainHandler);
        mIsListening = true;
        Log.i(TAG, "DisplayManager.DisplayListener registered");

        // Scan for any currently attached presentation displays
        checkForExistingPresentationDisplays();
    }

    public synchronized void stopListening() {
        if (!mIsListening) {
            return;
        }
        mDisplayManager.unregisterDisplayListener(mDisplayListener);
        mIsListening = false;
        dismissActivePresentation();
        Log.i(TAG, "DisplayManager.DisplayListener unregistered");
    }

    public void addListener(ExternalDisplayListener listener) {
        if (listener != null && !mListeners.contains(listener)) {
            mListeners.add(listener);
            // If already connected, immediately inform the new listener
            if (mActiveDisplay != null) {
                listener.onExternalDisplayConnected(mActiveDisplay);
            }
        }
    }

    public void removeListener(ExternalDisplayListener listener) {
        mListeners.remove(listener);
    }

    public synchronized void checkForExistingPresentationDisplays() {
        Display[] displays = mDisplayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        Log.i(TAG, "Scanning for presentation displays. Found: " + (displays != null ? displays.length : 0));
        if (displays != null) {
            for (Display display : displays) {
                if (isEligiblePresentationDisplay(display)) {
                    showPresentationForDisplay(display);
                    return;
                }
            }
        }
    }

    public boolean isEligiblePresentationDisplay(Display display) {
        if (display == null) {
            return false;
        }
        // Must not be the phone's primary default display
        if (display.getDisplayId() == Display.DEFAULT_DISPLAY) {
            return false;
        }
        // Must support presentation
        boolean hasPresentationFlag = (display.getFlags() & Display.FLAG_PRESENTATION) != 0;
        return hasPresentationFlag || display.isValid();
    }

    public synchronized void showPresentationForDisplay(Display display) {
        if (display == null) {
            return;
        }

        // If already showing on this same display, keep it
        if (mActiveDisplay != null && mActiveDisplay.getDisplayId() == display.getDisplayId() && mTvPresentation != null) {
            return;
        }

        // Dismiss previous presentation if display changed
        dismissActivePresentation();

        mActiveDisplay = display;
        Log.i(TAG, "Creating and showing TvPresentation on display: " + display.getName() + " (ID: " + display.getDisplayId() + ")");

        try {
            mTvPresentation = new TvPresentation(mContext, display);
            mTvPresentation.show();
            notifyExternalDisplayConnected(display);
        } catch (Exception e) {
            Log.e(TAG, "Error showing TvPresentation", e);
            mActiveDisplay = null;
            mTvPresentation = null;
        }
    }

    public synchronized void dismissActivePresentation() {
        if (mTvPresentation != null) {
            try {
                mTvPresentation.dismiss();
            } catch (Exception e) {
                Log.e(TAG, "Error dismissing TvPresentation", e);
            }
            mTvPresentation = null;
        }

        if (mActiveDisplay != null) {
            int displayId = mActiveDisplay.getDisplayId();
            mActiveDisplay = null;
            notifyExternalDisplayDisconnected(displayId);
        }
    }

    public Display getActiveDisplay() {
        return mActiveDisplay;
    }

    public Display[] getAllPresentationDisplays() {
        return mDisplayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
    }

    public void sendControllerCommand(String commandJson) {
        if (mTvPresentation != null) {
            mTvPresentation.sendControllerCommand(commandJson);
        }
    }

    /**
     * Invokes the real Android or Samsung display selection mechanism.
     * Note: This does NOT assume connection is established; connection is strictly
     * detected by DisplayManager callbacks.
     */
    public SelectionResult openDisplaySelection(Activity activity) {
        if (activity == null) {
            return new SelectionResult(false, "Activity is null");
        }

        PackageManager pm = activity.getPackageManager();

        // 1. Samsung Smart View / Wi-Fi Display Picker dialog
        Intent samsungPicker = new Intent("com.samsung.wfd.LAUNCH_WFD_PICKER_DLG");
        samsungPicker.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        List<ResolveInfo> samsungMatches = pm.queryIntentActivities(samsungPicker, PackageManager.MATCH_DEFAULT_ONLY);
        if (samsungMatches != null && !samsungMatches.isEmpty()) {
            try {
                activity.startActivity(samsungPicker);
                Log.i(TAG, "Launched Samsung Wi-Fi Display Picker (Smart View)");
                return new SelectionResult(true, "com.samsung.wfd.LAUNCH_WFD_PICKER_DLG");
            } catch (Exception e) {
                Log.w(TAG, "Failed to launch Samsung picker intent, trying standard Cast settings", e);
            }
        }

        // 2. Android Standard Cast Settings (Settings.ACTION_CAST_SETTINGS)
        Intent castSettings = new Intent(Settings.ACTION_CAST_SETTINGS);
        castSettings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        List<ResolveInfo> castMatches = pm.queryIntentActivities(castSettings, PackageManager.MATCH_DEFAULT_ONLY);
        if (castMatches != null && !castMatches.isEmpty()) {
            try {
                activity.startActivity(castSettings);
                Log.i(TAG, "Launched Android Settings.ACTION_CAST_SETTINGS");
                return new SelectionResult(true, Settings.ACTION_CAST_SETTINGS);
            } catch (Exception e) {
                Log.w(TAG, "Failed to launch ACTION_CAST_SETTINGS, trying Wi-Fi display settings", e);
            }
        }

        // 3. Android Wi-Fi Display Settings ("android.settings.WIFI_DISPLAY_SETTINGS")
        Intent wifiDisplay = new Intent("android.settings.WIFI_DISPLAY_SETTINGS");
        wifiDisplay.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        List<ResolveInfo> wifiMatches = pm.queryIntentActivities(wifiDisplay, PackageManager.MATCH_DEFAULT_ONLY);
        if (wifiMatches != null && !wifiMatches.isEmpty()) {
            try {
                activity.startActivity(wifiDisplay);
                Log.i(TAG, "Launched android.settings.WIFI_DISPLAY_SETTINGS");
                return new SelectionResult(true, "android.settings.WIFI_DISPLAY_SETTINGS");
            } catch (Exception e) {
                Log.w(TAG, "Failed to launch WIFI_DISPLAY_SETTINGS, falling back to display settings", e);
            }
        }

        // 4. Standard Display Settings fallback (Settings.ACTION_DISPLAY_SETTINGS)
        try {
            Intent displaySettings = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
            displaySettings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(displaySettings);
            Log.i(TAG, "Launched Settings.ACTION_DISPLAY_SETTINGS fallback");
            return new SelectionResult(true, Settings.ACTION_DISPLAY_SETTINGS);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch system display settings", e);
            return new SelectionResult(false, "No compatible display settings activity found: " + e.getMessage());
        }
    }

    public static class SelectionResult {
        public final boolean success;
        public final String actionOrReason;

        public SelectionResult(boolean success, String actionOrReason) {
            this.success = success;
            this.actionOrReason = actionOrReason;
        }
    }

    private void notifyExternalDisplayConnected(Display display) {
        for (ExternalDisplayListener listener : mListeners) {
            listener.onExternalDisplayConnected(display);
        }
    }

    private void notifyExternalDisplayDisconnected(int displayId) {
        for (ExternalDisplayListener listener : mListeners) {
            listener.onExternalDisplayDisconnected(displayId);
        }
    }

    private void notifyExternalDisplayChanged(Display display) {
        for (ExternalDisplayListener listener : mListeners) {
            listener.onExternalDisplayChanged(display);
        }
    }

    private void notifyDisplayAdded(Display display) {
        for (ExternalDisplayListener listener : mListeners) {
            listener.onDisplayAdded(display);
        }
    }

    private void notifyDisplayRemoved(int displayId) {
        for (ExternalDisplayListener listener : mListeners) {
            listener.onDisplayRemoved(displayId);
        }
    }
}
