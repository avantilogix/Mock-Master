import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

// Local development only: accepts "dummy:+91XXXXXXXXXX" tokens instead of Firebase phone OTP.
export async function dummyVerifier(token) {
  const match = /^dummy:(\+91[6-9]\d{9})$/.exec(token);
  if (!match) throw new Error('Invalid dummy sign-in token.');
  return { uid: `dummy-${match[1].slice(1)}`, phone: match[1] };
}

export function firebaseVerifier(projectId) {
  return async token => {
    if (!projectId) throw Object.assign(new Error('Phone sign-in is not configured.'), { status: 503 });
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      requiredClaims: ['sub', 'iat', 'exp', 'auth_time'],
    });
    if (payload.firebase?.sign_in_provider !== 'phone' || typeof payload.auth_time !== 'number' ||
        payload.auth_time > Date.now() / 1000) throw new Error('Expected phone sign-in.');
    return { uid: payload.sub, phone: payload.phone_number };
  };
}
