import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {changePasswordForPhoneUser, hasPhoneSignIn, resetPasswordForPhoneUser, verifyPasswordForPhoneUser}
  from '../public/assets/password-verification.js';

test('password verification keeps the phone session and clears the separate password session', async () => {
  const phoneUser = {uid: 'phone-user', token: 'phone-token'};
  const passwordAuth = {};
  const calls = [];
  const sdk = {
    async signInWithEmailAndPassword(auth, email, password) {
      calls.push(['signIn', auth, email, password]);
      return {user: {uid: 'phone-user'}};
    },
    async signOut(auth) { calls.push(['signOut', auth]); },
  };
  await verifyPasswordForPhoneUser(sdk, passwordAuth, phoneUser, 'user@example.invalid', 'password');
  assert.deepEqual(calls, [
    ['signIn', passwordAuth, 'user@example.invalid', 'password'],
    ['signOut', passwordAuth],
  ]);
  assert.equal(phoneUser.token, 'phone-token');
});

test('password verification rejects a different user and clears the password session', async () => {
  let signedOut = false;
  const sdk = {
    async signInWithEmailAndPassword() { return {user: {uid: 'other'}}; },
    async signOut() { signedOut = true; },
  };
  await assert.rejects(verifyPasswordForPhoneUser(sdk, {}, {uid: 'phone-user'}, 'user@example.invalid', 'password'),
    {code: 'auth/user-mismatch'});
  assert.equal(signedOut, true);
});

test('incorrect password does not complete verification', async () => {
  const sdk = {
    async signInWithEmailAndPassword() { throw Object.assign(new Error('Invalid credentials'), {code: 'auth/invalid-credential'}); },
    async signOut() { assert.fail('No password session was created'); },
  };
  await assert.rejects(verifyPasswordForPhoneUser(sdk, {}, {uid: 'phone-user'}, 'user@example.invalid', 'wrong'),
    {code: 'auth/invalid-credential'});
});

test('only a phone sign-in token can complete account setup', async () => {
  const user = provider => ({async getIdTokenResult() { return {signInProvider: provider}; }});
  assert.equal(await hasPhoneSignIn(user('phone')), true);
  assert.equal(await hasPhoneSignIn(user('password')), false);
  assert.equal(await hasPhoneSignIn(user(undefined)), false);
});

function passwordFixture() {
  const hash = password => createHash('sha256').update(password).digest('hex');
  const records = new Map([['student@accounts.invalid', {uid: 'student', passwordHash: hash('old-password')}]]);
  const user = {uid: 'student', email: 'student@accounts.invalid', async getIdTokenResult() {
    return {signInProvider: 'phone'};
  }};
  const auth = {currentUser: user};
  const passwordAuth = {currentUser: null};
  const sdk = {
    async signInWithEmailAndPassword(session, email, password) {
      const record = records.get(email);
      if (!record || record.passwordHash !== hash(password)) {
        throw Object.assign(new Error('Invalid credentials'), {code: 'auth/invalid-credential'});
      }
      session.currentUser = {uid: record.uid, email, recent: true};
      return {user: session.currentUser};
    },
    async updatePassword(account, password) {
      if (!account.recent) throw Object.assign(new Error('Login is stale'), {code: 'auth/requires-recent-login'});
      records.get(account.email).passwordHash = hash(password);
    },
    async signOut(session) { session.currentUser = null; },
  };
  return {sdk, auth, passwordAuth, user, records};
}

test('profile change uses freshly verified password account and updates its Firebase credential', async () => {
  const {sdk, auth, passwordAuth, user} = passwordFixture();
  await changePasswordForPhoneUser(sdk, auth, passwordAuth, user, 'old-password', 'new-password');
  assert.equal(auth.currentUser, user);
  assert.equal(passwordAuth.currentUser, null);
  await assert.rejects(sdk.signInWithEmailAndPassword(passwordAuth, user.email, 'old-password'),
    {code: 'auth/invalid-credential'});
  const result = await sdk.signInWithEmailAndPassword(passwordAuth, user.email, 'new-password');
  assert.equal(result.user.uid, user.uid);
});

test('profile change rejects wrong or mismatched credentials without updating the account', async () => {
  const {sdk, auth, passwordAuth, user, records} = passwordFixture();
  await assert.rejects(changePasswordForPhoneUser(sdk, auth, passwordAuth, user, 'wrong-password', 'new-password'),
    {code: 'auth/invalid-credential'});
  records.get(user.email).uid = 'different-user';
  await assert.rejects(changePasswordForPhoneUser(sdk, auth, passwordAuth, user, 'old-password', 'new-password'),
    {code: 'auth/user-mismatch'});
  assert.equal(passwordAuth.currentUser, null);
  await sdk.signInWithEmailAndPassword(passwordAuth, user.email, 'old-password');
});

test('profile change clears temporary session if Firebase rejects the update', async () => {
  const {sdk, auth, passwordAuth, user} = passwordFixture();
  sdk.updatePassword = async () => { throw Object.assign(new Error('Weak'), {code: 'auth/weak-password'}); };
  await assert.rejects(changePasswordForPhoneUser(sdk, auth, passwordAuth, user, 'old-password', 'new-password'),
    {code: 'auth/weak-password'});
  assert.equal(passwordAuth.currentUser, null);
  assert.equal(auth.currentUser, user);
});

test('phone-verified login reset updates the same credential and rejects the old password', async () => {
  const {sdk, auth, passwordAuth, user} = passwordFixture();
  user.recent = true;
  await resetPasswordForPhoneUser(sdk, auth, user, 'new-password');
  await assert.rejects(sdk.signInWithEmailAndPassword(passwordAuth, user.email, 'old-password'),
    {code: 'auth/invalid-credential'});
  assert.equal((await sdk.signInWithEmailAndPassword(passwordAuth, user.email, 'new-password')).user.uid, user.uid);
});

test('password changes require the current phone session and a recent login for reset', async () => {
  const {sdk, auth, passwordAuth, user} = passwordFixture();
  await assert.rejects(resetPasswordForPhoneUser(sdk, auth, user, 'new-password'),
    {code: 'auth/requires-recent-login'});
  user.recent = true;
  user.getIdTokenResult = async () => ({signInProvider: 'password'});
  await assert.rejects(resetPasswordForPhoneUser(sdk, auth, user, 'new-password'),
    {code: 'auth/requires-recent-login'});
  await assert.rejects(changePasswordForPhoneUser(sdk, auth, passwordAuth, user, 'old-password', 'new-password'),
    {code: 'auth/requires-recent-login'});
  user.getIdTokenResult = async () => ({signInProvider: 'phone'});
  auth.currentUser = {uid: 'another'};
  await assert.rejects(resetPasswordForPhoneUser(sdk, auth, user, 'new-password'),
    {code: 'auth/requires-recent-login'});
  await sdk.signInWithEmailAndPassword(passwordAuth, user.email, 'old-password');
});

test('profile change does not update if the phone account changes during password verification', async () => {
  const {sdk, auth, passwordAuth, user} = passwordFixture();
  const signIn = sdk.signInWithEmailAndPassword;
  sdk.signInWithEmailAndPassword = async (...args) => {
    const result = await signIn(...args);
    auth.currentUser = {uid: 'another'};
    return result;
  };
  await assert.rejects(changePasswordForPhoneUser(sdk, auth, passwordAuth, user, 'old-password', 'new-password'),
    {code: 'auth/requires-recent-login'});
  assert.equal(passwordAuth.currentUser, null);
  await signIn(passwordAuth, user.email, 'old-password');
});
