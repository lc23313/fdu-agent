import { useMemo, useRef, useState } from 'react';
import { Modal } from './Modal.tsx';
import { readScheduleExcel, type ScheduleWorkbook } from '../../study/src/excel.ts';
import { previewScheduleImport } from '../../study/src/import.ts';
import type { StudyData, StudyTask } from '../../study/src/model.ts';
import type { StudyCommand } from '../../study/src/commands.ts';

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function StudyExcelImport({
  data,
  close,
  run,
}: {
  data: StudyData;
  close: () => void;
  run: (c: StudyCommand) => Promise<boolean>;
}) {
  const [book, setBook] = useState<ScheduleWorkbook | null>(null),
    [fileName, setFileName] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [settings, setSettings] = useState<
    Record<string, { mode: StudyTask['mode']; category: string; focus_minutes: number }>
  >({});
  const generation = useRef(0);
  const sheet = book?.sheets[sheetIndex];
  const entries = sheet?.entries ?? [];
  const preview = useMemo(() => {
    try {
      return { result: previewScheduleImport(entries, data, settings), error: '' };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [entries, data, settings]);
  const result = preview.result;
  const names = [...new Set(entries.map((e) => e.name))];
  const newNames = names.filter(
    (name) => !Object.values(data.tasks).some((t) => t.name.trim() === name.trim()),
  );
  return (
    <Modal title="从 Excel 导入预设安排" close={close} wide className="study-import-modal">
      <p>
        只导入绿色单元格中的安排，白色区域保持空白。选择 .xlsx
        周表后核对时间再导入，文件在本机解析。
      </p>
      <label className="study-file-picker">
        选择 Excel 文件
        <input
          aria-label="选择 Excel 文件"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const current = ++generation.current;
            setBusy(true);
            setError('');
            setBook(null);
            setFileName(file.name);
            try {
              if (!/\.xlsx$/i.test(file.name))
                throw new Error('请选择 .xlsx 文件；旧版 .xls 请先另存为 .xlsx');
              if (file.size > 10000000) throw new Error('请选择 10 MB 以内的周表');
              const workbook = await readScheduleExcel(await file.arrayBuffer());
              if (generation.current === current) {
                setBook(workbook);
                setSheetIndex(0);
                setSettings({});
              }
            } catch (err) {
              if (generation.current === current)
                setError(err instanceof Error ? err.message : String(err));
            } finally {
              if (generation.current === current) setBusy(false);
            }
          }}
        />
      </label>
      {busy && <p role="status">正在处理…</p>}
      {(error || preview.error) && (
        <p className="error" role="alert">
          {error || preview.error}
        </p>
      )}
      {book && sheet && (
        <>
          <div className="study-import-source">
            <strong>{fileName}</strong>
            <label>
              工作表
              <select
                aria-label="导入工作表"
                value={sheetIndex}
                onChange={(e) => {
                  setSheetIndex(Number(e.target.value));
                  setError('');
                }}
              >
                {book.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            仅导入周表内容。右侧 Todo
            目标、数字和完成标记不会生成学习记录。原任务名称会保留，相同名称共用配置。
          </p>
          {sheet.breaks.length > 0 && (
            <p className="muted">
              已展开
              {sheet.breaks.map((b) => `${b.name} ${time(b.start)}—${time(b.end)}`).join('、')}
              的时间刻度，不自动创建安排。
            </p>
          )}
          {result && (
            <>
              <div className="study-import-counts">
                <span>
                  <strong>{result.blocks.length}</strong> 可导入时间块
                </span>
                <span>
                  <strong>{result.tasks.length}</strong> 新任务
                </span>
                <span>
                  <strong>{result.duplicates.length}</strong> 已有相同安排
                </span>
                <span>
                  <strong>{result.conflicts.length}</strong> 时间冲突
                </span>
              </div>
              {newNames.length > 0 && (
                <details className="study-import-config">
                  <summary>设置新任务的打卡方式与分类（默认计时，可逐项修改）</summary>
                  {newNames.map((name) => {
                    const config = settings[name] ?? {
                      mode: 'timer' as const,
                      category: '',
                      focus_minutes: 25,
                    };
                    return (
                      <div className="study-import-task" key={name}>
                        <strong>{name}</strong>
                        <label>
                          打卡方式
                          <select
                            aria-label={`${name}打卡方式`}
                            value={config.mode}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                [name]: { ...config, mode: e.target.value as StudyTask['mode'] },
                              })
                            }
                          >
                            <option value="timer">计时模式</option>
                            <option value="complete">完成模式</option>
                          </select>
                        </label>
                        <label>
                          分类
                          <input
                            aria-label={`${name}分类`}
                            value={config.category}
                            maxLength={100}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                [name]: { ...config, category: e.target.value },
                              })
                            }
                          />
                        </label>
                        {config.mode === 'timer' && (
                          <label>
                            专注分钟
                            <input
                              type="number"
                              min={1}
                              max={360}
                              aria-label={`${name}默认专注分钟`}
                              value={config.focus_minutes}
                              onChange={(e) =>
                                setSettings({
                                  ...settings,
                                  [name]: { ...config, focus_minutes: Number(e.target.value) },
                                })
                              }
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </details>
              )}
              <div className="study-import-table-wrap">
                <table className="study-import-table">
                  <caption>待导入的预设时间块</caption>
                  <thead>
                    <tr>
                      <th>星期</th>
                      <th>时间</th>
                      <th>任务</th>
                      <th>时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.blocks]
                      .sort((a, b) => a.day - b.day || a.start - b.start)
                      .map((b) => (
                        <tr key={b.id}>
                          <td>{days[b.day]}</td>
                          <td>
                            {time(b.start)}—{time(b.end)}
                          </td>
                          <td>{result.data.tasks[b.task_id]?.name}</td>
                          <td>{b.end - b.start} 分钟</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {result.conflicts.length > 0 && (
                <details open className="study-import-issues">
                  <summary>{result.conflicts.length} 个时间块有冲突，将跳过，已有安排保留</summary>
                  {result.conflicts.map(({ entry, existing }, i) => (
                    <p key={i}>
                      {days[entry.day]} {time(entry.start)}—{time(entry.end)}「{entry.name}」与「
                      {existing}」重叠（{entry.source}）
                    </p>
                  ))}
                </details>
              )}
              {result.duplicates.length > 0 && (
                <p>已存在的 {result.duplicates.length} 个相同时间块不会重复导入。</p>
              )}
              {(sheet.warnings.length > 0 || book.ignored.length > 0) && (
                <details>
                  <summary>解析说明与跳过项</summary>
                  {[...sheet.warnings, ...book.ignored].map((message, i) => (
                    <p key={i}>{message}</p>
                  ))}
                </details>
              )}
              <div className="study-import-actions">
                <button
                  className="primary"
                  disabled={busy || !result.blocks.length}
                  title={
                    result.blocks.length
                      ? '确认导入预览中的无冲突安排'
                      : result.duplicates.length
                        ? '这些安排已经存在，无需重复导入'
                        : '没有可以新增的安排，请查看解析说明或时间冲突'
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      if (await run(result.command)) close();
                      else
                        setError(
                          '导入未完成。请核对页面错误；若预设安排已变化，请重新预览后再导入。',
                        );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  导入 {result.blocks.length} 个无冲突时间块
                </button>
                <button disabled={busy} onClick={close}>
                  取消
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
