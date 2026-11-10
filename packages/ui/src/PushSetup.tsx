import { useState } from 'react';
import type { ClientApi } from '../../client/src/client.ts';
export function PushSetup({ api }: { api: ClientApi }) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section>
      <button
        disabled={busy || !('serviceWorker' in navigator) || !('PushManager' in window)}
        onClick={() => {
          setBusy(true);
          void (async () => {
            const info = await api.push({ action: 'status' });
            if (!info.configured)
              throw new Error('服务端尚未配置锁屏推送，请使用前台提醒或导出系统日历。');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('未获得通知权限');
            const reg = await navigator.serviceWorker.ready;
            const raw = atob(info.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
            const key = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
            const sub =
              (await reg.pushManager.getSubscription()) ??
              (await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: key,
              }));
            await api.push({ action: 'subscribe', subscription: sub.toJSON() });
            setMessage('此设备已订阅推送，接下来请在实际锁屏状态验收。');
          })()
            .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
        }}
      >
        连接此设备的锁屏推送
      </button>
      <button
        disabled={busy || !('serviceWorker' in navigator)}
        onClick={() => {
          void navigator.serviceWorker.ready
            .then(async (reg) => {
              const sub = await reg.pushManager.getSubscription();
              if (sub) {
                await api.push({ action: 'unsubscribe', endpoint: sub.endpoint });
                await sub.unsubscribe();
              }
              setMessage('此设备推送已断开');
            })
            .catch((e) => setMessage(String(e)));
        }}
      >
        断开此设备推送
      </button>
      {message && <p role="status">{message}</p>}
      <small>iPhone 请先添加到主屏幕，再从这里授权。系统送达时间受网络和系统通知设置影响。</small>
    </section>
  );
}
