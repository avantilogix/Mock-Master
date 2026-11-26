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

async function requirePhoneSession(auth, user) {
  if (auth.currentUser !== user || !await hasPhoneSignIn(user) || auth.currentUser !== user) {
    throw Object.assign(new Error('Phone verification is required before changing your password.'), {
      code: 'auth/requires-recent-login',
    });
  }
}

export async function resetPasswordForPhoneUser(sdk, auth, user, newPassword) {
  await requirePhoneSession(auth, user);
  await sdk.updatePassword(user, newPassword);
}

export async function changePasswordForPhoneUser(sdk, auth, passwordAuth, user, currentPassword, newPassword) {
  await requirePhoneSession(auth, user);
  const result = await sdk.signInWithEmailAndPassword(passwordAuth, user.email, currentPassword);
  try {
    if (result.user.uid !== user.uid) {
      throw Object.assign(new Error('The password account does not match the verified phone account.'), {
        code: 'auth/user-mismatch',
      });
    }
    if (auth.currentUser !== user) {
      throw Object.assign(new Error('Your sign-in changed. Please sign in again.'), {
        code: 'auth/requires-recent-login',
      });
    }
    await sdk.updatePassword(result.user, newPassword);
  } finally {
    await sdk.signOut(passwordAuth);
  }
}
