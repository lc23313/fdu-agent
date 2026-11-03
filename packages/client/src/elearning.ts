import { z } from 'zod';
import { learningErrorMessage } from '../../elearning/src/schema.ts';

export async function learningFunctionError(error: unknown, diagnose = false): Promise<Error> {
  const context = (error as { context?: Response } | null)?.context;
  if (context instanceof Response) {
    if (diagnose && context.status === 400)
      return new Error('云端尚未提供连接诊断，请先重新部署本项目最新版 elearning 函数。');
    const parsed = z
      .object({ error: z.string(), code: z.string().optional() })
      .safeParse(await context.json().catch(() => null));
    if (parsed.success)
      return new Error(learningErrorMessage(parsed.data.code ?? parsed.data.error));
    return new Error(
      context.status === 401
        ? '同步连接已失效，请重新输入同步码。'
        : context.status === 404
          ? '云端未找到 elearning 函数，请检查项目并部署函数。'
          : context.status === 429
            ? '刷新过于频繁，请至少等待一分钟再试。'
            : `eLearning 云端接口返回 HTTP ${context.status}，请检查函数日志。`,
    );
  }
  return new Error('电脑／手机未能取得 Supabase eLearning 接口响应，请检查本机网络和函数部署。');
}
