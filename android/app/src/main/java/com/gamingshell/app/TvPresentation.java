package com.gamingshell.app;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Point;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;

/**
 * Android Presentation displayed on a real secondary/external display.
 * Renders the dedicated TV interface belonging to the same application.
 */
public class TvPresentation extends Presentation {
    private static final String TAG = "TvPresentation";
    private final Display mDisplay;
    private WebView mWebView;
    private final Handler mMainHandler = new Handler(Looper.getMainLooper());

    public TvPresentation(Context outerContext, Display display) {
        super(outerContext, display);
        this.mDisplay = display;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(TAG, "Creating TvPresentation for display: " + mDisplay.getName() + " (ID: " + mDisplay.getDisplayId() + ")");

        Window window = getWindow();
        if (window != null) {
            window.requestFeature(Window.FEATURE_NO_TITLE);
            window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        FrameLayout rootLayout = new FrameLayout(getContext());
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        rootLayout.setBackgroundColor(0xFF0F172A); // Dark slate background

        mWebView = new WebView(getContext());
        mWebView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        mWebView.setBackgroundColor(0xFF0F172A);

        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        mWebView.setWebChromeClient(new WebChromeClient());
        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    Uri url = request.getUrl();
                    String path = url.getPath();
                    if (path == null || path.isEmpty() || path.equals("/")) {
                        path = "/index.html";
                    }
                    try {
                        String assetPath = "public" + (path.startsWith("/") ? path : "/" + path);
                        InputStream is = getContext().getAssets().open(assetPath);
                        String mimeType = "text/html";
                        if (path.endsWith(".js") || path.endsWith(".mjs")) mimeType = "application/javascript";
                        else if (path.endsWith(".css")) mimeType = "text/css";
                        else if (path.endsWith(".svg")) mimeType = "image/svg+xml";
                        else if (path.endsWith(".png")) mimeType = "image/png";
                        else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) mimeType = "image/jpeg";
                        else if (path.endsWith(".json")) mimeType = "application/json";
                        else if (path.endsWith(".woff2")) mimeType = "font/woff2";
                        else if (path.endsWith(".woff")) mimeType = "font/woff";
                        else if (path.endsWith(".ttf")) mimeType = "font/ttf";
                        return new WebResourceResponse(mimeType, "UTF-8", is);
                    } catch (Exception e) {
                        try {
                            InputStream is = getContext().getAssets().open("public/index.html");
                            return new WebResourceResponse("text/html", "UTF-8", is);
                        } catch (Exception ex) {
                            Log.e(TAG, "Failed to load index.html fallback for: " + url, ex);
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                Log.e(TAG, "TvPresentation WebView error: " + error.toString());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(TAG, "TvPresentation loaded TV interface at: " + url);
                dispatchDisplayInfo();
            }
        });

        mWebView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String getDisplayInfo() {
                return getDisplayJsonObject().toString();
            }

            @JavascriptInterface
            public void onTvReady() {
                Log.i(TAG, "TV Presentation UI notified ready via JS bridge");
                dispatchDisplayInfo();
            }
        }, "TvNativeBridge");

        rootLayout.addView(mWebView);
        setContentView(rootLayout);

        // Load the TV presentation interface of the application
        // Capacitor 7/8 serves local assets at https://localhost/ with androidScheme https
        String tvUrl = "https://localhost/?mode=tv";
        mWebView.loadUrl(tvUrl);
    }

    public JSONObject getDisplayJsonObject() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("displayId", mDisplay.getDisplayId());
            obj.put("name", mDisplay.getName());
            obj.put("flags", mDisplay.getFlags());
            obj.put("state", mDisplay.getState());
            obj.put("refreshRate", mDisplay.getRefreshRate());

            Point size = new Point();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                mDisplay.getRealSize(size);
            } else {
                mDisplay.getSize(size);
            }
            obj.put("width", size.x);
            obj.put("height", size.y);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to serialize Display object", e);
        }
        return obj;
    }

    public void dispatchDisplayInfo() {
        mMainHandler.post(() -> {
            if (mWebView != null) {
                String script = "if (window.onTvDisplayUpdated) { window.onTvDisplayUpdated(" + getDisplayJsonObject().toString() + "); }";
                mWebView.evaluateJavascript(script, null);
            }
        });
    }

    public void sendControllerCommand(String commandJson) {
        mMainHandler.post(() -> {
            if (mWebView != null) {
                String script = "if (window.onTvControllerInput) { window.onTvControllerInput(" + commandJson + "); }";
                mWebView.evaluateJavascript(script, null);
            }
        });
    }

    @Override
    public void dismiss() {
        Log.i(TAG, "Dismissing TvPresentation for display: " + mDisplay.getName());
        mMainHandler.post(() -> {
            if (mWebView != null) {
                mWebView.stopLoading();
                mWebView.destroy();
                mWebView = null;
            }
        });
        super.dismiss();
    }
}
