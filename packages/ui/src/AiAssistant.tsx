import { useState } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
export function DraftReview({
  snapshot,
  decide,
}: {
  snapshot: Snapshot;
  decide: (id: string, confirm: boolean) => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const names: Record<string, string> = {
    title: '标题',
    description: '描述',
    status: '个人状态',
    priority: '优先级',
    start_at: '开始时间',
    due_at: '截止时间',
    parent_id: '父任务',
    course_id: '课程',
    list_id: '清单',
    tags: '标签',
    notes: '备注',
    reminders: '提前提醒',
  };
  const display = (key: string, value: unknown): string => {
    if (value === null || value === '') return '未设置';
    if (key === 'status')
      return (
        ({ todo: '待办', in_progress: '进行中', completed: '已完成' } as Record<string, string>)[
          String(value)
        ] ?? String(value)
      );
    if (key === 'priority') return ['无', '低', '中', '高'][Number(value)]!;
    if (key === 'course_id')
      return snapshot.courses.find((c) => c.id === value)?.name ?? '课程已不可用';
    if (key === 'parent_id')
      return snapshot.tasks.find((t) => t.id === value)?.title ?? '父任务已不可用';
    if (key.endsWith('_at')) return new Date(String(value)).toLocaleString('zh-CN');
    if (key === 'reminders')
      return (
        (value as { minutes_before: number }[]).map((r) => `${r.minutes_before} 分钟`).join('、') ||
        '无'
      );
    return Array.isArray(value) ? value.join('、') || '无' : String(value);
  };
  return (
    <section className="ai-drafts">
      {snapshot.aiDrafts
        .filter((d) => d.status === 'pending')
        .map((d) => (
          <article className="assignment-row" key={d.id}>
            <h3>
              {d.proposal.plan_title || 'AI 任务草稿'} · {d.proposal.operations.length} 项
            </h3>
            <p>{d.proposal.reply}</p>
            {d.proposal.operations.map((op, i) => (
              <div className="draft-operation" key={i}>
                <b>
                  {op.action === 'create'
                    ? '新增任务'
                    : op.action === 'delete'
                      ? '删除任务'
                      : '修改任务'}
                  ：
                  {'id' in op
                    ? (snapshot.tasks.find((t) => t.id === op.id)?.title ?? '任务不可用')
                    : op.patch.title}
                </b>
                {'patch' in op && (
                  <dl>
                    {Object.entries(op.patch).map(([key, value]) => (
                      <div key={key}>
                        <dt>{names[key]}</dt>
                        <dd>
                          {op.action === 'patch' && (
                            <>
                              {display(
                                key,
                                snapshot.tasks.find((t) => t.id === op.id)?.[
                                  key as keyof Snapshot['tasks'][number]
                                ],
                              )}{' '}
                              →{' '}
                            </>
                          )}
                          {display(key, value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ))}
            <button
              className="primary"
              onClick={() => void decide(d.id, true).catch((e) => setError(String(e)))}
            >
              确认执行此草稿
            </button>{' '}
            <button onClick={() => void decide(d.id, false).catch((e) => setError(String(e)))}>
              放弃草稿
            </button>
          </article>
        ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function AiAssistant({
  api,
  refresh,
  initial,
}: {
  api: ClientApi;
  refresh: () => Promise<unknown>;
  initial: { role: 'user' | 'assistant'; content: string }[];
}) {
  const [messages, setMessages] =
      useState<{ role: 'user' | 'assistant'; content: string }[]>(initial),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="ai-chat">
      <p>可查询任务和课程、拆解任务、制定学习计划。写入前会展示草稿并由你确认。</p>
      <small>
        使用云端模型，需要先用同步码连接并完成服务端 AI
        配置；会发送最近任务与课程状态，不发送登录凭据。
      </small>
      <div aria-live="polite">
        {messages.map((m, i) => (
          <p className={`chat-message ${m.role}`} key={i}>
            <b>{m.role === 'user' ? '你' : '助手'}</b> {m.content}
          </p>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          const next = [...messages, { role: 'user' as const, content: text }].slice(-20);
          setMessages(next);
          setText('');
          setBusy(true);
          setError('');
          void api
            .askAi(next)
            .then(async (response) => {
              setMessages([...next, { role: 'assistant', content: response.reply }]);
              await refresh();
            })
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <textarea
          aria-label="AI 消息"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：把本周论文拆成三个步骤"
          required
          maxLength={8000}
        />
        <button className="primary" disabled={busy}>
          {busy ? '思考中…' : '发送消息'}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
