import { useState } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { learningErrorMessage, type LearningDiagnostic } from '../../elearning/src/schema.ts';

export function LearningConnection({
  api,
  snapshot,
  refresh,
}: {
  api: ClientApi;
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<LearningDiagnostic | null>(null);
  const [error, setError] = useState('');
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
          {snapshot.learningSyncing ? '读取中…' : '刷新 eLearning'}
        </button>
        <button
          disabled={!snapshot.connected || busy || snapshot.learningSyncing}
          onClick={() => {
            setBusy(true);
            setError('');
            setReport(null);
            void api
              .diagnoseElearning()
              .then(setReport)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '诊断中…' : '连接诊断'}
        </button>
      </div>
      {!snapshot.connected && <p>先到设置与同步，用同步码连接云端。</p>}
      {message && (
        <p className="notice" role="status">
          {learningErrorMessage(message)} · 保留已有课程与个人任务。
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="notice" role="status" aria-label="eLearning 诊断结果">
          <p>电脑／手机 → Supabase：已连接；云端 → 学校 API：{report.ok ? '通过' : '未通过'}。</p>
          <p>{report.message}</p>
          <small>
            结果：{report.code} · 执行区域：{report.region} ·{' '}
            {new Date(report.checked_at).toLocaleString('zh-CN')}
          </small>
          <p>诊断仅检查学校身份接口，不读取课程、不导入任务。可把以上结果发给我排查。</p>
        </div>
      )}
    </div>
  );
}
