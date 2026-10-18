// Local notifications for permission requests. They work while the app (or its service worker) is alive; there is
// no push server, so a closed app is not woken up.
export const notificationsSupported = () => typeof Notification !== 'undefined';
export const notificationState = () => (notificationsSupported() ? Notification.permission : 'unsupported');
export async function askNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}
export async function notifyPermission(p, chatTitle) {
  if (notificationState() !== 'granted') return;
  const title = 'Pedido de permissão · ' + chatTitle;
  const options = { body: (p.command || p.title || '').slice(0, 140), tag: p.id, icon: 'icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, options);
  } catch {}
  try {
    new Notification(title, options);
  } catch {}
}
