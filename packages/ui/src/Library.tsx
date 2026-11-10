import { useEffect, useState } from 'react';
import { Dexie, type Table } from 'dexie';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { fileSchema, type LibraryFile } from '../../library/src/schema.ts';
import { renderPdfPage, documentText } from './document-text.ts';
import { MarkdownText } from './AiAssistant.tsx';
const db = new Dexie('fdu-library-content');
db.version(1).stores({ blobs: 'hash' });
const blobs = db.table('blobs') as Table<{ hash: string; bytes: Uint8Array }, string>;
export function Library({
  api,
  snapshot,
  refresh,
  course = '',
  openDocument,
}: {
  api: ClientApi;
  snapshot: Snapshot;
  refresh: () => Promise<unknown>;
  course?: string;
  openDocument?: string;
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
    [answer, setAnswer] = useState(''),
    [localHashes, setLocalHashes] = useState<string[]>([]),
    [history, setHistory] = useState(false),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(100),
    [progress, setProgress] = useState(''),
    [models, setModels] = useState<
      { provider: string; model: string; label: string; vision?: boolean }[]
    >([]),
    [model, setModel] = useState(''),
    [qaModel, setQaModel] = useState('');
  useEffect(() => {
    void api
      .documentModels()
      .then(setModels)
      .catch(() => {});
  }, [api]);
  useEffect(() => {
    void blobs
      .toCollection()
      .primaryKeys()
      .then((keys) => setLocalHashes(keys));
  }, [snapshot.files]);
  useEffect(() => {
    if (selected && text !== selected.text)
      localStorage.setItem('fdu-note-draft:' + selected.hash, text);
  }, [selected, text]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const importFile = async (file: File, previous?: LibraryFile) => {
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
        document_id: previous?.document_id ?? old?.document_id ?? crypto.randomUUID(),
        previous_hash: previous?.hash ?? old?.previous_hash ?? null,
        deleted_at: null,
        hash,
        name: old?.name ?? file.name,
        size: file.size,
        type: old?.type ?? ext,
        course_ids: [
          ...new Set([
            ...(previous?.course_ids ?? old?.course_ids ?? []),
            ...(courseFilter && courseFilter !== '__unfiled' ? [courseFilter] : []),
          ]),
        ],
        text: old?.text ?? (await documentText(file.name, bytes)),
        uploaded: old?.uploaded ?? false,
        created_at: old?.created_at ?? new Date().toISOString(),
        version: 0,
      });
      await blobs.put({ hash, bytes });
      if (previous && !previous.document_id)
        await api.saveFile({ ...previous, document_id: record.document_id });
      await api.saveFile(record);
      await refresh();
      setLocalHashes((before) => [...new Set([...before, hash])]);
      return record;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = async (file: LibraryFile) => {
    setError('');
    setProgress('正在打开资料…');
    try {
      let data = await blobs.get(file.hash);
      if (!data) {
        if (!file.uploaded)
          throw new Error(
            '原文件尚未上传，暂时只在另一台设备。请在原设备上传或在本机导入同一文件。',
          );
        const bytes = new Uint8Array(await api.downloadFile(file.hash));
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        if (actual !== file.hash) throw new Error('下载校验失败');
        data = { hash: file.hash, bytes };
        await blobs.put(data);
      }
      setSelected(file);
      setPage(
        Number(localStorage.getItem('fdu-reader-page:' + (file.document_id ?? file.hash))) || 1,
      );
      setZoom(
        Number(localStorage.getItem('fdu-reader-zoom:' + (file.document_id ?? file.hash))) || 100,
      );
      setText(localStorage.getItem('fdu-note-draft:' + file.hash) ?? file.text);
      setLocalHashes((before) => [...new Set([...before, file.hash])]);
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
    } finally {
      setProgress('');
    }
  };
  useEffect(() => {
    const file = snapshot.files.find((f) => f.hash === openDocument?.split('#')[0]);
    if (file) void open(file);
  }, [openDocument]);
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
      <label className="checkbox-label">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        显示历史版本与回收站
      </label>
      {snapshot.files
        .filter(
          (f) =>
            history ||
            (!f.deleted_at &&
              !snapshot.files.some(
                (other) =>
                  !other.deleted_at &&
                  other.hash !== f.hash &&
                  f.document_id &&
                  other.document_id === f.document_id &&
                  other.created_at > f.created_at,
              )),
        )
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
                {f.deleted_at
                  ? '已移到回收站'
                  : localHashes.includes(f.hash)
                    ? f.uploaded
                      ? '本机可读 · 云端已上传'
                      : '本机可读 · 未上传'
                    : f.uploaded
                      ? '云端可下载'
                      : '仅其他设备'}{' '}
                · {new Date(f.created_at).toLocaleString('zh-CN')}
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
        .filter((m) => m.kind !== 'announcement')
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
            <>
              <details>
                <summary>扫描页识别 OCR（按需）</summary>
                <p>
                  当前文件已提取 {selected.text.replace(/\[第\d+页\]/g, '').trim().length}{' '}
                  字；扫描页需识别。只发送当前页图片给所选视觉模型，可能计费。
                </p>
                {models.some((m) => m.vision) ? (
                  <>
                    <select
                      aria-label="OCR 模型"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      <option value="">选择视觉模型</option>
                      {models.map((m, i) =>
                        m.vision ? (
                          <option key={i} value={i}>
                            {m.label}
                          </option>
                        ) : null,
                      )}
                    </select>
                    <button
                      disabled={busy || model === ''}
                      onClick={() => {
                        if (!confirm('将当前页发送给所选视觉模型识别？可能计费。')) return;
                        setBusy(true);
                        void blobs
                          .get(selected.hash)
                          .then(async (row) => {
                            if (!row) throw new Error('请先下载原文件');
                            const m = models[Number(model)]!;
                            const image = await renderPdfPage(row.bytes, page);
                            const ocr = await api.ocrDocument(image, m.provider, m.model);
                            const combined =
                              selected.text + '\n[第' + page + '页] OCR 校对稿\n' + ocr;
                            if (combined.length > 60000) {
                              const note = await importFile(
                                new File(
                                  [`# ${selected.name} 第 ${page} 页 OCR 校对稿\n\n${ocr}`],
                                  `${selected.name}-第${page}页OCR.md`,
                                  { type: 'text/markdown' },
                                ),
                              );
                              if (note) {
                                await api.saveFile({ ...note, course_ids: selected.course_ids });
                                await refresh();
                                setProgress('正文索引已满，识别结果已另存为 OCR 笔记。');
                              }
                              return;
                            }
                            const next = {
                              ...selected,
                              text: combined,
                            };
                            await api.saveFile(next);
                            setSelected(next);
                            setText(next.text);
                            await refresh();
                          })
                          .catch((e) => setError(String(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      识别当前页
                    </button>
                  </>
                ) : (
                  <p>请在 Windows 配置支持视觉输入的模型。识别后的正文随资料索引同步到手机。</p>
                )}
              </details>
              <label>
                阅读页码
                <input
                  type="number"
                  aria-label="阅读页码"
                  min={1}
                  value={page}
                  onChange={(e) => {
                    const n = Math.max(1, Number(e.target.value));
                    setPage(n);
                    localStorage.setItem(
                      'fdu-reader-page:' + (selected.document_id ?? selected.hash),
                      String(n),
                    );
                  }}
                />
              </label>
              <label>
                阅读缩放
                <select
                  aria-label="阅读缩放"
                  value={zoom}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setZoom(value);
                    localStorage.setItem(
                      'fdu-reader-zoom:' + (selected.document_id ?? selected.hash),
                      String(value),
                    );
                  }}
                >
                  {[50, 75, 100, 125, 150, 200].map((value) => (
                    <option key={value} value={value}>
                      {value}%
                    </option>
                  ))}
                </select>
              </label>
              <iframe title="PDF 阅读" src={url + '#page=' + page + '&zoom=' + zoom} />
              <details>
                <summary>检索正文与定位</summary>
                <input
                  aria-label="搜索文档正文"
                  placeholder="输入关键词，查看对应页"
                  onChange={(e) => {
                    const query = e.target.value;
                    if (query) {
                      const position = selected.text.indexOf(query);
                      const marks = [
                        ...selected.text.slice(0, Math.max(0, position)).matchAll(/\[第(\d+)页\]/g),
                      ];
                      const mark = marks.at(-1);
                      if (mark) setPage(Number(mark[1]));
                    }
                  }}
                />
                <pre>
                  {selected.text.slice(
                    Math.max(0, selected.text.indexOf('[第' + page + '页]')),
                    Math.max(0, selected.text.indexOf('[第' + page + '页]')) + 5000,
                  )}
                </pre>
              </details>
            </>
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
                  void importFile(new File([text], selected.name), selected).then((record) => {
                    if (record) {
                      localStorage.removeItem('fdu-note-draft:' + selected.hash);
                      void open(record);
                    }
                  })
                }
              >
                保存为新版本
              </button>
              <MarkdownText text={text} />
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
              multiple
              value={selected.course_ids}
              onChange={(e) => {
                const next = {
                  ...selected,
                  course_ids: [...e.target.selectedOptions].map((o) => o.value).filter(Boolean),
                };
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
          {models.length > 0 && (
            <label>
              问答模型
              <select
                aria-label="文档问答模型"
                value={qaModel}
                onChange={(e) => setQaModel(e.target.value)}
              >
                <option value="">默认启用模型</option>
                {models.map((m, i) => (
                  <option key={i} value={i}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              void api
                .askDocument(
                  selected.hash,
                  question,
                  qaModel === '' ? undefined : models[Number(qaModel)],
                )
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
                maxLength={1500}
              />
            </label>
            <small>
              仅检索当前文件已提取的正文；PDF 最多前 100 页、Office 最多前 200 页、正文最多 60,000
              字。超出部分请拆分导入；扫描页需先识别。引用页码可点击定位。编辑后请先保存新版本。
            </small>
            <button disabled={busy || !selected.text || text !== selected.text}>
              根据本文回答
            </button>
          </form>
          <MarkdownText text={answer} />
          <div className="view-tabs">
            {[...answer.matchAll(/第\s*(\d+)\s*页/g)].map((match, index) => (
              <button key={index} onClick={() => setPage(Number(match[1]))}>
                跳到第 {match[1]} 页
              </button>
            ))}
          </div>
          <details>
            <summary>文件管理与版本</summary>
            <button
              disabled={!selected.uploaded}
              onClick={() => {
                if (confirm('删除该文件的云端原文件？本机副本保留，其他设备将无法下载。'))
                  void api
                    .deleteCloudFile(selected.hash)
                    .then(refresh)
                    .then(() => setSelected({ ...selected, uploaded: false }))
                    .catch((e) => setError(String(e)));
              }}
            >
              删除云端原文件
            </button>
            <label>
              文件名称
              <input
                aria-label="文件名称"
                defaultValue={selected.name}
                onBlur={(e) => {
                  const next = { ...selected, name: e.target.value };
                  void api
                    .saveFile(next)
                    .then(refresh)
                    .then(() => setSelected(next))
                    .catch((e) => setError(String(e)));
                }}
              />
            </label>
            <button
              onClick={() => {
                if (confirm('只清除此设备下载？未上传的原文件请先备份。'))
                  void blobs.delete(selected.hash).then(() => {
                    setLocalHashes((keys) => keys.filter((h) => h !== selected.hash));
                    setSelected(null);
                  });
              }}
            >
              清理本机下载
            </button>
            <button
              onClick={() => {
                const next = {
                  ...selected,
                  deleted_at: selected.deleted_at ? null : new Date().toISOString(),
                };
                void api
                  .saveFile(next)
                  .then(refresh)
                  .then(() => setSelected(null));
              }}
            >
              {selected.deleted_at ? '恢复资料' : '资料移到回收站'}
            </button>
            {snapshot.files
              .filter((f) => f.document_id && f.document_id === selected.document_id)
              .map((f) => (
                <p key={f.hash}>
                  <button onClick={() => void open(f)}>
                    {new Date(f.created_at).toLocaleString('zh-CN')} · {f.hash.slice(0, 8)}
                  </button>
                  {f.hash !== selected.hash && (
                    <button
                      onClick={() =>
                        void api
                          .saveFile({ ...f, created_at: new Date().toISOString() })
                          .then(refresh)
                          .then(() => open(f))
                      }
                    >
                      设为当前版本
                    </button>
                  )}
                </p>
              ))}
          </details>
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('fdu-ai-context', {
                  detail: `请根据资料“${selected.name}”生成复习任务，先给我草稿。资料片段：${selected.text.slice(0, 4000)}`,
                }),
              )
            }
          >
            生成复习任务
          </button>
        </section>
      )}
      {(busy || progress) && <p role="status">{progress || '正在处理资料…'}</p>}
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
  const missing = (data.state.files ?? []).length - count;
  zip.file(
    'files-manifest.json',
    JSON.stringify(
      (data.state.files ?? []).map((file: LibraryFile) => ({
        hash: file.hash,
        name: file.name,
        included: !!zip.file(`files/${file.hash}`),
      })),
      null,
      2,
    ),
  );
  zip.file(
    'manifest.txt',
    `本机原文件 ${count} 份；未包含原文件 ${missing} 份。恢复仅追加任务副本、课程分类和资料索引，不恢复凭据、权限或 AI 操作。`,
  );
  return { blob: await zip.generateAsync({ type: 'blob' }), count, missing };
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
  return {
    data,
    count: content.length,
    missing: records.length - content.length,
    commit: () => blobs.bulkPut(content),
  };
}
