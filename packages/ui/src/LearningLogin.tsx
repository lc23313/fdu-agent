import { useEffect, useState } from 'react';
import type { LearningDiagnostic } from '../../elearning/src/schema.ts';

export type DesktopLearningApi = {
  status: () => Promise<{ loggedIn: boolean; message?: string }>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  diagnose: () => Promise<LearningDiagnostic>;
};
export function LearningLogin({
  desktop,
  syncing = false,
}: {
  desktop?: DesktopLearningApi;
  syncing?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(Boolean(desktop));
  useEffect(() => {
    let active = true;
    if (desktop)
      void desktop
        .status()
        .then((status) => {
          if (active) {
            setLoggedIn(status.loggedIn);
            setMessage(status.message || '');
          }
        })
        .catch(() => {
          if (active) setMessage('无法验证学校登录状态，可运行本机连接诊断。');
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    return () => {
      active = false;
    };
  }, [desktop]);
  if (!desktop)
    return (
      <p className="learning-token-setup">
        学校数据由 Windows 本机通过 UIS 登录读取。手机只同步课程缓存；电脑关闭时不会获取学校新数据。
      </p>
    );
  return (
    <section className="learning-token-setup" aria-label="学校网页登录">
      <p>
        {busy
          ? '正在检查或等待学校登录…'
          : loggedIn
            ? 'eLearning 登录已验证。'
            : '尚未通过 eLearning 登录验证。'}
      </p>
      <p>
        点击下方按钮，在复旦官方 UIS 页面手动登录，并进入
        eLearning。成功后窗口自动关闭，再点击“本机读取并同步”。
      </p>
      <div className="view-tabs">
        <button
          type="button"
          disabled={busy || syncing}
          onClick={() => {
            setBusy(true);
            setMessage('请在官方窗口完成登录；关闭窗口可取消。');
            void desktop
              .login()
              .then(() => {
                setLoggedIn(true);
                setMessage('网页登录成功，可以本机读取并同步课程。');
              })
              .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}
        >
          {loggedIn ? '重新登录 UIS' : '登录复旦 UIS'}
        </button>
        <button
          type="button"
          disabled={busy || syncing}
          onClick={() => {
            setBusy(true);
            setMessage('');
            void desktop
              .logout()
              .then(() => {
                setLoggedIn(false);
                setMessage('已退出本机学校登录，课程缓存和个人任务仍保留。');
              })
              .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}
        >
          退出学校登录
        </button>
      </div>
      <p>
        无需填写校园 Token 或把密码发给
        Agent。登录会话仅在这台电脑保存，不进入同步、日志或备份。登录失效时重新登录；本按钮不会退出你的普通浏览器。
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
