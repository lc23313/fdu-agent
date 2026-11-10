import type { Snapshot, ClientApi } from '../../client/src/client.ts';
import { newTaskFields } from '../../core/src/task.ts';
export function ConflictReview({
  snapshot,
  api,
  run,
}: {
  snapshot: Snapshot;
  api: ClientApi;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const names: Record<string, string> = {
    title: '标题',
    notes: '备注',
    description: '描述',
    status: '状态',
    priority: '优先级',
    start_at: '开始',
    due_at: '截止/结束',
    tags: '标签',
    course_id: '课程',
    parent_id: '父任务',
    reminders: '提醒',
    deleted_at: '删除',
    time_kind: '时间类型',
    repeat: '重复',
  };
  return (
    <>
      {snapshot.conflicts.map((c) => (
        <details open className="notice" key={c.id}>
          <summary>任务冲突：{c.local?.title ?? c.server?.title}</summary>
          <table>
            <thead>
              <tr>
                <th>变化字段</th>
                <th>本机</th>
                <th>云端</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(names)
                .filter(
                  (key) =>
                    JSON.stringify(c.local?.[key as keyof typeof c.local]) !==
                    JSON.stringify(c.server?.[key as keyof typeof c.server]),
                )
                .map((key) => (
                  <tr key={key}>
                    <td>{names[key]}</td>
                    <td>{JSON.stringify(c.local?.[key as keyof typeof c.local]) ?? '不存在'}</td>
                    <td>{JSON.stringify(c.server?.[key as keyof typeof c.server]) ?? '不存在'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <button onClick={() => void run(() => api.resolve(c.id, 'server')).catch(() => {})}>
            保留云端
          </button>
          {c.server && !c.server.deleted_at && (
            <button onClick={() => void run(() => api.resolve(c.id, 'local')).catch(() => {})}>
              保留本机
            </button>
          )}
          <button
            onClick={() =>
              void run(async () => {
                if (!c.local) return;
                const fields = Object.fromEntries(
                  Object.keys(newTaskFields(c.local.title))
                    .concat(['time_kind', 'repeat'])
                    .filter((k) => k in c.local!)
                    .map((k) => [k, c.local![k as keyof typeof c.local]]),
                );
                await api.create(`${c.local.title}（冲突副本）`, fields);
                await api.resolve(c.id, 'server');
              }).catch(() => {})
            }
          >
            保留本机为新副本
          </button>
        </details>
      ))}
      {snapshot.catalogConflict && (
        <div className="notice">
          课程或外观偏好有冲突，任务仍可独立同步。
          <button onClick={() => void run(() => api.resolveCatalog('server')).catch(() => {})}>
            保留云端偏好
          </button>
          <button onClick={() => void run(() => api.resolveCatalog('local')).catch(() => {})}>
            保留本机偏好
          </button>
        </div>
      )}
    </>
  );
}
