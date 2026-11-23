import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.js';
import { dummyVerifier, firebaseVerifier } from './auth.js';
import { openDatabase } from './database.js';

process.umask(0o077);
const env = process.env;
const directory = env.DATA_DIR || './data';
const port = Number(env.PORT || 3000);
const host = env.HOST || '127.0.0.1';
const dummyLogin = process.argv.includes('--dummy-login');
const dummyAdmin = 'dummy-919999999999';
if (dummyLogin && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('Dummy sign-in is only allowed when HOST is 127.0.0.1, localhost, or ::1.');
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
const app = createApp({
  db: openDatabase(join(directory, 'mock-master.sqlite')),
  verifyToken: dummyLogin ? dummyVerifier : firebaseVerifier(env.FIREBASE_PROJECT_ID),
  dummyLogin,
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID,
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
  },
  adminUids: [...(env.ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean),
    ...(dummyLogin ? [dummyAdmin] : [])],
  adminPhones: (env.ADMIN_PHONES || '').split(',').map(value => value.trim()).filter(Boolean),
  trustLocalProxy: env.TRUST_LOCAL_PROXY === 'true',
  manualPayment: { upiId: env.UPI_ID, payeeName: env.UPI_PAYEE_NAME },
  videoDir: join(directory, 'videos'),
});
app.listen(port, host, () => {
  console.log(`Mission Selection listening on ${host}:${port}`);
  if (dummyLogin) console.log('Dummy sign-in enabled: any mobile number, OTP 123456. Admin: 99999 99999.');
});
