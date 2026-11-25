import assert from 'node:assert/strict';
import test from 'node:test';
import {beginTemporaryPhoneSession, persistCompletedPhoneSession, restoreCompletedSession}
  from '../public/assets/auth-persistence.js';

function firebaseFixture() {
  let savedUser = null;
  const sdk = {
    browserLocalPersistence: 'local',
    inMemoryPersistence: 'memory',
    async setPersistence(auth, persistence) {
      if (persistence === 'local') {
        if (auth.persistence === 'memory') savedUser = auth.currentUser;
        else auth.currentUser = savedUser;
      } else {
        savedUser = null;
      }
      auth.persistence = persistence;
    },
    async signOut(auth) {
      auth.currentUser = null;
      if (auth.persistence === 'local') savedUser = null;
    },
  };
  return {
    sdk,
    open: () => ({currentUser: null, persistence: null}),
    phoneSignIn(auth, user) {
      auth.currentUser = user;
      if (auth.persistence === 'local') savedUser = user;
    },
  };
}

test('completed sign-in survives reopening, and explicit sign-out clears it', async () => {
  const fixture = firebaseFixture();
  const {sdk} = fixture;
  const first = fixture.open();
  const user = {uid: 'verified-user'};
  await restoreCompletedSession(sdk, first);
  await beginTemporaryPhoneSession(sdk, first);
  fixture.phoneSignIn(first, user);
  await persistCompletedPhoneSession(sdk, first, user);

  const reopened = fixture.open();
  await restoreCompletedSession(sdk, reopened);
  assert.equal(reopened.currentUser, user);
  await sdk.signOut(reopened);
  const afterSignOut = fixture.open();
  await restoreCompletedSession(sdk, afterSignOut);
  assert.equal(afterSignOut.currentUser, null);
});

test('closing after OTP but before password completion does not restore the account', async () => {
  const fixture = firebaseFixture();
  const first = fixture.open();
  await restoreCompletedSession(fixture.sdk, first);
  await beginTemporaryPhoneSession(fixture.sdk, first);
  fixture.phoneSignIn(first, {uid: 'otp-only'});
  const reopened = fixture.open();
  await restoreCompletedSession(fixture.sdk, reopened);
  assert.equal(reopened.currentUser, null);
});

test('a different current account cannot be persisted as the completed sign-in', async () => {
  const fixture = firebaseFixture();
  const auth = fixture.open();
  await beginTemporaryPhoneSession(fixture.sdk, auth);
  fixture.phoneSignIn(auth, {uid: 'other'});
  await assert.rejects(persistCompletedPhoneSession(fixture.sdk, auth, {uid: 'verified-user'}),
    /sign-in changed/i);
  const reopened = fixture.open();
  await restoreCompletedSession(fixture.sdk, reopened);
  assert.equal(reopened.currentUser, null);
});

test('a storage failure is propagated instead of completing sign-in', async () => {
  const user = {uid: 'verified-user'};
  const auth = {currentUser: user};
  const sdk = {
    browserLocalPersistence: 'local',
    async setPersistence() { throw new Error('Storage unavailable'); },
  };
  await assert.rejects(persistCompletedPhoneSession(sdk, auth, user), /Storage unavailable/);
  await assert.rejects(restoreCompletedSession(sdk, auth), /Storage unavailable/);
});
