const firebaseBase = 'https://www.gstatic.com/firebasejs/11.10.0/';
const razorpayUrl = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutScript;

export async function api(path, {ctx, auth = false, method = 'GET', json, binary, image = false} = {}) {
  const signal = ctx?.signal;
  const check = () => {
    if (ctx && !ctx.current()) throw new DOMException('Request cancelled', 'AbortError');
  };
  check();
  const headers = new Headers();
  if (auth) {
    if (!ctx?.user) throw new Error('Sign in to continue.');
    const token = await ctx.user.getIdToken();
    headers.set('Authorization', 'Bearer ' + token);
    check();
  }
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  if (binary !== undefined) headers.set('Content-Type', 'application/octet-stream');
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers, signal, cache: 'no-store', redirect: 'error',
      body: json === undefined ? binary : JSON.stringify(json)
    });
  } catch (error) {
    check();
    if (error.name === 'AbortError') throw error;
    throw new Error('Could not reach Mock Master. Check your connection and try again.');
  }
  check();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    check();
    throw new Error(typeof body?.error === 'string' && body.error ? body.error :
      response.status === 401 ? 'Your session has expired. Sign in again to continue.' :
      `The request failed (${response.status}). Please try again.`);
  }
  if (image && !/^image\//i.test(response.headers.get('Content-Type') || '')) {
    throw new Error('The server did not return a book image.');
  }
  const body = image ? await response.blob() : (response.status === 204 ? null :
    await response.text().then(text => text ? JSON.parse(text) : null));
  check();
  return body;
}

export async function firebaseAuth() {
  const [{firebase}, {initializeApp}, sdk] = await Promise.all([
    api('/config'),
    import(`${firebaseBase}firebase-app.js`),
    import(`${firebaseBase}firebase-auth.js`)
  ]);
  return {sdk, auth: sdk.getAuth(initializeApp(firebase))};
}

export function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!checkoutScript) {
    checkoutScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = razorpayUrl;
      const timer = setTimeout(fail, 15000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        reject(new Error('Checkout could not load. Check your connection and try again.'));
      }
      script.addEventListener('error', fail, {once: true});
      script.addEventListener('load', () => {
        clearTimeout(timer);
        if (typeof window.Razorpay === 'function') resolve(window.Razorpay);
        else fail();
      }, {once: true});
      document.head.append(script);
    }).catch(error => {
      checkoutScript = null;
      throw error;
    });
  }
  return checkoutScript;
}
