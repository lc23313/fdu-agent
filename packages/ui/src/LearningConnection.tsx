import { useState, useEffect, useRef } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import {
  learningErrorMessage,
  learningDiagnosticSchema,
  type LearningDiagnostic,
} from '../../elearning/src/schema.ts';
import { LearningLogin, type DesktopLearningApi } from './LearningLogin.tsx';

export function LearningConnection({
  api,
  snapshot,
  refresh,
  desktop,
}: {
  api: ClientApi;
  snapshot: Snapshot;
  refresh: () => void;
  desktop?: DesktopLearningApi;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<LearningDiagnostic | null>(() => {
    try {
      return learningDiagnosticSchema.parse(
        JSON.parse(
          localStorage.getItem(`fdu-learning-diagnostic:${desktop ? 'desktop' : 'cache'}`) ??
            'null',
        ),
      );
    } catch {
      return null;
    }
  });
  const [auto, setAuto] = useState(() => localStorage.getItem('fdu-elearning-auto') === 'yes');
  const attempted = useRef(0),
    refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (report)
      localStorage.setItem(
        `fdu-learning-diagnostic:${desktop ? 'desktop' : 'cache'}`,
        JSON.stringify(report),
      );
  }, [report, desktop]);
  useEffect(() => {
    if (!desktop || !auto || !snapshot.connected) return;
    const tick = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine || snapshot.learningSyncing)
        return;
      const last = Date.parse(snapshot.learning.last_success_at ?? '') || 0;
      if (Date.now() - Math.max(last, attempted.current) > 30 * 60 * 1000) {
        attempted.current = Date.now();
        refreshRef.current();
      }
    };
    const timer = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [
    auto,
    desktop,
    snapshot.connected,
    snapshot.learningSyncing,
    snapshot.learning.last_success_at,
  ]);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = () => setAuto(localStorage.getItem('fdu-elearning-auto') === 'yes');
    window.addEventListener('fdu-learning-preference', changed);
    return () => window.removeEventListener('fdu-learning-preference', changed);
  }, []);
  const message = snapshot.learningError || snapshot.learning.error;
  return (
    <div className="learning-status">
      <small>
        {snapshot.learning.last_success_at
          ? `课程更新于 ${new Date(snapshot.learning.last_success_at).toLocaleString('zh-CN')}`
          : '尚未成功读取学校课程'}
      </small>
      <div className="view-tabs">
        <button
          disabled={!snapshot.connected || snapshot.learningSyncing || busy}
          onClick={refresh}
        >
          {snapshot.learningSyncing ? '读取中…' : desktop ? '本机读取并同步' : '同步课程缓存'}
        </button>
      </div>
      <details className="learning-options">
        <summary>连接与诊断</summary>
        <div className="view-tabs">
          <button
            disabled={!snapshot.connected || busy || snapshot.learningSyncing}
            onClick={() => {
              setBusy(true);
              setError('');
              setReport(null);
              void (desktop ? desktop.diagnose() : api.diagnoseElearning())
                .then(setReport)
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? '诊断中…' : desktop ? '本机连接诊断' : '缓存连接诊断'}
          </button>
        </div>
        <LearningLogin desktop={desktop} syncing={snapshot.learningSyncing} />
        {desktop && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                localStorage.setItem('fdu-elearning-auto', e.target.checked ? 'yes' : 'no');
                window.dispatchEvent(new Event('fdu-learning-preference'));
              }}
            />
            电脑在线时每 30 分钟更新课程
          </label>
        )}
        {!snapshot.connected && <p>先到设置与同步，用同步码连接云端。</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <div className="notice" role="status" aria-label="eLearning 诊断结果">
            <p>
              {desktop ? 'Windows 本机 → 学校 API' : '手机／网页 → Supabase 课程缓存'}：
              {report.ok ? '通过' : '未通过'}。
            </p>
            <p>{report.message}</p>
            <small>
              结果：{report.code} · 执行位置：{report.region} ·{' '}
              {new Date(report.checked_at).toLocaleString('zh-CN')}
            </small>
            <p>
              {desktop ? '本机诊断仅检查学校身份接口，不导入任务。' : '缓存诊断不访问学校 API。'}
              可把以上结果发给我排查。
            </p>
          </div>
        )}
      </details>
      {message && <p className="learning-warning">{learningErrorMessage(message)}</p>}
    </div>
  );
}
