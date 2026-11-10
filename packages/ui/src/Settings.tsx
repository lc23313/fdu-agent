import { useEffect, useState, type ReactNode } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { PushSetup } from './PushSetup.tsx';
import { Modal } from './Modal.tsx';
import { SetupGuide } from './SetupGuide.tsx';
import { LearningConnection } from './LearningConnection.tsx';
import type { DesktopLearningApi } from './LearningLogin.tsx';
import { readBackup } from '../../core/src/backup.ts';
import { calendarExport } from '../../core/src/calendar-export.ts';
export function Settings({
  api,
  snapshot,
  run,
  close,
  modelSettings,
  desktopLearning,
  openModels = false,
}: {
  api: ClientApi;
  snapshot: Snapshot;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  close: () => void;
  modelSettings?: ReactNode;
  desktopLearning?: DesktopLearningApi;
  openModels?: boolean;
}) {
  const [models, setModels] = useState(openModels),
    [message, setMessage] = useState(''),
    [space, setSpace] = useState('');
  useEffect(() => {
    if (openModels) setModels(true);
  }, [openModels]);
  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then((v) =>
        setSpace(
          `本机使用约 ${Math.round((v.usage ?? 0) / 1048576)} MB，估算可用 ${Math.round(((v.quota ?? 0) - (v.usage ?? 0)) / 1048576)} MB`,
        ),
      );
  }, []);
  useEffect(() => {
    const show = () => setModels(true);
    window.addEventListener('fdu-model-settings-open', show);
    return () => window.removeEventListener('fdu-model-settings-open', show);
  }, []);
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Modal title="设置与同步" close={close} wide={models}>
      <details open={!snapshot.connected}>
        <summary>同步 · {snapshot.connected ? '已连接' : '本机模式'}</summary>
        <p>
          {snapshot.configured
            ? '使用同一个同步码，连接你的电脑与手机。'
            : '先配置自己的同步空间，也可以继续在本机使用。'}
        </p>
        {!snapshot.connected && (
          <>
            <details open={!snapshot.configured}>
              <summary>高级连接参数</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() =>
                    api.configure({ url: String(f.get('url')), key: String(f.get('key')) }),
                  ).catch((e) => setMessage(String(e)));
                }}
              >
                <label>
                  Project URL
                  <input name="url" type="url" defaultValue={snapshot.projectUrl} required />
                </label>
                <label>
                  公开 publishable / anon key
                  <input name="key" required autoComplete="off" />
                </label>
                <button className="primary">保存云端配置</button>
              </form>
            </details>
            {snapshot.configured && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() =>
                    api.connectCode(String(f.get('code')), f.get('import') === 'on'),
                  ).catch((e) => setMessage(String(e)));
                }}
              >
                <label>
                  同步码
                  <input
                    name="code"
                    aria-label="同步码"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="off"
                  />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="import" defaultChecked />
                  导入本机离线任务
                </label>
                <button className="primary">连接并同步</button>
              </form>
            )}
          </>
        )}
        {snapshot.connected && (
          <>
            <p>
              最近任务同步：
              {snapshot.lastSyncAt
                ? new Date(snapshot.lastSyncAt).toLocaleString('zh-CN')
                : '等待确认'}{' '}
              · {snapshot.pending} 项改动待同步
            </p>
            <button
              onClick={() => void run(() => api.logout()).catch((e) => setMessage(String(e)))}
            >
              断开同步
            </button>
          </>
        )}
      </details>
      <details>
        <summary>
          学校连接 · {snapshot.learning.last_success_at ? '有课程缓存' : '尚未成功读取'}
        </summary>
        <LearningConnection
          api={api}
          snapshot={snapshot}
          refresh={() =>
            void run(() =>
              desktopLearning ? desktopLearning.refresh() : api.refreshElearning(),
            ).catch((e) => setMessage(String(e)))
          }
          desktop={desktopLearning}
        />
      </details>
      <details open={models}>
        <summary>AI 与模型</summary>
        <p>
          手机对话通过本人的云端模型服务；桌面对话使用本机提供商。配置完成后，请在相应用途中测试调用。
        </p>
        {modelSettings && (
          <>
            <button onClick={() => setModels(!models)}>模型与工具配置</button>
            {models && <div className="native-settings">{modelSettings}</div>}
          </>
        )}
        <details>
          <summary>手机 AI 部署帮助</summary>
          <p>
            在现有 Supabase 项目部署 ai 函数，设置 FDU_AI_KEY、FDU_AI_MODEL 和本人
            FDU_OWNER_ID。密钥仅保存在服务端；每次调用会计费，默认每日 30 次、间隔 10 秒。
          </p>
        </details>
      </details>
      <details>
        <summary>外观与提醒</summary>
        <label>
          外观
          <select
            value={snapshot.catalog.theme}
            onChange={(e) =>
              void run(() =>
                api.catalog({ ...snapshot.catalog, theme: e.target.value as 'system' }),
              ).catch((e) => setMessage(String(e)))
            }
          >
            {[
              ['system', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            if ('Notification' in window)
              void Notification.requestPermission().then((p) =>
                setMessage(p === 'granted' ? '已允许系统通知' : '未获得通知权限，应用内提醒仍可用'),
              );
          }}
        >
          允许系统提醒
        </button>
        <PushSetup api={api} />
        <p>
          应用打开时会检查提醒。手机锁屏推送通过上方入口单独连接；也可导出日历后交给系统日历提醒。
        </p>
      </details>
      <details>
        <summary>数据管理</summary>
        {snapshot.catalog.plans.some((p) => p.template) && (
          <details>
            <summary>任务模板</summary>
            {snapshot.catalog.plans
              .filter((p) => p.template)
              .map((template) => (
                <p key={template.id}>
                  {template.title}{' '}
                  <button
                    aria-label={`删除模板 ${template.title}`}
                    onClick={() => {
                      if (confirm(`删除模板“${template.title}”？已创建的任务保留。`))
                        void run(() =>
                          api.catalog({
                            ...snapshot.catalog,
                            plans: snapshot.catalog.plans.filter((p) => p.id !== template.id),
                          }),
                        ).catch((e) => setMessage(String(e)));
                    }}
                  >
                    删除模板
                  </button>
                </p>
              ))}
          </details>
        )}
        <p>
          {snapshot.tasks.length} 项任务 · {snapshot.files.length} 份资料索引 ·{' '}
          {snapshot.files.filter((f) => f.uploaded).length} 份原文件已上传
        </p>
        <p>{space}</p>
        <button
          onClick={() =>
            void navigator.storage
              ?.persist?.()
              .then((yes) =>
                setMessage(yes ? '已获得持久化存储' : '系统暂未授予；请保持同步并定期备份'),
              )
          }
        >
          申请持久化存储
        </button>
        <button
          onClick={() =>
            void api
              .export()
              .then((raw) =>
                download(new Blob([raw], { type: 'application/json' }), 'FDU-Agent-tasks.json'),
              )
              .catch((e) => setMessage(String(e)))
          }
        >
          导出本机数据备份
        </button>
        <button
          onClick={() =>
            void api
              .export()
              .then(async (raw) => {
                const { fullBackup } = await import('./Library.tsx');
                const { blob, count, missing } = await fullBackup(raw);
                download(blob, 'FDU-Agent-local-files-backup.zip');
                setMessage(
                  `已导出 ${count} 份本机文件；${missing} 份原文件未在本机，未包含在包内。`,
                );
              })
              .catch((e) => setMessage(String(e)))
          }
        >
          导出含本机文件的备份 ZIP
        </button>
        <label>
          恢复备份
          <input
            aria-label="恢复备份"
            type="file"
            accept=".zip,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void (async () => {
                let data: unknown;
                let commit: () => Promise<unknown> = async () => {};
                let fileReport = '';
                if (/\.zip$/i.test(file.name)) {
                  const backup = await (await import('./Library.tsx')).readFullBackup(file);
                  data = backup.data;
                  commit = backup.commit;
                  fileReport = `；${backup.count} 份原文件已通过校验，${backup.missing} 份原文件未包含`;
                } else {
                  if (file.size > 10000000) throw new Error('备份索引过大');
                  data = JSON.parse(await file.text());
                }
                const tasks = readBackup(data);
                if (
                  confirm(`恢复 ${tasks.length} 项任务为新副本${fileReport}？当前任务和文件保留。`)
                ) {
                  await commit();
                  await run(() => api.restoreBackup(data));
                  setMessage(
                    `已恢复 ${tasks.length} 项任务副本${fileReport}。课程、资料索引与模板已追加，请核对文件可用状态。`,
                  );
                }
              })().catch((e) => setMessage(String(e)));
            }}
          />
        </label>
        <button
          onClick={() => {
            download(
              new Blob([calendarExport(snapshot.tasks)], { type: 'text/calendar' }),
              'FDU-Agent.ics',
            );
          }}
        >
          导出任务到系统日历
        </button>
      </details>
      <details>
        <summary>部署帮助与安装说明</summary>
        <SetupGuide snapshot={snapshot} />
        <p>iPhone：在 Safari 打开 HTTPS 页面 → 分享 → 添加到主屏幕。</p>
      </details>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </Modal>
  );
}
