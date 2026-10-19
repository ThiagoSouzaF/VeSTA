// Bridge to the Electron preload; undefined when the page runs outside the desktop app.
export const api = window.vesta;
// Wraps a handler so a rejected call (already reported through the toast) does not surface as unhandled.
export const action = (fn) => async () => {
  try {
    await fn();
  } catch {}
};
// IPC rejections arrive prefixed by Electron; strip it so the toast shows only the message.
export const makeCall = (notify) => async (method, args) => {
  try {
    if (!api) throw new Error('Abra o VeSTA pelo aplicativo desktop para conectar suas IAs.');
    return await api.call(method, args);
  } catch (e) {
    notify(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    throw e;
  }
};
// Tells the main process (and the splash it keeps open) that the first state is loaded and painted, or why it is not.
export const signalReady = (error) =>
  requestAnimationFrame(() => requestAnimationFrame(() => api?.ready?.(error ? { error } : undefined)));
