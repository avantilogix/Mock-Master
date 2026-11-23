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
manifest.appVersionCode = 5;
manifest.appVersionName = '5';
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
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

public class LauncherActivity extends Activity {
    private static final String HOST = "mission-selection-ba819.web.app";
    private static final String START_URL = "https://" + HOST + "/";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE);
        webView = new WebView(this);
        webView.setLongClickable(false);
        webView.setOnLongClickListener(view -> true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " MissionSelectionSecureApp/5");
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
        setContentView(webView);
        webView.loadUrl(START_URL);
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
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        webView.loadUrl("about:blank");
        webView.destroy();
        super.onDestroy();
    }

    private class DownloadBridge {
        @JavascriptInterface
        public boolean savePdf(String filename, String base64) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            try {
                OutputStream output = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Mission Selection");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return false;
                    output = getContentResolver().openOutputStream(uri);
                } else {
                    File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (directory == null || (!directory.exists() && !directory.mkdirs())) return false;
                    output = new FileOutputStream(new File(directory, filename));
                }
                if (output == null) return false;
                try (OutputStream stream = output) {
                    stream.write(bytes);
                }
                return true;
            } catch (IOException ignored) {
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
  .replace('android:name="LauncherActivity"', 'android:name="LauncherActivity"\n            android:theme="@android:style/Theme.Material.Light.NoActionBar"'));
const checksum = createHash('sha1').update(await readFile(manifestPath)).digest('hex');
await writeFile(resolve(target, 'manifest-checksum.txt'), checksum);
console.log(`Generated Mission Selection Android project for ${manifest.packageId}.`);
