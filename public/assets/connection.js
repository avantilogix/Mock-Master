let connected = globalThis.navigator?.onLine !== false;
let probe;
let timer;

function setConnected(value) {
  if (connected !== value) {
    connected = value;
    globalThis.window?.dispatchEvent(new CustomEvent('mission-connection-change', {detail: {connected}}));
  }
  if (!connected && !timer && globalThis.window) timer = setInterval(checkConnection, 5000);
  if (connected && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function isConnected() {
  return connected && navigator.onLine;
}

export function connectionFailed() {
  setConnected(false);
}

export async function checkConnection() {
  if (!navigator.onLine) {
    setConnected(false);
    return false;
  }
  if (!probe) {
    probe = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api/config', {cache: 'no-store', signal: controller.signal});
        return response.ok && navigator.onLine;
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    })().then(result => {
      setConnected(result && navigator.onLine);
      return isConnected();
    }).finally(() => { probe = null; });
  }
  return probe;
}

export async function requireLoginConnection() {
  if (!await checkConnection()) throw new Error('An internet connection is required to log in.');
}

globalThis.window?.addEventListener('offline', () => setConnected(false));
globalThis.window?.addEventListener('online', checkConnection);
if (!connected) setConnected(false);
