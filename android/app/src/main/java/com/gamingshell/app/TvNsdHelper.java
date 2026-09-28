package com.gamingshell.app;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.Queue;

/**
 * Manages local network service discovery (Android NSD / mDNS)
 * Allows TV to advertise itself and Phone Controller to discover TV without IP entry.
 */
public class TvNsdHelper {
    private static final String TAG = "TvNsdHelper";
    public static final String SERVICE_TYPE = "_sunset-tv._tcp.";

    public interface DiscoveryListener {
        void onTvDiscovered(String id, String name, String ip, int port, String pin);
        void onTvLost(String id);
    }

    public interface RegistrationListener {
        void onServiceRegistered(String serviceName, int port);
        void onRegistrationFailed(int errorCode);
    }

    private final Context mContext;
    private final NsdManager mNsdManager;
    private final WifiManager.MulticastLock mMulticastLock;
    private final Handler mMainHandler = new Handler(Looper.getMainLooper());

    private NsdManager.RegistrationListener mRegistrationListener;
    private NsdManager.DiscoveryListener mDiscoveryListener;
    private boolean mIsRegistered = false;
    private boolean mIsDiscovering = false;

    // Sequential resolve queue to prevent NsdManager FAILURE_ALREADY_ACTIVE
    private final Queue<NsdServiceInfo> mResolveQueue = new ArrayDeque<>();
    private boolean mIsResolving = false;
    private DiscoveryListener mCurrentDiscoveryListener;

