package com.gamingshell.app;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lightweight, high-performance RFC 6455 WebSocket Server in pure Java.
 * Runs directly on Android without any external libraries or Gradle dependencies.
 */
public class TvWebSocketServer {
    private static final String TAG = "TvWebSocketServer";
    private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    public interface Listener {
        void onServerStarted(int port);
        void onClientConnected(ClientConnection client);
        void onClientDisconnected(ClientConnection client);
        void onMessageReceived(ClientConnection client, String message);
        void onServerError(Exception e);
    }

    private final int mPort;
    private final Listener mListener;
    private ServerSocket mServerSocket;
    private volatile boolean mRunning = false;
    private ExecutorService mThreadPool;
    private final ConcurrentHashMap<String, ClientConnection> mClients = new ConcurrentHashMap<>();

    public TvWebSocketServer(int port, Listener listener) {
        this.mPort = port;
        this.mListener = listener;
    }

    public synchronized void start() throws Exception {
        if (mRunning) return;

        mServerSocket = new ServerSocket();
        mServerSocket.setReuseAddress(true);
        mServerSocket.bind(new InetSocketAddress("0.0.0.0", mPort));
        mRunning = true;
        mThreadPool = Executors.newCachedThreadPool();

        Log.i(TAG, "TV Local WebSocket Server bound to 0.0.0.0:" + mServerSocket.getLocalPort());

        if (mListener != null) {
            mListener.onServerStarted(mServerSocket.getLocalPort());
        }

        mThreadPool.execute(this::acceptLoop);
    }

    public synchronized void stop() {
        mRunning = false;
        try {
            if (mServerSocket != null && !mServerSocket.isClosed()) {
                mServerSocket.close();
            }
        } catch (Exception e) {
            Log.w(TAG, "Error closing server socket", e);
        }

        for (ClientConnection client : mClients.values()) {
            client.close();
        }
        mClients.clear();

        if (mThreadPool != null && !mThreadPool.isShutdown()) {
            mThreadPool.shutdownNow();
        }
        Log.i(TAG, "TV Local WebSocket Server stopped");
    }

    public int getPort() {
        if (mServerSocket != null && !mServerSocket.isClosed()) {
            return mServerSocket.getLocalPort();
        }
        return mPort;
    }

    public boolean isRunning() {
        return mRunning;
    }

    private void acceptLoop() {
        while (mRunning && mServerSocket != null && !mServerSocket.isClosed()) {
            try {
                Socket socket = mServerSocket.accept();
                socket.setTcpNoDelay(true); // Disable Nagle's algorithm for instant game input delivery (<2ms)
                socket.setKeepAlive(true);

                ClientConnection client = new ClientConnection(socket);
                mClients.put(client.getId(), client);
                mThreadPool.execute(client);
            } catch (SocketException se) {
                if (!mRunning) break; // Expected when server stops
                Log.w(TAG, "Socket exception in accept loop", se);
            } catch (Exception e) {
                if (!mRunning) break;
                Log.e(TAG, "Error accepting client connection", e);
            }
        }
    }

    public void broadcast(String message) {
        for (ClientConnection client : mClients.values()) {
            client.sendMessage(message);
        }
    }

    public void broadcastExcept(ClientConnection exclude, String message) {
        for (ClientConnection client : mClients.values()) {
            if (client != exclude) {
                client.sendMessage(message);
            }
        }
    }

    public List<ClientConnection> getClients() {
        return new ArrayList<>(mClients.values());
    }

    /**
     * Handles an individual WebSocket client connection.
     */
    public class ClientConnection implements Runnable {
        private final Socket mSocket;
        private final String mId;
        private InputStream mIn;
        private OutputStream mOut;
        private volatile boolean mHandshakeDone = false;
        private volatile boolean mClosed = false;
        private String mRole = "unknown";
        private String mClientName = "";

        public ClientConnection(Socket socket) {
            this.mSocket = socket;
            this.mId = socket.getInetAddress().getHostAddress() + ":" + socket.getPort();
        }

        public String getId() {
            return mId;
        }

        public String getRole() {
            return mRole;
        }

        public void setRole(String role) {
            this.mRole = role;
        }

        public String getClientName() {
            return mClientName;
        }

        public void setClientName(String name) {
            this.mClientName = name;
        }

        public String getRemoteAddress() {
            return mSocket.getInetAddress().getHostAddress();
        }

