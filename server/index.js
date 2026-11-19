import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.js';
import { firebaseVerifier } from './auth.js';
import { openDatabase } from './database.js';

process.umask(0o077);
const env = process.env;
const directory = env.DATA_DIR || './data';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const app = createApp({
  db: openDatabase(join(directory, 'mock-master.sqlite')),
  verifyToken: firebaseVerifier(env.FIREBASE_PROJECT_ID),
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID,
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
  },
  adminUids: (env.ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean),
  trustLocalProxy: env.TRUST_LOCAL_PROXY === 'true',
  manualPayment: { upiId: env.UPI_ID, payeeName: env.UPI_PAYEE_NAME },
});
const port = Number(env.PORT || 3000);
const host = env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Mission Selection listening on ${host}:${port}`));
