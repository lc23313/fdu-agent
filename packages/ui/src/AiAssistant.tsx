import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { NavIcon } from './NavIcon.tsx';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import type { Draft, Proposal } from '../../ai/src/drafts.ts';
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown-text">
      <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
function DraftCard({
  draft,
  snapshot,
  decide,
}: {
  draft: Draft;
  snapshot: Snapshot;
  decide: (id: string, yes: boolean, proposal?: unknown) => Promise<unknown>;
}) {
  const [proposal, setProposal] = useState<Proposal>(() => structuredClone(draft.proposal)),
    [selected, setSelected] = useState(() => draft.proposal.operations.map(() => true)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = (index: number, key: string, value: unknown) =>
    setProposal((p) => ({
      ...p,
      operations: p.operations.map((op, i) =>
        i === index && 'patch' in op ? { ...op, patch: { ...op.patch, [key]: value } } : op,
      ),
    }));
  const apply = async (yes: boolean) => {
    setBusy(true);
    setError('');
    try {
      await decide(draft.id, yes, {
        ...proposal,
        operations: proposal.operations.filter((_, i) => selected[i]),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="assignment-row">
      <h3>
        {proposal.plan_title || 'AI 任务草稿'} · {selected.filter(Boolean).length} 项
      </h3>
      <MarkdownText text={proposal.reply} />
      {proposal.operations.map((op, index) => (
        <div className="draft-operation" key={index}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              aria-label={`采用第 ${index + 1} 项建议`}
              checked={selected[index]}
              onChange={(e) =>
                setSelected((before) => before.map((v, i) => (i === index ? e.target.checked : v)))
              }
            />
            {op.action === 'create' ? '新增' : op.action === 'delete' ? '删除' : '修改'}：
            {'id' in op ? snapshot.tasks.find((t) => t.id === op.id)?.title : op.patch.title}
          </label>
          {'patch' in op && (
            <details open>
              <summary>调整建议</summary>
              {(op.action === 'create' || op.patch.title !== undefined) && (
                <label>
                  标题
                  <input
                    aria-label={`草稿标题 ${index + 1}`}
                    value={op.patch.title ?? ''}
                    maxLength={200}
                    required
                    onChange={(e) => change(index, 'title', e.target.value)}
                  />
                </label>
              )}
              <div className="form-grid">
                <label>
                  安排/截止日期
                  <input
                    type="datetime-local"
                    aria-label={`草稿日期 ${index + 1}`}
                    value={
                      op.patch.due_at
                        ? `${new Date(op.patch.due_at).getFullYear()}-${String(new Date(op.patch.due_at).getMonth() + 1).padStart(2, '0')}-${String(new Date(op.patch.due_at).getDate()).padStart(2, '0')}T${new Date(op.patch.due_at).toTimeString().slice(0, 5)}`
                        : ''
                    }
                    onChange={(e) =>
                      change(
                        index,
                        'due_at',
                        e.target.value ? new Date(e.target.value).toISOString() : null,
                      )
                    }
                  />
                </label>
                <label>
                  课程
                  <select
                    value={op.patch.course_id ?? ''}
                    onChange={(e) => change(index, 'course_id', e.target.value || null)}
                  >
                    <option value="">个人任务</option>
                    {snapshot.courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                备注
                <textarea
                  value={op.patch.notes ?? ''}
                  maxLength={20000}
                  onChange={(e) => change(index, 'notes', e.target.value)}
                />
              </label>
              {op.action === 'patch' && (
                <p>变更字段：{Object.keys(op.patch).join('、')}；确认时会检查任务是否已更新。</p>
              )}
              {'parent_ref' in op && op.parent_ref && (
                <small>
                  归属本批新父任务：
                  {proposal.operations.find(
                    (p) => p.action === 'create' && p.local_id === op.parent_ref,
                  )?.action === 'create'
                    ? op.parent_ref
                    : ''}
                </small>
              )}
              <details>
                <summary>查看全部字段变化</summary>
                <pre>{JSON.stringify(op, null, 2)}</pre>
              </details>
            </details>
          )}
        </div>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !selected.some(Boolean)}
        onClick={() => void apply(true)}
      >
        {busy ? '处理中…' : '确认执行所选建议'}
      </button>
      <button disabled={busy} onClick={() => void apply(false)}>
        放弃草稿
      </button>
    </article>
  );
}
export function DraftReview({
  snapshot,
  decide,
  undo,
}: {
  snapshot: Snapshot;
  decide: (id: string, confirm: boolean, proposal?: unknown) => Promise<unknown>;
  undo?: (id: string) => Promise<unknown>;
}) {
  return (
    <section className="ai-drafts">
      {snapshot.aiDrafts
        .filter((d) => d.status === 'applied' && d.applied)
        .map((d) => (
          <div className="notice" key={d.id}>
            已应用：{d.proposal.plan_title || '任务草稿'}
            <button onClick={() => void undo?.(d.id).catch(() => {})}>撤销本次 AI 变更</button>
          </div>
        ))}
      {snapshot.aiDrafts
        .filter((d) => d.status === 'pending')
        .map((d) => (
          <DraftCard key={d.id} draft={d} snapshot={snapshot} decide={decide} />
        ))}
    </section>
  );
}
export function AiAssistant({
  api,
  refresh,
  initial,
  prompt = '',
}: {
  api: ClientApi;
  refresh: () => Promise<unknown>;
  initial: { role: 'user' | 'assistant'; content: string }[];
  prompt?: string;
}) {
  const key = `fdu-ai-input:${localStorage.getItem('fdu-owner') ?? 'local'}`;
  const [messages, setMessages] = useState(initial),
    [text, setText] = useState(() => localStorage.getItem(key) ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (prompt) setText(prompt);
  }, [prompt]);
  useEffect(() => {
    localStorage.setItem(key, text);
  }, [key, text]);
  const send = async () => {
    if (busy || !text.trim()) return;
    const input = text;
    const next = [...messages, { role: 'user' as const, content: input }].slice(-20);
    setBusy(true);
    setError('');
    try {
      const result = await api.askAi(next);
      setMessages([...next, { role: 'assistant', content: result.reply }]);
      setText('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ai-chat">
      {(messages.length > 0 || busy) && (
        <div className="view-tabs ai-chat-actions">
          <button
            disabled={busy}
            onClick={() => {
              if (confirm('开始新对话？已确认的任务保留。'))
                void api.clearAi().then(() => setMessages([]));
            }}
          >
            新对话
          </button>
          {busy && <button onClick={() => void api.cancelAi()}>停止生成</button>}
        </div>
      )}
      {messages.length === 0 && (
        <div className="ai-welcome">
          <span className="ai-welcome-icon">
            <NavIcon name="ai" />
          </span>
          <h2>从一件具体的事开始</h2>
          <p>把想法理清楚，再一步步完成。</p>
          <div className="ai-starters">
            {[
              ['拆解一个任务', '帮我把一项任务拆成可执行的步骤，先问我任务目标，再给出草稿。'],
              [
                '安排学习时间',
                '帮我安排接下来的学习时间，先询问我有空的时段，保留已有的固定安排。',
              ],
              ['梳理课程作业', '请整理本周还没完成的课程任务，区分个人完成状态和学校提交状态。'],
            ].map(([title, prompt]) => (
              <button
                type="button"
                key={title}
                onClick={() => {
                  setText(prompt!);
                  document.getElementById('ai-message')?.focus();
                }}
              >
                {title}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div aria-live="polite">
        {messages.map((m, i) => (
          <article className={`chat-message ${m.role}`} key={i}>
            <small>{m.role === 'user' ? '你' : '助手'}</small>
            <MarkdownText text={m.content} />
          </article>
        ))}
      </div>
      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="AI 消息"
          id="ai-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="说说你想做什么…"
          rows={3}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          required
          maxLength={8000}
        />
        <div className="ai-composer-bar">
          <small>{busy ? '正在整理，请稍候…' : '修改先预览，再由你确认'}</small>
          <button className="primary" disabled={busy || !text.trim()} aria-label="发送消息">
            <NavIcon name="send" />
            {busy ? '思考中…' : '发送消息'}
          </button>
        </div>
      </form>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button disabled={busy} onClick={() => void send()}>
            重试这条消息
          </button>
        </div>
      )}
      <small className="ai-scope-note">使用已同步的任务与课程 · 模型调用按服务商计费</small>
    </section>
  );
}
