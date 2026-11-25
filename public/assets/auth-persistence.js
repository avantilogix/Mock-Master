export async function restoreCompletedSession(sdk, auth) {
  await sdk.setPersistence(auth, sdk.browserLocalPersistence);
}

export async function beginTemporaryPhoneSession(sdk, auth) {
  await sdk.setPersistence(auth, sdk.inMemoryPersistence);
}

export async function persistCompletedPhoneSession(sdk, auth, user) {
  if (auth.currentUser !== user) throw new Error('Your sign-in changed. Please sign in again.');
  await sdk.setPersistence(auth, sdk.browserLocalPersistence);
}
