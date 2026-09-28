package com.gamingshell.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

/**
 * Native Capacitor Plugin for Local Wi-Fi TV Game & Phone Controller connectivity.
 * Powers direct Wi-Fi WebSocket Server + NSD mDNS Discovery without any internet,
 * cloud servers, or screen mirroring.
 */
@CapacitorPlugin(name = "TvLanBridge")
public class TvLanBridgePlugin extends Plugin {
    private static final String TAG = "TvLanBridgePlugin";
    private static final int DEFAULT_PORT = 8765;

    private TvWebSocketServer mServer;
    private TvNsdHelper mNsdHelper;
    private String mCurrentTvName = "شاشة التلفاز الذكية";
    private String mCurrentPin = "1000";

    @Override
    public void load() {
        super.load();
        Log.i(TAG, "Initializing TvLanBridgePlugin");
        mNsdHelper = new TvNsdHelper(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        cleanup();
        super.handleOnDestroy();
    }

    private synchronized void cleanup() {
        if (mNsdHelper != null) {
            mNsdHelper.unregisterTvService();
            mNsdHelper.stopDiscovery();
        }
        if (mServer != null) {
            mServer.stop();
            mServer = null;
        }
    }

    // -------------------------------------------------------------
    // TV HOST METHODS (تشغيل التلفاز كخادم محلي حقيقي)
    // -------------------------------------------------------------
    @PluginMethod
    public void startTvHost(PluginCall call) {
        String tvName = call.getString("tvName", "شاشة التلفاز الرئيسية");
        String pin = call.getString("pin", "");
        if (pin.isEmpty()) {
            pin = String.valueOf((int) (1000 + Math.random() * 9000));
        }
        int requestedPort = call.getInt("port", DEFAULT_PORT);

        mCurrentTvName = tvName;
        mCurrentPin = pin;

        Log.i(TAG, "Starting TV Host: " + tvName + " with PIN: " + pin + " on port " + requestedPort);

        try {
            // Stop previous server if running
            if (mServer != null) {
                mServer.stop();
                mServer = null;
            }

            final String activePin = pin;
            final String activeTvName = tvName;

            mServer = new TvWebSocketServer(requestedPort, new TvWebSocketServer.Listener() {
                @Override
                public void onServerStarted(int port) {
                    Log.i(TAG, "WebSocket Server successfully started on port " + port);
                }

                @Override
                public void onClientConnected(TvWebSocketServer.ClientConnection client) {
                    Log.i(TAG, "New incoming client connected from " + client.getId());
                }

                @Override
                public void onClientDisconnected(TvWebSocketServer.ClientConnection client) {
                    Log.i(TAG, "Client disconnected: " + client.getId() + " (" + client.getClientName() + ")");
                    JSObject data = new JSObject();
                    data.put("controllerName", client.getClientName());
                    data.put("id", client.getId());
                    notifyListeners("controllerLeft", data);
                }

                @Override
                public void onMessageReceived(TvWebSocketServer.ClientConnection client, String message) {
                    try {
                        JSONObject json = new JSONObject(message);
                        String type = json.optString("type");

                        // 1. Controller requests connection
                        if ("connect_controller".equals(type)) {
                            String controllerName = json.optString("controllerName", "يد تحكم الجوال");
                            client.setRole("controller");
                            client.setClientName(controllerName);

                            // Send handshake confirmation to phone controller
                            JSONObject ack = new JSONObject();
                            ack.put("type", "controller_connected");
                            ack.put("code", activePin);
                            ack.put("tvName", activeTvName);
                            client.sendMessage(ack.toString());

                            // Notify TV Web layer: Controller joined!
                            JSObject data = new JSObject();
                            data.put("controllerName", controllerName);
                            data.put("id", client.getId());
                            notifyListeners("controllerJoined", data);

                            // Also trigger direct event in WebView
                            deliverEventToTv("controller_joined", data);
                        }
                        // 2. Controller sends live inputs (Steering, Gas, Brake, Camera)
                        else if ("controller_input".equals(type)) {
                            JSONObject command = json.optJSONObject("command");
                            if (command != null) {
                                // Fast-track: Deliver directly to window.onTvControllerInput (<2ms)
                                deliverCommandToTv(command.toString());

                                JSObject payload = new JSObject();
                                payload.put("command", JSObject.fromJSONObject(command));
                                notifyListeners("controllerCommand", payload);
                            }
                        }
                        // 3. Controller disconnected explicitly
                        else if ("controller_disconnected".equals(type)) {
                            client.close();
                        }
                        // 4. Ping/Pong
                        else if ("ping".equals(type)) {
                            JSONObject pong = new JSONObject();
                            pong.put("type", "pong");
                            client.sendMessage(pong.toString());
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error handling message from client " + client.getId(), e);
                    }
                }

                @Override
                public void onServerError(Exception e) {
                    Log.e(TAG, "WebSocket server error", e);
                }
            });

            mServer.start();
            int actualPort = mServer.getPort();
            String localIp = getLocalIpAddress();

            // Advertise TV on Wi-Fi via Android NSD
            mNsdHelper.registerTvService(tvName, pin, actualPort, new TvNsdHelper.RegistrationListener() {
                @Override
                public void onServiceRegistered(String serviceName, int port) {
                    Log.i(TAG, "TV NSD registration confirmed: " + serviceName);
                }

                @Override
                public void onRegistrationFailed(int errorCode) {
                    Log.w(TAG, "TV NSD registration failed code=" + errorCode);
                }
            });

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("port", actualPort);
            ret.put("ip", localIp);
            ret.put("tvName", tvName);
            ret.put("pin", pin);
            ret.put("wsUrl", "ws://" + localIp + ":" + actualPort);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start TV host", e);
            call.reject("Failed to start TV host: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopTvHost(PluginCall call) {
        try {
            if (mServer != null) {
                // Inform clients TV is closed
                JSONObject closedMsg = new JSONObject();
                closedMsg.put("type", "tv_disconnected");
                closedMsg.put("message", "تم إغلاق لعبة التلفزيون");
                mServer.broadcast(closedMsg.toString());

                mServer.stop();
                mServer = null;
            }
            if (mNsdHelper != null) {
                mNsdHelper.unregisterTvService();
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error stopping TV host: " + e.getMessage());
        }
    }

    // -------------------------------------------------------------
    // CONTROLLER METHODS (بحث الهاتف عن التلفاز عبر NSD)
    // -------------------------------------------------------------
    @PluginMethod
    public void startDiscovery(PluginCall call) {
        Log.i(TAG, "Starting NSD Discovery for TV hosts");
        try {
            mNsdHelper.startDiscovery(new TvNsdHelper.DiscoveryListener() {
                @Override
                public void onTvDiscovered(String id, String name, String ip, int port, String pin) {
                    JSObject ret = new JSObject();
                    ret.put("id", id);
                    ret.put("name", name);
                    ret.put("ip", ip);
                    ret.put("port", port);
                    ret.put("pin", pin);
                    ret.put("wsUrl", "ws://" + ip + ":" + port);

                    notifyListeners("tvDiscovered", ret);
                }

                @Override
                public void onTvLost(String id) {
                    JSObject ret = new JSObject();
                    ret.put("id", id);
                    notifyListeners("tvLost", ret);
                }
            });

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to start discovery: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        try {
            if (mNsdHelper != null) {
                mNsdHelper.stopDiscovery();
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to stop discovery: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getLocalIp(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ip", getLocalIpAddress());
        call.resolve(ret);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("platform", "android");
        call.resolve(ret);
    }

    // -------------------------------------------------------------
    // HELPERS & DIRECT JAVASCRIPT DISPATCH
    // -------------------------------------------------------------
    private void deliverCommandToTv(String commandJson) {
        if (getActivity() != null && getBridge() != null && getBridge().getWebView() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    String script = "if (window.onTvControllerInput) { window.onTvControllerInput(" + commandJson + "); }";
                    getBridge().getWebView().evaluateJavascript(script, null);
                } catch (Exception e) {
                    Log.w(TAG, "Error executing onTvControllerInput", e);
                }
            });
        }
    }

    private void deliverEventToTv(String eventType, JSObject data) {
        if (getActivity() != null && getBridge() != null && getBridge().getWebView() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    String script = "window.dispatchEvent(new CustomEvent('sunset_tv_native_event', { detail: { type: '" + eventType + "', data: " + data.toString() + " } }));";
                    getBridge().getWebView().evaluateJavascript(script, null);
                } catch (Exception e) {
                    Log.w(TAG, "Error executing deliverEventToTv", e);
                }
            });
        }
    }

    private String getLocalIpAddress() {
        try {
            // 1. Try WifiManager
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null && wm.getConnectionInfo() != null) {
                int ipInt = wm.getConnectionInfo().getIpAddress();
                if (ipInt != 0) {
                    return Formatter.formatIpAddress(ipInt);
                }
            }

            // 2. Try NetworkInterface
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                        String sAddr = addr.getHostAddress();
                        if (sAddr != null && !sAddr.isEmpty()) {
                            return sAddr;
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error resolving local IP", e);
        }
        return "127.0.0.1";
    }
}
