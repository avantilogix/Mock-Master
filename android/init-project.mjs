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
manifest.appVersionCode = 4;
manifest.appVersionName = '4';
manifest.display = 'standalone';
manifest.orientation = 'default';
manifest.minSdkVersion = 24;
manifest.signingKey = { path: keystore, alias: process.env.MISSION_SELECTION_ALIAS || 'missionselection' };
manifest.generatorApp = 'bubblewrap-cli';

const manifestPath = resolve(target, 'twa-manifest.json');
await manifest.saveToFile(manifestPath);
await new TwaGenerator().createTwaProject(target, manifest, new ConsoleLog('Generating Android project'));
const launcher = resolve(target, 'app/src/main/java/com/avantilogix/missionselection/LauncherActivity.java');
const source = await readFile(launcher, 'utf8');
await writeFile(launcher, source
  .replace('import android.os.Bundle;', 'import android.os.Bundle;\nimport android.view.WindowManager;')
  .replace('super.onCreate(savedInstanceState);', `super.onCreate(savedInstanceState);\n        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,\n                WindowManager.LayoutParams.FLAG_SECURE);`));
const checksum = createHash('sha1').update(await readFile(manifestPath)).digest('hex');
await writeFile(resolve(target, 'manifest-checksum.txt'), checksum);
console.log(`Generated Mission Selection Android project for ${manifest.packageId}.`);
