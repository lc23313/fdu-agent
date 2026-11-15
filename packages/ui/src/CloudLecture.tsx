import { useEffect, useRef, useState } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { LectureLive, type LiveLine } from '../../lecture/src/live.ts';
type Recording = {
  id: string;
  title: string;
  name: string;
  mime: string;
  created: string;
  state: string;
  seq: number;
  bytes: number;
  duration: number;
  mode?: string;
  cloudId?: string;
  space?: string;
  live?: [string, LiveLine][];
  realtimeGap?: boolean;
};
type LocalDb = {
  merge: (store: string, id: string, fields: Partial<Recording>) => Promise<void>;
  all: (store: string) => Promise<Recording[]>;
  put: (store: string, value: Recording) => Promise<void>;
  saveAudio: (meta: Recording, blob: Blob) => Promise<unknown>;
  saveChunk: (meta: Recording, blob: Blob, seq: number) => Promise<unknown>;
  audioBlob: (meta: Recording) => Promise<Blob>;
  downloadBlob: (blob: Blob, name: string) => void;
};
type Capture = {
  media: MediaRecorder;
  stream: MediaStream;
  meta: Recording;
  queue: Promise<unknown>;
  live?: LectureLive;
  context?: AudioContext;
  started: number;
  seconds: number;
  end: boolean;
  unsaved: Blob[];
  wake?: WakeLockSentinel;
};
type Job = {
  id: string;
  title: string;
  name: string;
  size: number;
  status: string;
  error: string | null;
  transcript?: string;
};
type Version = { id: string; kind: string; text: string; created_at: string };
const asset = (file: string) =>
  new URL(`${import.meta.env.BASE_URL}lecture/static/${file}`, document.baseURI).href;
