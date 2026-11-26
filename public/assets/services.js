import {restoreCompletedSession} from './auth-persistence.js';
import {connectionFailed} from './connection.js';

const firebaseBase = 'https://www.gstatic.com/firebasejs/11.10.0/';

export async function api(path, {ctx, auth = false, method = 'GET', json, binary, image = false, blob = false, imageUpload} = {}) {
  const signal = ctx?.signal;
  const check = () => {
    if (ctx && !ctx.current()) throw new DOMException('Request cancelled', 'AbortError');
  };
  check();
  const headers = new Headers();
  if (auth) {
    if (!ctx?.user) throw new Error('Sign in to continue.');
    let token;
    try {
      token = await ctx.user.getIdToken();
    } catch (error) {
      check();
      console.error('Could not verify the current session:', error);
      if (error.code === 'auth/network-request-failed' || !navigator.onLine) connectionFailed();
      throw new Error('Could not verify your account. Please check your connection and try again.');
    }
    headers.set('Authorization', 'Bearer ' + token);
    check();
  }
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  if (binary !== undefined) headers.set('Content-Type', imageUpload || 'application/octet-stream');
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers, signal, cache: 'no-store', redirect: 'error',
      body: json === undefined ? binary : JSON.stringify(json)
    });
  } catch (error) {
    check();
    if (error.name === 'AbortError') throw error;
    connectionFailed();
    throw new Error('Could not reach Mission Selection. Check your connection and try again.');
  }
  check();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    check();
    throw new Error(response.status === 401 ? 'Your session has expired. Sign in again to continue.' :
      response.status >= 500 ? 'Something went wrong. Please try again later.' :
      typeof body?.error === 'string' && body.error ? body.error : 'Could not complete the request. Please try again.');
  }
  if (image && !/^image\//i.test(response.headers.get('Content-Type') || '')) {
    throw new Error('The server did not return a book image.');
  }
  let body;
  try {
    body = image || blob ? await response.blob() : (response.status === 204 ? null :
      await response.text().then(text => text ? JSON.parse(text) : null));
  } catch (error) {
    check();
    if (error.name === 'AbortError') throw error;
    console.error('Could not read the response:', error);
    if (error.name === 'TypeError') connectionFailed();
    throw new Error('Could not complete the request. Please try again.');
  }
  check();
  return body;
}

export async function firebaseAuth() {
  const config = await api('/config');
  if (config.dummyLogin) return {...dummyAuth(), personalTimetable: config.personalTimetable};
  const [{initializeApp}, sdk] = await Promise.all([
    import(`${firebaseBase}firebase-app.js`),
    import(`${firebaseBase}firebase-auth.js`)
  ]);
  const auth = sdk.getAuth(initializeApp(config.firebase));
  const passwordAuth = sdk.getAuth(initializeApp(config.firebase, 'password-verification'));
  await restoreCompletedSession(sdk, auth);
  await sdk.setPersistence(passwordAuth, sdk.inMemoryPersistence);
  await sdk.signOut(passwordAuth);
  return {sdk, auth, passwordAuth, personalTimetable: config.personalTimetable,
    publishingMedia: config.publishingMedia === true};
}

// Local development only: the server enables this with `npm run start:dummy`.
function dummyAuth() {
  const key = 'mission-selection-dummy-phone';
  const listeners = new Set();
  const userFor = phone => ({uid: `dummy-${phone.slice(1)}`, phoneNumber: phone, getIdToken: async () => `dummy:${phone}`});
  const saved = localStorage.getItem(key);
  const auth = {dummy: true, currentUser: saved ? userFor(saved) : null};
  const update = user => {
    auth.currentUser = user;
    listeners.forEach(listener => listener(user));
  };
  const sdk = {
    onAuthStateChanged(_auth, listener) {
      listeners.add(listener);
      queueMicrotask(() => listener(auth.currentUser));
      return () => listeners.delete(listener);
    },
    async signOut() {
      localStorage.removeItem(key);
      update(null);
    },
    RecaptchaVerifier: class { clear() {} },
    async signInWithPhoneNumber(_auth, phone) {
      return {
        async confirm(code) {
          if (code !== '123456') throw Object.assign(new Error('Invalid code'), {code: 'auth/invalid-verification-code'});
          localStorage.setItem(key, phone);
          update(userFor(phone));
        }
      };
    }
  };
  return {sdk, auth};
}
