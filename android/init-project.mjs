import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConsoleLog, TwaGenerator, TwaManifest } from '@bubblewrap/core';

const target = resolve('android/generated');
const keystore = process.env.MISSION_SELECTION_KEYSTORE_PATH;
if (!keystore) throw new Error('Set MISSION_SELECTION_KEYSTORE_PATH.');

await mkdir(target, { recursive: true });
const manifest = await TwaManifest.fromWebManifest('https://mission-selection-ba819.web.app/manifest.webmanifest');
manifest.host = 'mission-selection-ba819.web.app';
manifest.startUrl = '/';
manifest.name = 'Mission Selection';
manifest.launcherName = 'Mission';
manifest.packageId = 'com.avantilogix.missionselection';
manifest.appVersionCode = 17;
manifest.appVersionName = '17';
manifest.display = 'standalone';
manifest.orientation = 'default';
manifest.minSdkVersion = 24;
manifest.signingKey = { path: keystore, alias: process.env.MISSION_SELECTION_ALIAS || 'missionselection' };
manifest.generatorApp = 'bubblewrap-cli';

const manifestPath = resolve(target, 'twa-manifest.json');
await manifest.saveToFile(manifestPath);
await new TwaGenerator().createTwaProject(target, manifest, new ConsoleLog('Generating Android project'));
const launcher = resolve(target, 'app/src/main/java/com/avantilogix/missionselection/LauncherActivity.java');
await writeFile(launcher, `package com.avantilogix.missionselection;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.content.SharedPreferences;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.LinkedHashSet;
import java.util.Locale;

public class LauncherActivity extends Activity {
    private static final String HOST = "mission-selection-ba819.web.app";
    private static final String START_URL = "https://" + HOST + "/";
    private static final int CHOOSE_FILES = 2401;
    private WebView webView;
    private FrameLayout content;
    private View fullscreenVideo;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int previousOrientation;
    private int previousSystemUi;
    private boolean wasFullscreen;
    private OutputStream pendingDownload;
    private Uri pendingDownloadUri;
    private ValueCallback<Uri[]> pendingFiles;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE);
        webView = new WebView(this);
        SharedPreferences preferences = getSharedPreferences("mission_selection", MODE_PRIVATE);
        int cachedVersion = preferences.getInt("web_cache_version", 0);
        if (cachedVersion < 17) {
            webView.clearCache(true);
            webView.clearHistory();
            preferences.edit().putInt("web_cache_version", 17).apply();
        }
        webView.setLongClickable(false);
        webView.setOnLongClickListener(view -> true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams parameters) {
                finishFileSelection(null);
                pendingFiles = callback;
                LinkedHashSet<String> types = new LinkedHashSet<>();
                for (String accepted : parameters.getAcceptTypes()) {
                    for (String entry : accepted.split(",")) {
                        String type = entry.trim().toLowerCase(Locale.ROOT);
                        if (type.startsWith(".")) {
                            type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1));
                        }
                        if (type != null && type.contains("/")) types.add(type);
                    }
                }
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setType(types.size() == 1 ? types.iterator().next() : "*/*");
                if (types.size() > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                        parameters.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, CHOOSE_FILES);
                } catch (ActivityNotFoundException error) {
                    finishFileSelection(null);
                    Toast.makeText(LauncherActivity.this,
                            "No file picker is available. Enable the Files app and try again.",
                            Toast.LENGTH_LONG).show();
                }
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenVideo != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                previousOrientation = getRequestedOrientation();
                previousSystemUi = getWindow().getDecorView().getSystemUiVisibility();
                wasFullscreen = (getWindow().getAttributes().flags
                        & WindowManager.LayoutParams.FLAG_FULLSCREEN) != 0;
                fullscreenVideo = view;
                fullscreenCallback = callback;
                content.setBackgroundColor(Color.BLACK);
                content.addView(view, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                webView.setVisibility(View.GONE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override
            public void onHideCustomView() {
                hideFullscreenVideo();
            }
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " MissionSelectionSecureApp/17");
        webView.addJavascriptInterface(new DownloadBridge(), "MissionSelectionDownloads");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost()) && "https".equals(uri.getScheme())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        content = new FrameLayout(this);
        content.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(content);
        webView.loadUrl(START_URL);
    }

    private void finishFileSelection(Uri[] files) {
        ValueCallback<Uri[]> callback = pendingFiles;
        pendingFiles = null;
        if (callback != null) callback.onReceiveValue(files);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CHOOSE_FILES || pendingFiles == null) return;
        if (resultCode != RESULT_OK || data == null) {
            finishFileSelection(null);
            return;
        }
        Uri[] files;
        if (data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            files = new Uri[count];
            for (int index = 0; index < count; index++) {
                files[index] = data.getClipData().getItemAt(index).getUri();
            }
        } else {
            files = data.getData() == null ? null : new Uri[] { data.getData() };
        }
        if (files != null) {
            for (Uri file : files) {
                if (file == null || !"content".equals(file.getScheme())) {
                    finishFileSelection(null);
                    Toast.makeText(this, "Choose a file using the system Files picker.",
                            Toast.LENGTH_LONG).show();
                    return;
                }
            }
        }
        finishFileSelection(files);
    }

    private void hideFullscreenVideo() {
        if (fullscreenVideo == null) return;
        content.removeView(fullscreenVideo);
        fullscreenVideo = null;
        webView.setVisibility(View.VISIBLE);
        if (!wasFullscreen) getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(previousSystemUi);
        setRequestedOrientation(previousOrientation);
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        callback.onCustomViewHidden();
    }

    @Override
    protected void onResume() {
        super.onResume();
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE);
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (fullscreenVideo != null) hideFullscreenVideo();
        else if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        finishFileSelection(null);
        hideFullscreenVideo();
        webView.loadUrl("about:blank");
        webView.destroy();
        super.onDestroy();
    }

    private class DownloadBridge {
        @JavascriptInterface
        public boolean beginPdf(String filename) {
            try {
                finishPdf(false);
                pendingDownloadUri = null;
                OutputStream output = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Mission Selection");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    pendingDownloadUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (pendingDownloadUri == null) return false;
                    output = getContentResolver().openOutputStream(pendingDownloadUri);
                } else {
                    File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (directory == null || (!directory.exists() && !directory.mkdirs())) return false;
                    output = new FileOutputStream(new File(directory, filename));
                }
                if (output == null) return false;
                pendingDownload = output;
                return true;
            } catch (IOException ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean appendPdf(String base64) {
            if (pendingDownload == null) return false;
            try {
                pendingDownload.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (IOException ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean finishPdf(boolean commit) {
            try {
                if (pendingDownload != null) {
                    pendingDownload.flush();
                    pendingDownload.close();
                    pendingDownload = null;
                }
                if (pendingDownloadUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(pendingDownloadUri, values, null, null);
                    if (!commit) getContentResolver().delete(pendingDownloadUri, null, null);
                    pendingDownloadUri = null;
                }
                return true;
            } catch (IOException ignored) {
                pendingDownload = null;
                pendingDownloadUri = null;
                return false;
            }
        }
    }
}
`);
const androidManifest = resolve(target, 'app/src/main/AndroidManifest.xml');
const manifestSource = await readFile(androidManifest, 'utf8');
await writeFile(androidManifest, manifestSource
  .replace('<manifest xmlns:android=', '<manifest xmlns:android=')
  .replace('    <application', '    <uses-permission android:name="android.permission.INTERNET" />\n\n    <application')
  .replace('android:name="LauncherActivity"', 'android:name="LauncherActivity"\n            android:theme="@android:style/Theme.Material.Light.NoActionBar"')
  .replace(/<activity\b[^>]*android:name="LauncherActivity"[^>]*>/, activity => {
    const configChanges = /android:configChanges="([^"]*)"/;
    const existing = configChanges.exec(activity);
    const changes = [...new Set([...(existing?.[1].split('|') || []),
      'orientation', 'screenSize', 'smallestScreenSize', 'keyboardHidden'])].join('|');
    return existing ? activity.replace(configChanges, `android:configChanges="${changes}"`) :
      activity.replace('>', ` android:configChanges="${changes}">`);
  }));
const checksum = createHash('sha1').update(await readFile(manifestPath)).digest('hex');
await writeFile(resolve(target, 'manifest-checksum.txt'), checksum);
console.log(`Generated Mission Selection Android project for ${manifest.packageId}.`);