const localDb = () => import(/* @vite-ignore */ asset('local-db.js')) as Promise<LocalDb>;
const labels: Record<string, string> = {
  LOCAL: '待上传／提交',
  SUBMITTING: '正在提交',
  PENDING: '排队中',
  RUNNING: '正在识别',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  UNKNOWN: '提交结果待核对',
};
export function CloudLecture({ api, snapshot }: { api: ClientApi; snapshot: Snapshot }) {
  const [recordings, setRecordings] = useState<Recording[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [selected, setSelected] = useState<Job | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [versionId, setVersionId] = useState(''),
    [text, setText] = useState(''),
    [title, setTitle] = useState(''),
    [liveEnabled, setLiveEnabled] = useState(false),
    [recordState, setRecordState] = useState(''),
    [liveState, setLiveState] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [paused, setPaused] = useState(false),
    [saveState, setSaveState] = useState(''),
    [progress, setProgress] = useState('');
  const active = useRef<{
    media: MediaRecorder;
    stream: MediaStream;
    meta: Recording;
    queue: Promise<unknown>;
    live?: LectureLive;
    context?: AudioContext;
    started: number;
    seconds: number;
    end: boolean;
    unsaved: Blob[];
    wake?: WakeLockSentinel;
  } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const editRef = useRef(false),
    captureKey = useRef(''),
    saveKey = useRef(crypto.randomUUID()),
    uploadKeys = useRef(new Map<string, string>());
  const space = snapshot.projectUrl + '#' + snapshot.ownerId;
  const reloadLocal = async () => {
    setRecordings(
      (await (await localDb()).all('recordings'))
        .filter((r) => r.mode === 'cloud')
        .sort((a, b) => b.created.localeCompare(a.created)),
    );
  };
  const call = <T,>(input: unknown) => api.lecture(input) as Promise<T>;
  const list = async () => {
    if (!snapshot.connected) return;
    setJobs(await call<Job[]>({ action: 'list' }));
  };
  const show = async (job: Job) => {
    if (editRef.current && !confirm('当前稿件尚未保存，切换会丢弃编辑。继续？')) return;
    const rows = await call<Version[]>({ action: 'versions', id: job.id });
    selectedRef.current = job;
    setSelected(job);
    setVersions(rows);
    setVersionId(rows[0]?.id || '');
    setText(rows[0]?.text || '');
    editRef.current = false;
    saveKey.current = crypto.randomUUID();
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  useEffect(() => {
    void reloadLocal().catch(() => setNotice('录音存储不可用，请检查浏览器存储权限'));
    void list().catch((e) => setNotice(String(e.message)));
  }, [snapshot.connected, space]);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden || !snapshot.connected || !navigator.onLine) return;
      try {
        const current = selectedRef.current;
        if (!current || !['PENDING', 'RUNNING', 'SUBMITTING'].includes(current.status)) return;
        if (current && ['PENDING', 'RUNNING', 'SUBMITTING'].includes(current.status)) {
          const next = await call<Job>({ action: 'poll', id: current.id });
          if (selectedRef.current?.id !== current.id) return;
          selectedRef.current = next;
          setSelected(next);
          if (next.status === 'SUCCEEDED' && current.status !== 'SUCCEEDED' && !editRef.current) {
            const rows = await call<Version[]>({ action: 'versions', id: next.id });
            if (selectedRef.current?.id === next.id) {
              setVersions(rows);
              setVersionId(rows[0]?.id || '');
              setText(rows[0]?.text || '');
            }
          }
        }
        await list();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    };
    const timer = setInterval(() => void tick(), 8000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [api, snapshot.connected, space]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (active.current || editRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    const visible = () => {
      const s = active.current;
      if (!s) return;
      if (document.hidden) setNotice('请回到前台，锁屏或后台可能中断录音；已保存片段保留');
      else if (s.media.state === 'recording')
        void navigator.wakeLock
          ?.request('screen')
          .then((wake) => {
            s.wake = wake;
          })
          .catch(() => {});
    };
    const online = () => {
      void active.current?.live?.connect();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
      const s = active.current;
      if (s) {
        s.end = true;
        s.media.stop();
        s.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);
  const importAudio = async (file: File) => {
    if (file.size > 50000000)
      throw new Error('免费云转录单文件上限 50 MB，请先分段；原文件不受影响');
    if (!file.size) throw new Error('音频为空');
    const meta: Recording = {
      id: crypto.randomUUID(),
      title: title.trim() || file.name,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      created: new Date().toISOString(),
      state: 'imported',
      seq: 0,
      bytes: 0,
      duration: 0,
      mode: 'cloud',
    };
    await (await localDb()).saveAudio(meta, file);
    await reloadLocal();
    setNotice('已保存到本机。点击该录音的“上传并转录”后才会发送音频。');
  };
  const submit = async (meta: Recording) => {
    if (!snapshot.connected) throw new Error('请先在设置中用同步码连接');
    if (meta.bytes > 50000000) throw new Error('录音超过 50 MB，请导出并分段后上传');
    if (meta.space && meta.space !== space)
      throw new Error('这份录音绑定了另一项目，请保留备份后重新导入');
    if (!confirm(`向本人私有存储上传“${meta.title}”并调用百炼转录？调用可能计费。`)) return;
    const db = await localDb();
    const blob = await db.audioBlob(meta);
    meta.cloudId ||= uploadKeys.current.get(meta.id) || crypto.randomUUID();
    uploadKeys.current.set(meta.id, meta.cloudId);
    meta.space = space;
    await db.put('recordings', meta);
    const created = await call<Job>({
      action: 'create',
      id: meta.cloudId,
      title: meta.title.slice(0, 200),
      name: meta.name.slice(0, 200),
      size: blob.size,
      mime: blob.type.split(';')[0] || 'application/octet-stream',
    });
    if (created.status === 'LOCAL') {
      const { url } = await call<{ url: string }>({ action: 'upload', id: created.id });
      setProgress('正在上传音频，等待存储确认…');
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      });
      if (!response.ok && response.status !== 409)
        throw new Error('音频上传未完成，原音频保留，可重试');
    }
    setProgress('音频上传已确认，正在提交任务…');
    const job = await call<Job>({ action: 'submit', id: created.id });
    setProgress('');
    await list();
    await show(job);
  };
  const start = async () => {
    if (active.current) return;
    if (liveEnabled && !snapshot.connected) throw new Error('实时识别需要先连接同步空间');
    const db = await localDb();
    await navigator.storage?.persist?.();
    const storage = await navigator.storage?.estimate?.();
    if (storage?.quota && storage.quota - (storage.usage || 0) < 30000000)
      throw new Error('存储空间不足，请先导出录音');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error('当前环境不支持录音，请使用 HTTPS Safari 或桌面客户端');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: false,
    });
    try {
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const media = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 },
      );
      const meta: Recording = {
        id: crypto.randomUUID(),
        title: title.trim() || '现场讲座',
        name:
          'lecture.' +
          (media.mimeType.includes('mp4')
            ? 'm4a'
            : media.mimeType.includes('ogg')
              ? 'ogg'
              : 'webm'),
        mime: media.mimeType,
        created: new Date().toISOString(),
        state: 'recording',
        seq: 0,
        bytes: 0,
        duration: 0,
        mode: 'cloud',
        live: [],
      };
      await db.put('recordings', meta);
      const s: Capture = {
        media,
        stream,
        meta,
        queue: Promise.resolve(),
        started: performance.now(),
        seconds: 0,
        end: false,
        unsaved: [],
      };
      active.current = s;
      captureKey.current = meta.id;
      const elapsed = () =>
        s.seconds + (media.state === 'recording' ? (performance.now() - s.started) / 1000 : 0);
      media.ondataavailable = (event) => {
        if (!event.data.size) return;
        const seq = meta.seq++;
        meta.bytes += event.data.size;
        meta.duration = elapsed();
        meta.live = [...(s.live?.lines || [])];
        const copy = structuredClone(meta);
        setSaveState('正在确认保存录音片段…');
        s.queue = s.queue
          .then(() => db.saveChunk(copy, event.data, seq))
          .then(() =>
            setSaveState(`已确认保存 ${seq + 1} 段 · ${(copy.bytes / 1000000).toFixed(1)} MB`),
          )
          .catch(() => {
            s.unsaved.push(event.data);
            if (media.state === 'recording') {
              s.seconds = elapsed();
              media.pause();
              setPaused(true);
            }
            setNotice('录音写入失败，已暂停。请导出未保存片段，保留已有录音。');
          });
      };
      media.onstop = () => {
        void (async () => {
          await s.queue;
          meta.state = 'stopped';
          meta.duration = s.seconds;
          meta.live = [...(s.live?.lines || [])];
          meta.realtimeGap = !!s.live?.gap;
          await db.put('recordings', meta);
          await s.context?.close();
          await s.wake?.release().catch(() => {});
          stream.getTracks().forEach((t) => t.stop());
          setRecording(false);
          setPaused(false);
          setRecordState('录音已结束');
          if (s.unsaved.length) {
            s.unsaved.forEach((blob, i) => db.downloadBlob(blob, `unsaved-${meta.id}-${i}.bin`));
            setNotice('存在未保存片段，请与已有音频一起保留');
          } else setNotice('录音已保存，可导出或主动上传完整转录。');
          active.current = null;
          await reloadLocal();
        })().catch(() => setNotice('结束状态保存失败，请保留页面并导出录音'));
      };
      media.onerror = () => {
        setNotice('麦克风录音出错，正在保存已录内容');
        stop();
      };
      stream.getAudioTracks()[0]!.onended = () => stop();
      media.start(2000);
      setRecording(true);
      setRecordState('正在录音');
      setSaveState('等待首个片段保存');
      setLiveState(liveEnabled ? '正在准备实时识别' : '未开启实时识别，音频仅保存在本机');
      void navigator.wakeLock
        ?.request('screen')
        .then((wake) => {
          s.wake = wake;
        })
        .catch(() => {});
      if (liveEnabled) {
        meta.cloudId = crypto.randomUUID();
        meta.space = space;
        await db.put('recordings', meta);
        try {
          await call({
            action: 'create',
            id: meta.cloudId,
            title: meta.title,
            name: meta.name,
            size: 0,
            mime: meta.mime.split(';')[0],
          });
          if (s.end) return;
          s.live = new LectureLive(
            () => call<{ url: string }>({ action: 'live-ticket', id: meta.cloudId }),
            setLiveState,
            () => {
              meta.live = [...s.live!.lines].sort((a, b) => a[1].start - b[1].start);
              void db
                .merge('recordings', meta.id, { live: meta.live })
                .catch(() => setNotice('实时稿保存失败，请导出文字；音频片段单独保存'));
              if (captureKey.current === meta.id)
                setText(meta.live.map(([, line]) => line.text).join('\n'));
            },
          );
          s.context = new AudioContext();
          await s.context.resume();
          await s.context.audioWorklet.addModule(asset('pcm-worklet.js'));
          if (s.end) {
            await s.context.close();
            return;
          }
          const source = s.context.createMediaStreamSource(stream),
            node = new AudioWorkletNode(s.context, 'pcm16'),
            silent = s.context.createGain();
          silent.gain.value = 0;
          source.connect(node);
          node.connect(silent);
          silent.connect(s.context.destination);
          node.port.onmessage = (event) => {
            if (!s.end && media.state === 'recording')
              s.live?.frame(event.data, elapsed() * 1000 - 100);
          };
          void s.live.connect();
        } catch (e) {
          setLiveState(e instanceof Error ? e.message : '实时服务不可用，本地录音继续');
        }
      }
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
  };
  const stop = () => {
    const s = active.current;
    if (!s || s.end) return;
    s.end = true;
    s.seconds += s.media.state === 'recording' ? (performance.now() - s.started) / 1000 : 0;
    s.live?.finish();
    s.media.stop();
    setRecordState('正在保存最后片段…');
  };
  const pause = () => {
    const s = active.current;
    if (!s) return;
    if (s.media.state === 'recording') {
      s.seconds += (performance.now() - s.started) / 1000;
      s.media.requestData();
      s.media.pause();
      s.live?.pause();
      setPaused(true);
      setRecordState('已暂停');
    } else if (s.media.state === 'paused') {
      if (s.unsaved.length) {
        setNotice('存在未保存片段，请结束并导出后重新录音');
        return;
      }
      s.started = performance.now();
      s.media.resume();
      setPaused(false);
      setRecordState('正在录音');
      void s.live?.connect();
    }
  };
  return (
    <section className="cloud-lecture" aria-label="Supabase 讲座转录">
      <p className="subtitle">
        完整音频异步转录 · 免费版单文件 50 MB · 密钥只存服务端。实时字幕约 100
        秒自动续接，原录音持续保存在本机，锁屏或后台可能中断录音。
      </p>
      {!snapshot.connected && (
        <p className="notice">先在“设置与同步”用原同步码连接；未连接时仍可本地录音和导出。</p>
      )}
      <label>
        讲座标题
        <input
          aria-label="讲座标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </label>
      <div className="view-tabs">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={liveEnabled}
            disabled={recording}
            onChange={(e) => setLiveEnabled(e.target.checked)}
          />
          开启实时识别（发送音频，可能计费）
        </label>
        <button disabled={busy || recording} onClick={() => void run(start)}>
          开始录音
        </button>
        <button disabled={!recording} onClick={pause}>
          {paused ? '继续录音' : '暂停录音'}
        </button>
        <button disabled={!recording} onClick={stop}>
          结束录音
        </button>
      </div>
      <p role="status">
        {recordState} {saveState} {liveState}
      </p>
      <label>
        导入完整音频（先保存本机）
        <input
          aria-label="导入讲座音频"
          type="file"
          accept=".wav,.mp3,.m4a,.mp4,.aac,.flac,.webm,.ogg"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(() => importAudio(file));
          }}
        />
      </label>
      {progress && <p role="status">{progress}</p>}
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <h3>本机录音</h3>
      {recordings.map((meta) => (
        <article className="assignment-row" key={meta.id}>
          <strong>{meta.title}</strong>
          <small>
            {' '}
            · {(meta.bytes / 1000000).toFixed(1)} MB ·{' '}
            {meta.state === 'recording' ? '上次未正常结束，可恢复已保存片段' : '仅本机保存'}
          </small>
          <div className="view-tabs">
            <button disabled={busy || recording} onClick={() => void run(() => submit(meta))}>
              上传并转录
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  const db = await localDb();
                  db.downloadBlob(await db.audioBlob(meta), meta.name);
                })
              }
            >
              导出音频
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  const db = await localDb();
                  db.downloadBlob(
                    new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
                    'recording.json',
                  );
                })
              }
            >
              导出录音信息与实时稿
            </button>
          </div>
        </article>
      ))}
      <h3>云端讲座与稿件</h3>
      <button disabled={busy || !snapshot.connected} onClick={() => void run(list)}>
        刷新讲座
      </button>
      <div className="lecture-jobs">
        {jobs.map((job) => (
          <button disabled={busy} key={job.id} onClick={() => void run(() => show(job))}>
            {job.title} · {labels[job.status] || job.status}
          </button>
        ))}
      </div>
      {selected && (
        <p>
          {selected.title} · {labels[selected.status] || selected.status} {selected.error}
        </p>
      )}
      {selected && (
        <div className="view-tabs">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await call<Job>({ action: 'poll', id: selected.id });
                await show(next);
                await list();
              })
            }
          >
            查询转录结果
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (confirm('删除云端音频原文件？已保存的文字稿和本机录音将保留。')) {
                  await call({ action: 'delete-audio', id: selected.id });
                  setNotice('云端音频已删除，文字稿保留');
                }
              })
            }
          >
            删除云端音频
          </button>
        </div>
      )}
      {!!versions.length && (
        <label>
          稿件版本
          <select
            aria-label="讲座稿件版本"
            value={versionId}
            onChange={(e) => {
              if (editRef.current && !confirm('丢弃未保存编辑并切换版本？')) return;
              setVersionId(e.target.value);
              setText(versions.find((v) => v.id === e.target.value)?.text || '');
              editRef.current = false;
              saveKey.current = crypto.randomUUID();
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.kind === 'filetrans'
                  ? '完整原稿'
                  : v.kind === 'realtime'
                    ? '实时初稿'
                    : '编辑版本'}{' '}
                · {new Date(v.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        讲座文字稿
        <textarea
          aria-label="讲座文字稿"
          readOnly={recording}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            editRef.current = true;
          }}
          rows={14}
        />
      </label>
      <div className="view-tabs">
        <button
          disabled={busy || !selected || !text || recording}
          onClick={() =>
            void run(async () => {
              await call({ action: 'edit', id: selected!.id, key: saveKey.current, text });
              editRef.current = false;
              await show(selected!);
              setNotice('已保存为新版本，原稿保留');
            })
          }
        >
          保存稿件新版本
        </button>
        <button
          disabled={!text}
          onClick={() =>
            void localDb().then((db) =>
              db.downloadBlob(
                new Blob([text], { type: 'text/plain;charset=utf-8' }),
                'lecture.txt',
              ),
            )
          }
        >
          导出 TXT
        </button>
        <button
          disabled={!text}
          onClick={() =>
            void localDb().then((db) =>
              db.downloadBlob(
                new Blob(['# ' + (selected?.title || title || '讲座') + '\n\n' + text], {
                  type: 'text/markdown;charset=utf-8',
                }),
                'lecture.md',
              ),
            )
          }
        >
          导出 Markdown
        </button>
      </div>
    </section>
  );
}
