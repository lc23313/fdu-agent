import { useEffect, useState } from 'react';
import { Dexie, type Table } from 'dexie';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { fileSchema, type LibraryFile } from '../../library/src/schema.ts';
import { documentText } from './document-text.ts';
const db = new Dexie('fdu-library-content');
db.version(1).stores({ blobs: 'hash' });
const blobs = db.table('blobs') as Table<{ hash: string; bytes: Uint8Array }, string>;
export function Library({
  api,
  snapshot,
  refresh,
  course = '',
}: {
  api: ClientApi;
  snapshot: Snapshot;
  refresh: () => Promise<unknown>;
  course?: string;
}) {
  const [selected, setSelected] = useState<LibraryFile | null>(null),
    [url, setUrl] = useState(''),
    [query, setQuery] = useState(''),
    [type, setType] = useState(''),
    [courseFilter, setCourseFilter] = useState(course),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState('');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const importFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('单个文件最多20MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      const ext = file.name.split('.').at(-1)!.toLowerCase();
      const old = snapshot.files.find((f) => f.hash === hash);
      const record = fileSchema.parse({
        hash,
        name: old?.name ?? file.name,
        size: file.size,
        type: old?.type ?? ext,
        course_ids: [
          ...new Set([
            ...(old?.course_ids ?? []),
            ...(courseFilter && courseFilter !== '__unfiled' ? [courseFilter] : []),
          ]),
        ],
        text: old?.text ?? (await documentText(file.name, bytes)),
        uploaded: old?.uploaded ?? false,
        created_at: old?.created_at ?? new Date().toISOString(),
        version: 0,
      });
      await blobs.put({ hash, bytes });
      await api.saveFile(record);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = async (file: LibraryFile) => {
    setError('');
    try {
      let data = await blobs.get(file.hash);
      if (!data) {
        const bytes = new Uint8Array(await api.downloadFile(file.hash));
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        if (actual !== file.hash) throw new Error('下载校验失败');
        data = { hash: file.hash, bytes };
        await blobs.put(data);
      }
      setSelected(file);
      setText(file.text);
      setAnswer('');
      setUrl(
        URL.createObjectURL(
          new Blob([new Uint8Array(data.bytes)], {
            type: file.type === 'pdf' ? 'application/pdf' : 'application/octet-stream',
          }),
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="file-library">
      <h2>资料库</h2>
      {Object.entries(snapshot.fileConflicts).map(([hash, remote]) => (
        <div className="notice" key={hash}>
          资料关联冲突：{remote.name}。本机课程：
          {snapshot.files
            .find((f) => f.hash === hash)
            ?.course_ids.map((id) => snapshot.courses.find((c) => c.id === id)?.name ?? id)
            .join('、') || '未归档'}
          ；云端课程：
          {remote.course_ids
            .map((id) => snapshot.courses.find((c) => c.id === id)?.name ?? id)
            .join('、') || '未归档'}
          {(['local', 'server'] as const).map((choice) => (
            <button
              key={choice}
              onClick={() =>
                void api
                  .resolveFile(hash, choice)
                  .then(refresh)
                  .catch((e) => setError(String(e)))
              }
            >
              {choice === 'local' ? '保留本机' : '保留云端'}
            </button>
          ))}
        </div>
      ))}
      <p className="subtitle">文件先保存在本机；点击“上传到云端”后才传输文件。相同内容只存一份。</p>
      <div className="filters">
        <input
          aria-label="搜索资料"
          placeholder="搜索文件名或正文"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="资料课程"
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
        >
          <option value="">全部课程</option>
          <option value="__unfiled">未归档</option>
          {snapshot.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="资料类型" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          {['pdf', 'pptx', 'docx', 'md', 'txt', 'ppt', 'doc'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <label>
        导入资料
        <input
          aria-label="导入资料"
          type="file"
          accept=".pdf,.docx,.pptx,.md,.txt,.doc,.ppt"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </label>
      <button
        onClick={() => {
          const title = prompt('笔记名称');
          if (title)
            void importFile(
              new File(['# ' + title + '\n'], title + '.md', { type: 'text/markdown' }),
            );
        }}
      >
        新建 Markdown 笔记
      </button>
      {snapshot.files
        .filter(
          (f) =>
            (!courseFilter ||
              (courseFilter === '__unfiled'
                ? f.course_ids.length === 0
                : f.course_ids.includes(courseFilter))) &&
            (!type || f.type === type) &&
            `${f.name} ${f.text}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((f) => (
          <article className="file-row" key={f.hash}>
            <button onClick={() => void open(f)}>
              {f.name}
              <small>
                {f.type.toUpperCase()} · {Math.ceil(f.size / 1024)} KB ·{' '}
                {f.uploaded ? '已上传' : '仅本机'} ·{' '}
                {new Date(f.created_at).toLocaleString('zh-CN')}
              </small>
            </button>
            <button
              disabled={busy || f.uploaded}
              onClick={() => {
                if (!confirm(`上传 ${f.name}（${Math.ceil(f.size / 1024)}KB）到本人私有存储？`))
                  return;
                setBusy(true);
                void blobs
                  .get(f.hash)
                  .then(async (row) => {
                    if (!row) throw new Error('本机没有原文件');
                    await api.uploadFile(f.hash, row.bytes);
                    await refresh();
                  })
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              上传到云端
            </button>
          </article>
        ))}
      {snapshot.materials
        .filter(
          (m) =>
            !courseFilter ||
            snapshot.courses.find(
              (c) =>
                c.id === courseFilter &&
                'external_id' in c &&
                c.external_id === m.course_external_id,
            ),
        )
        .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
        .map((m) => (
          <article className="file-row" key={`${m.course_external_id}-${m.external_id}`}>
            <a href={m.official_url} target="_blank" rel="noreferrer">
              {m.name} ↗
            </a>
            <small>eLearning 官方资料 · 尚未下载；需在官方页面验证身份</small>
          </article>
        ))}
      {selected && (
        <section className="file-preview">
          <div className="detail-heading">
            <h3>{selected.name}</h3>
            <button onClick={() => setSelected(null)}>关闭预览</button>
          </div>
          <a href={url} download={selected.name}>
            下载／用其他应用打开原文件
          </a>
          {selected.type === 'pdf' ? (
            <iframe title="PDF 阅读" src={url} />
          ) : selected.type === 'md' || selected.type === 'txt' ? (
            <>
              <textarea
                aria-label="笔记正文"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
              />
              <button
                onClick={() =>
                  void importFile(new File([text], selected.name)).then(() => setSelected(null))
                }
              >
                保存为新版本
              </button>
            </>
          ) : (
            <>
              <small>
                Office 正文预览；复杂版式请用原文件或 Windows 工作台查看。旧版 DOC/PPT 需用桌面
                Office 打开。
              </small>
              <pre>{selected.text || '未提取到正文；可以下载原文件。'}</pre>
            </>
          )}
          <label>
            资料关联课程
            <select
              aria-label="资料关联课程"
              value={selected.course_ids[0] ?? ''}
              onChange={(e) => {
                const next = { ...selected, course_ids: e.target.value ? [e.target.value] : [] };
                void api
                  .saveFile(next)
                  .then(refresh)
                  .then(() => setSelected(next))
                  .catch((e) => setError(String(e)));
              }}
            >
              <option value="">未归档</option>
              {snapshot.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              void api
                .askDocument(selected.hash, question)
                .then((r) => {
                  setAnswer(r.reply);
                  return refresh();
                })
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              向 AI 提问
              <input
                aria-label="资料问题"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                required
                maxLength={4000}
              />
            </label>
            <small>
              编辑后请先保存新版本并重新打开。仅发送当前文件的已提取正文；可能截断，扫描PDF需先做OCR。不会自动发送其他资料。
            </small>
            <button disabled={busy || !selected.text || text !== selected.text}>
              根据本文回答
            </button>
          </form>
          <p className="assignment-description">{answer}</p>
        </section>
      )}
      {busy && <p role="status">正在处理资料…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}

export async function fullBackup(raw: string) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const data = JSON.parse(raw);
  zip.file('backup.json', raw);
  let count = 0;
  let total = 0;
  if (raw.length > 10_000_000) throw new Error('备份索引过大，请分批整理资料');
  for (const file of data.state.files ?? []) {
    const row = await blobs.get(file.hash);
    if (row) {
      total += row.bytes.byteLength;
      if (total > 100 * 1024 * 1024)
        throw new Error('备份超过100MB，请分别下载原文件并导出任务JSON');
      zip.file(`files/${file.hash}`, row.bytes);
      count++;
    }
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), count };
}
export async function readFullBackup(file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error('备份文件最多100MB');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = zip.file('backup.json');
  if (!manifest) throw new Error('缺少备份清单');
  const size = (manifest as unknown as { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (size !== undefined && size > 10_000_000) throw new Error('备份索引过大');
  const data = JSON.parse(await manifest.async('string'));
  const records = fileSchema
    .array()
    .max(5000)
    .parse(data.state?.files ?? []);
  const content: { hash: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const record of records) {
    const entry = zip.file(`files/${record.hash}`);
    if (!entry) continue;
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    if (size !== undefined && size > 20 * 1024 * 1024) throw new Error('备份中的文件过大');
    const bytes = await entry.async('uint8array');
    total += bytes.length;
    if (total > 100 * 1024 * 1024) throw new Error('备份解压内容过大');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== record.hash) throw new Error('备份文件校验失败');
    content.push({ hash, bytes });
  }
  return { data, commit: () => blobs.bulkPut(content) };
}
