import librarySql from '../../../supabase/migrations/202610310006_library.sql?raw';
import storageSql from '../../../supabase/library-storage.sql?raw';
import type { Snapshot } from '../../client/src/client.ts';
import { useState } from 'react';
import tasksSql from '../../../supabase/migrations/202610310001_fdu_tasks.sql?raw';
import catalogSql from '../../../supabase/migrations/202610310002_personal_catalog.sql?raw';
import learningSql from '../../../supabase/migrations/202610310003_elearning.sql?raw';
import syncSql from '../../../supabase/migrations/202610310005_sync_code.sql?raw';
import aiSql from '../../../supabase/migrations/202610310004_ai_quota.sql?raw';
export function SetupGuide({ snapshot }: { snapshot: Snapshot }) {
  const [script, setScript] = useState('001'),
    [message, setMessage] = useState('');
  const sql = (
    {
      '001': tasksSql,
      '002': catalogSql,
      '003': learningSql,
      '004': aiSql,
      '005': syncSql,
      '006': librarySql,
      Storage: storageSql,
    } as Record<string, string>
  )[script]!;
  return (
    <section className="setup-guide">
      <h3>连接向导</h3>
      <p>可以先关闭此窗口使用本机任务。跨设备同步按下面顺序完成。</p>
      <ol>
        <li>
          <b>准备自己的 Supabase 项目 {snapshot.configured ? '✓' : ''}</b>
          <p>
            用 Supabase 网站账号登录后台，打开已有项目。在项目 Connect／API 设置复制 Project URL 和
            publishable（或 anon）公开密钥，填入下方。应用内不需要注册或邮箱登录。
          </p>
          <details>
            <summary>查看／复制初始化脚本</summary>
            <p>
              先备份并确认这是本人的项目。只执行尚未执行过的脚本，004 用于手机
              AI。执行结果确认成功后再执行下一项。
            </p>
            <select
              aria-label="初始化脚本"
              value={script}
              onChange={(e) => {
                setScript(e.target.value);
                setMessage('');
              }}
            >
              {[
                ['001', '任务基础'],
                ['002', '课程与偏好'],
                ['003', 'eLearning'],
                ['004', 'AI配额'],
                ['005', '同步码连接'],
                ['006', '资料元数据'],
                ['Storage', '私有文件存储（按需）'],
              ].map(([id, label]) => (
                <option value={id} key={id}>
                  {id} · {label}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(sql)
                  .then(() => setMessage('已复制，请到 SQL Editor 审阅后执行'))
                  .catch(() => setMessage('请选中文本框内容手动复制'))
              }
            >
              复制当前脚本
            </button>
            <textarea aria-label="初始化 SQL" readOnly value={sql} rows={5} />
            <p role="status">{message}</p>
          </details>
        </li>
        <li>
          <b>初始化云端数据</b>
          <p>
            在 SQL Editor 按顺序执行项目提供的 001、002、003、005
            迁移；已执行的不再重复执行。当前应用不会自动修改生产数据库。
          </p>
        </li>
        <li>
          <b>用同步码连接 {snapshot.connected ? '✓' : ''}</b>
          <p>
            首次部署时生成一份同步码，将对应哈希保存为服务端 Secret：FDU_SYNC_CODE_HASH，并部署
            sync-session 函数和 005
            迁移。电脑和手机填写同一个同步码即可进入同一份个人数据；同步码不保存在任务或备份中。
          </p>
          <p>
            同步码生成工具位于项目 scripts/New-SyncCode.ps1。FDU_OWNER_ID
            是内部固定数据标识：已有数据时保留原值；新空间可用生成工具给出的
            UUID。首次连接由服务端准备内部身份，无需注册或收邮件。
          </p>
        </li>
        <li>
          <b>连接 eLearning {snapshot.learning.last_success_at ? '✓' : ''}</b>
          <p>
            在 eLearning → 账户 → 设置生成访问 Token。在 Supabase 的 Edge Function Secrets 设置
            FDU_CANVAS_TOKEN，以及同步空间固定标识 FDU_OWNER_ID，然后部署项目中的 elearning
            函数。完成后点“连接／刷新 eLearning”。
          </p>
        </li>
      </ol>
      <p>本机 Token 验证成功只说明学校接口可用；完成云端配置后，课程才会进入应用。</p>
      <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
        打开 Supabase 后台 ↗
      </a>{' '}
      ·{' '}
      <a href="https://elearning.fudan.edu.cn/profile/settings" target="_blank" rel="noreferrer">
        打开 eLearning 设置 ↗
      </a>
    </section>
  );
}