        @Override
        public void run() {
            try {
                mIn = mSocket.getInputStream();
                mOut = mSocket.getOutputStream();

                // 1. Perform HTTP Upgrade to WebSocket Handshake (RFC 6455)
                if (!performHandshake()) {
                    Log.w(TAG, "Handshake failed for client " + mId);
                    close();
                    return;
                }

                mHandshakeDone = true;
                Log.i(TAG, "WebSocket Handshake completed successfully with " + mId);

                if (mListener != null) {
                    mListener.onClientConnected(this);
                }

                // 2. Read WebSocket Frames Loop
                while (mRunning && !mClosed && !mSocket.isClosed()) {
                    int b0 = mIn.read();
                    if (b0 == -1) break; // Client disconnected

                    boolean fin = (b0 & 0x80) != 0;
                    int opcode = b0 & 0x0F;

                    int b1 = mIn.read();
                    if (b1 == -1) break;

                    boolean masked = (b1 & 0x80) != 0;
                    long payloadLength = b1 & 0x7F;

                    if (payloadLength == 126) {
                        int byte1 = mIn.read();
                        int byte2 = mIn.read();
                        if (byte1 == -1 || byte2 == -1) break;
                        payloadLength = ((byte1 & 0xFF) << 8) | (byte2 & 0xFF);
                    } else if (payloadLength == 127) {
                        long len = 0;
                        for (int i = 0; i < 8; i++) {
                            int b = mIn.read();
                            if (b == -1) return;
                            len = (len << 8) | (b & 0xFF);
                        }
                        payloadLength = len;
                    }

                    byte[] mask = new byte[4];
                    if (masked) {
                        int readMask = 0;
                        while (readMask < 4) {
                            int r = mIn.read(mask, readMask, 4 - readMask);
                            if (r == -1) return;
                            readMask += r;
                        }
                    }

                    // Read payload
                    byte[] payload = new byte[(int) payloadLength];
                    int readBytes = 0;
                    while (readBytes < payloadLength) {
                        int r = mIn.read(payload, readBytes, (int) (payloadLength - readBytes));
                        if (r == -1) return;
                        readBytes += r;
                    }

                    // Unmask payload if masked (all client frames must be masked per RFC 6455)
                    if (masked) {
                        for (int i = 0; i < payload.length; i++) {
                            payload[i] = (byte) (payload[i] ^ mask[i % 4]);
                        }
                    }

                    // Handle opcodes
                    if (opcode == 0x8) {
                        // Close frame
                        sendClose();
                        break;
                    } else if (opcode == 0x9) {
                        // Ping frame -> reply with Pong
                        sendPong(payload);
                    } else if (opcode == 0xA) {
                        // Pong frame
                    } else if (opcode == 0x1) {
                        // Text frame
                        String text = new String(payload, StandardCharsets.UTF_8);
                        if (mListener != null) {
                            mListener.onMessageReceived(this, text);
                        }
                    }
                }
            } catch (SocketException se) {
                // Client connection reset or closed
            } catch (Exception e) {
                if (mRunning && !mClosed) {
                    Log.w(TAG, "Exception in client connection " + mId, e);
                }
            } finally {
                close();
            }
        }

        private boolean performHandshake() throws Exception {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int b;
            String request = "";

            // Read until CRLF CRLF
            while ((b = mIn.read()) != -1) {
                buffer.write(b);
                byte[] bytes = buffer.toByteArray();
                int len = bytes.length;
                if (len >= 4 && bytes[len - 4] == '\r' && bytes[len - 3] == '\n'
                        && bytes[len - 2] == '\r' && bytes[len - 1] == '\n') {
                    request = new String(bytes, StandardCharsets.UTF_8);
                    break;
                }
            }

            if (request.isEmpty()) return false;

            String secKey = null;
            String[] lines = request.split("\r\n");
            for (String line : lines) {
                if (line.toLowerCase().startsWith("sec-websocket-key:")) {
                    secKey = line.substring(line.indexOf(':') + 1).trim();
                    break;
                }
            }

            if (secKey == null) {
                return false;
            }

            // Calculate Sec-WebSocket-Accept
            String acceptSeed = secKey + WEBSOCKET_GUID;
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] hash = md.digest(acceptSeed.getBytes(StandardCharsets.UTF_8));
            String acceptKey = Base64.encodeToString(hash, Base64.NO_WRAP);

            String response = "HTTP/1.1 101 Switching Protocols\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Accept: " + acceptKey + "\r\n"
                    + "Access-Control-Allow-Origin: *\r\n\r\n";

            mOut.write(response.getBytes(StandardCharsets.UTF_8));
            mOut.flush();
            return true;
        }

        public synchronized void sendMessage(String text) {
            if (mClosed || mOut == null || !mHandshakeDone) return;
            try {
                byte[] payload = text.getBytes(StandardCharsets.UTF_8);
                ByteArrayOutputStream frame = new ByteArrayOutputStream();

                // Byte 0: FIN (1) + Opcode text (1) = 0x81
                frame.write(0x81);

                // Server-to-client frames are unmasked (mask bit = 0)
                int len = payload.length;
                if (len <= 125) {
                    frame.write(len);
                } else if (len <= 65535) {
                    frame.write(126);
                    frame.write((len >> 8) & 0xFF);
                    frame.write(len & 0xFF);
                } else {
                    frame.write(127);
                    for (int i = 7; i >= 0; i--) {
                        frame.write((int) ((len >> (i * 8)) & 0xFF));
                    }
                }

                frame.write(payload);
                mOut.write(frame.toByteArray());
                mOut.flush();
            } catch (Exception e) {
                Log.w(TAG, "Error sending WebSocket message to " + mId, e);
                close();
            }
        }

        private synchronized void sendPong(byte[] payload) {
            if (mClosed || mOut == null) return;
            try {
                ByteArrayOutputStream frame = new ByteArrayOutputStream();
                frame.write(0x8A); // FIN + Pong
                frame.write(payload.length & 0x7F);
                frame.write(payload);
                mOut.write(frame.toByteArray());
                mOut.flush();
            } catch (Exception ignored) {}
        }

        private synchronized void sendClose() {
            if (mClosed || mOut == null) return;
            try {
                mOut.write(new byte[]{(byte) 0x88, 0x00});
                mOut.flush();
            } catch (Exception ignored) {}
        }

        public synchronized void close() {
            if (mClosed) return;
            mClosed = true;
            mClients.remove(mId);

            try {
                if (mSocket != null && !mSocket.isClosed()) {
                    mSocket.close();
                }
            } catch (Exception ignored) {}

            if (mListener != null) {
                mListener.onClientDisconnected(this);
            }
        }
    }
}
