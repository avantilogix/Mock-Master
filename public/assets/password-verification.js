export async function verifyPasswordForPhoneUser(sdk, passwordAuth, user, email, password) {
  const result = await sdk.signInWithEmailAndPassword(passwordAuth, email, password);
  try {
    if (result.user.uid !== user.uid) {
      throw Object.assign(new Error('The password account does not match the verified phone account.'), {
        code: 'auth/user-mismatch',
      });
    }
  } finally {
    await sdk.signOut(passwordAuth);
  }
}

export async function hasPhoneSignIn(user) {
  const token = await user.getIdTokenResult();
  return token.signInProvider === 'phone';
}