    public TvNsdHelper(Context context) {
        this.mContext = context.getApplicationContext();
        this.mNsdManager = (NsdManager) mContext.getSystemService(Context.NSD_SERVICE);

        WifiManager wifiManager = (WifiManager) mContext.getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            mMulticastLock = wifiManager.createMulticastLock("sunset_tv_nsd_lock");
            mMulticastLock.setReferenceCounted(true);
        } else {
            mMulticastLock = null;
        }
    }

    private void acquireMulticastLock() {
        try {
            if (mMulticastLock != null && !mMulticastLock.isHeld()) {
                mMulticastLock.acquire();
                Log.i(TAG, "Wi-Fi MulticastLock acquired for NSD discovery");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire MulticastLock", e);
        }
    }

    private void releaseMulticastLock() {
        try {
            if (mMulticastLock != null && mMulticastLock.isHeld()) {
                mMulticastLock.release();
                Log.i(TAG, "Wi-Fi MulticastLock released");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to release MulticastLock", e);
        }
    }

    // -------------------------------------------------------------
    // TV HOST SERVICE REGISTRATION (إعلان التلفاز عن نفسه محلياً)
    // -------------------------------------------------------------
    public synchronized void registerTvService(String tvName, String pin, int port, RegistrationListener listener) {
        if (mIsRegistered) {
            unregisterTvService();
        }

        acquireMulticastLock();

        // Safe DNS-SD service name
        String safeName = "SunsetTV_" + (pin != null && !pin.isEmpty() ? pin : "0000");

        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        serviceInfo.setServiceName(safeName);
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(port);

        // Attributes (Android 5.0+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                if (tvName != null && !tvName.isEmpty()) {
                    serviceInfo.setAttribute("tvName", tvName);
                }
                if (pin != null && !pin.isEmpty()) {
                    serviceInfo.setAttribute("pin", pin);
                }
                serviceInfo.setAttribute("version", "1.0");
            } catch (Exception e) {
                Log.w(TAG, "Failed to set NSD attributes", e);
            }
        }

        mRegistrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo info) {
                mIsRegistered = true;
                Log.i(TAG, "TV Service successfully registered via NSD: " + info.getServiceName() + " on port " + info.getPort());
                if (listener != null) {
                    mMainHandler.post(() -> listener.onServiceRegistered(info.getServiceName(), info.getPort()));
                }
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {
                mIsRegistered = false;
                releaseMulticastLock();
                Log.e(TAG, "TV Service registration failed. ErrorCode: " + errorCode);
                if (listener != null) {
                    mMainHandler.post(() -> listener.onRegistrationFailed(errorCode));
                }
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo info) {
                mIsRegistered = false;
                releaseMulticastLock();
                Log.i(TAG, "TV Service unregistered successfully");
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {
                mIsRegistered = false;
                releaseMulticastLock();
                Log.e(TAG, "TV Service unregistration failed. ErrorCode: " + errorCode);
            }
        };

        try {
            mNsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, mRegistrationListener);
        } catch (Exception e) {
            Log.e(TAG, "Exception during registerService", e);
            releaseMulticastLock();
            if (listener != null) listener.onRegistrationFailed(-1);
        }
    }

    public synchronized void unregisterTvService() {
        if (!mIsRegistered || mRegistrationListener == null) return;
        try {
            mNsdManager.unregisterService(mRegistrationListener);
        } catch (Exception e) {
            Log.w(TAG, "Error unregistering NSD service", e);
        } finally {
            mIsRegistered = false;
            mRegistrationListener = null;
            releaseMulticastLock();
        }
    }

    // -------------------------------------------------------------
    // CONTROLLER DISCOVERY (بحث يد التحكم عن شاشات التلفاز)
    // -------------------------------------------------------------
    public synchronized void startDiscovery(DiscoveryListener listener) {
        if (mIsDiscovering) {
            stopDiscovery();
        }

        this.mCurrentDiscoveryListener = listener;
        mResolveQueue.clear();
        mIsResolving = false;

        acquireMulticastLock();

        mDiscoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String regType) {
                mIsDiscovering = true;
                Log.i(TAG, "NSD Service discovery started for: " + regType);
            }

            @Override
            public void onServiceFound(NsdServiceInfo service) {
                Log.i(TAG, "NSD Service found: " + service.getServiceName() + " (" + service.getServiceType() + ")");
                enqueueResolve(service);
            }

            @Override
            public void onServiceLost(NsdServiceInfo service) {
                Log.i(TAG, "NSD Service lost: " + service.getServiceName());
                if (mCurrentDiscoveryListener != null) {
                    mMainHandler.post(() -> mCurrentDiscoveryListener.onTvLost(service.getServiceName()));
                }
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                mIsDiscovering = false;
                releaseMulticastLock();
                Log.i(TAG, "NSD Discovery stopped");
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                mIsDiscovering = false;
                releaseMulticastLock();
                Log.e(TAG, "Discovery start failed: ErrorCode " + errorCode);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                mIsDiscovering = false;
                releaseMulticastLock();
                Log.e(TAG, "Discovery stop failed: ErrorCode " + errorCode);
            }
        };

        try {
            mNsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, mDiscoveryListener);
        } catch (Exception e) {
            Log.e(TAG, "Exception during startDiscovery", e);
            releaseMulticastLock();
        }
    }

    public synchronized void stopDiscovery() {
        if (!mIsDiscovering || mDiscoveryListener == null) return;
        try {
            mNsdManager.stopServiceDiscovery(mDiscoveryListener);
        } catch (Exception e) {
            Log.w(TAG, "Error stopping discovery", e);
        } finally {
            mIsDiscovering = false;
            mDiscoveryListener = null;
            mCurrentDiscoveryListener = null;
            mResolveQueue.clear();
            mIsResolving = false;
            releaseMulticastLock();
        }
    }

    // Queue resolves sequentially to avoid Android's NsdManager FAILURE_ALREADY_ACTIVE
    private synchronized void enqueueResolve(NsdServiceInfo service) {
        mResolveQueue.offer(service);
        if (!mIsResolving) {
            processNextResolve();
        }
    }

    private synchronized void processNextResolve() {
        if (mResolveQueue.isEmpty()) {
            mIsResolving = false;
            return;
        }

        mIsResolving = true;
        NsdServiceInfo serviceToResolve = mResolveQueue.poll();

        // 2-second timeout watchdog in case resolve hangs
        Runnable timeoutRunnable = () -> {
            Log.w(TAG, "Resolve timed out for: " + (serviceToResolve != null ? serviceToResolve.getServiceName() : "null"));
            synchronized (TvNsdHelper.this) {
                processNextResolve();
            }
        };
        mMainHandler.postDelayed(timeoutRunnable, 2000);

        try {
            mNsdManager.resolveService(serviceToResolve, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    mMainHandler.removeCallbacks(timeoutRunnable);
                    Log.w(TAG, "Resolve failed for " + serviceInfo.getServiceName() + ". Error: " + errorCode);
                    synchronized (TvNsdHelper.this) {
                        processNextResolve();
                    }
                }

                @Override
                public void onServiceResolved(NsdServiceInfo resolvedService) {
                    mMainHandler.removeCallbacks(timeoutRunnable);
                    InetAddress host = resolvedService.getHost();
                    if (host == null) {
                        synchronized (TvNsdHelper.this) {
                            processNextResolve();
                        }
                        return;
                    }

                    String ip = host.getHostAddress();
                    int port = resolvedService.getPort();
                    String serviceName = resolvedService.getServiceName();

                    String tvName = "شاشة التلفاز";
                    String pin = "";

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        try {
                            Map<String, byte[]> attrs = resolvedService.getAttributes();
                            if (attrs != null) {
                                byte[] nameBytes = attrs.get("tvName");
                                if (nameBytes != null) tvName = new String(nameBytes, StandardCharsets.UTF_8);
                                byte[] pinBytes = attrs.get("pin");
                                if (pinBytes != null) pin = new String(pinBytes, StandardCharsets.UTF_8);
                            }
                        } catch (Exception ignored) {}
                    }

                    if (pin.isEmpty()) {
                        // Extract pin from service name if encoded
                        String[] parts = serviceName.split("_");
                        if (parts.length >= 2) {
                            pin = parts[parts.length - 1];
                        }
                    }

                    Log.i(TAG, "NSD TV Discovered successfully: " + tvName + " at ws://" + ip + ":" + port + " (PIN: " + pin + ")");

                    final String finalTvName = tvName;
                    final String finalPin = pin;
                    if (mCurrentDiscoveryListener != null) {
                        mMainHandler.post(() -> mCurrentDiscoveryListener.onTvDiscovered(
                                serviceName,
                                finalTvName,
                                ip,
                                port,
                                finalPin
                        ));
                    }

                    synchronized (TvNsdHelper.this) {
                        processNextResolve();
                    }
                }
            });
        } catch (Exception e) {
            mMainHandler.removeCallbacks(timeoutRunnable);
            Log.e(TAG, "Exception resolving service", e);
            processNextResolve();
        }
    }
}
