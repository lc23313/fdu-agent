import { useEffect, useState } from 'react';
import type { LearningDiagnostic } from '../../elearning/src/schema.ts';

export type DesktopLearningApi = {
  status: () => Promise<{ configured: boolean }>;
  configure: (token: string) => Promise<void>;
  refresh: () => Promise<void>;
  diagnose: () => Promise<LearningDiagnostic>;
};
export function LearningTokenSetup({ desktop }: { desktop?: DesktopLearningApi }) {
  const [message, setMessage] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (desktop)
      void desktop
        .status()
        .then((value) => setConfigured(value.configured))
        .catch(() => setMessage('无法读取本机凭据状态'));
  }, [desktop]);
  if (!desktop)
    return (
      <p className="learning-token-setup">
        学校数据由 Windows
        本机读取并同步。手机只更新云端课程缓存；电脑关闭时不会获取学校新数据。Token 请在 Windows
        客户端配置。
      </p>
    );
  return (
    <details className="learning-token-setup">
      <summary>配置／更换本机 eLearning Token</summary>
      <p>
        {configured ? '本机 Token 已保存。' : '本机尚未保存 Token。'} Token 使用 Windows
        系统安全存储加密，不进入同步数据、日志或备份。
      </p>
      <p>
        <a href="https://elearning.fudan.edu.cn/profile/settings" target="_blank" rel="noreferrer">
          打开 eLearning 账户设置 ↗
        </a>
        ，复制创建时显示的完整原始值。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const token = String(new FormData(form).get('token'));
          form.reset();
          setSaving(true);
          setMessage('');
          void desktop
            .configure(token)
            .then(() => {
              setConfigured(true);
              setMessage('本机 Token 已加密保存。先做本机诊断，再点击“本机读取并同步”。');
            })
            .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
            .finally(() => setSaving(false));
        }}
      >
        <label>
          本机 eLearning Token
          <input
            aria-label="本机 eLearning Token"
            name="token"
            type="password"
            autoComplete="off"
            maxLength={4096}
            required
          />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? '保存中…' : '加密保存到本机'}
        </button>
      </form>
      <button
        type="button"
        disabled={saving || !configured}
        onClick={() => {
          setSaving(true);
          void desktop
            .configure('')
            .then(() => {
              setConfigured(false);
              setMessage('本机 Token 已清除，已同步的课程缓存仍保留。');
            })
            .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
            .finally(() => setSaving(false));
        }}
      >
        清除本机 Token
      </button>
      <p>
        只填 Token 本身，不加引号或 Bearer 前缀。保存后输入框立即清空；Supabase 的公开 key 和旧校园
        Secret 不用于本机读取。
      </p>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
