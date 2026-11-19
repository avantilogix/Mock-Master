import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

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
