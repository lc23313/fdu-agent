import { useEffect, useState } from 'react';
import { CloudLecture } from './CloudLecture.tsx';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';

export type DesktopLectureApi = { start: () => Promise<{ url: string }> };
export function LecturePanel({
  desktop,
  api,
  snapshot,
}: {
  desktop?: DesktopLectureApi;
  api: ClientApi;
  snapshot: Snapshot;
}) {
  const [mode, setMode] = useState('cloud'),
    [opened, setOpened] = useState(false);
  const [url, setUrl] = useState(desktop ? '' : `${import.meta.env.BASE_URL}lecture/index.html`);
  const [error, setError] = useState('');
  const start = () => {
    setError('');
    void desktop
      ?.start()
      .then(({ url }) => setUrl(url))
      .catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)));
  };
  useEffect(() => {
    if (desktop && opened) start();
  }, [desktop, opened]);
  return (
    <section className="lecture-panel" aria-label="讲座转录">
      <div className="view-tabs">
        <button className={mode === 'cloud' ? 'selected' : ''} onClick={() => setMode('cloud')}>
          Supabase 转录
        </button>
        <button
          className={mode === 'local' ? 'selected' : ''}
          onClick={() => {
            setOpened(true);
            setMode('local');
          }}
        >
          原讲座工作台
        </button>
      </div>
      <div hidden={mode !== 'cloud'}>
        <CloudLecture api={api} snapshot={snapshot} />
      </div>
      <div hidden={mode !== 'local'}>
        <p className="subtitle">
          {desktop
            ? '本机讲座工作台 · 开启实时识别或主动转录时才调用百炼。'
            : '录音先保存在当前设备。实时识别、完整转录和整理需在内页 API 设置连接私人 HTTPS 后端。'}{' '}
          保持页面前台；锁屏可能中断录音。
        </p>
        {error && (
          <p role="alert">
            {error} <button onClick={start}>重试启动</button>
          </p>
        )}
        {!url && !error && <p role="status">正在启用本机讲座服务…</p>}
        {opened && url && (
          <iframe
            title="讲座工作台"
            src={url}
            allow="microphone; screen-wake-lock; clipboard-write"
          />
        )}
      </div>
    </section>
  );
}
