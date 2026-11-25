import assert from 'node:assert/strict';
import test from 'node:test';
import {hasPhoneSignIn, verifyPasswordForPhoneUser} from '../public/assets/password-verification.js';

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
