import { z } from 'zod';
export const canvasOrigin = 'https://elearning.fudan.edu.cn';
export function learningErrorMessage(code: string): string {
  if (code === 'TOKEN_EXPIRED' || code === 'AUTH_REJECTED')
    return '学校 API 拒绝了当前请求的认证（401），不能据此判断 Token 已过期。请用同一 Token 做本机参考验证，并核对本机保存的完整 Token。';
  return (
    {
      NETWORK_ERROR: '无法连接复旦 eLearning，请检查本机网络并运行本机连接诊断。',
      DNS_ERROR: '无法解析复旦 eLearning 域名，请检查本机网络。',
      TLS_ERROR: '与复旦 eLearning 的 HTTPS 连接失败，请检查本机网络；不要关闭证书校验。',
      REQUEST_TIMEOUT:
        '读取复旦 eLearning 超时。请稍后重试，并用本机连接诊断检查学校 API 是否可达。',
      REDIRECTED:
        '学校 API 返回了跳转，未继续发送 Token。请用连接诊断检查；网页登录成功不能代替 API 认证。',
      TOKEN_CONFIG_INVALID:
        'eLearning Token 配置格式不正确：请填写原始 Token，去掉 Bearer 前缀及包裹的引号。',
      FORBIDDEN: '学校 API 拒绝访问（403）。请核对 Token 的读取权限和学校当前访问限制。',
      RATE_LIMITED: '学校 API 暂时限制访问，请等待后再刷新，不要连续点击。',
      CONNECTOR_DATABASE_ERROR:
        '云端课程数据读写失败，请检查 003 迁移及 elearning 函数日志；保留已有数据。',
      '无法连接复旦 eLearning':
        'Supabase 云端无法连接复旦 eLearning。请更新 elearning 函数后运行连接诊断，进一步区分超时、域名或 HTTPS 错误。',
    }[code] ??
    (/^HTTP_\d+$/.test(code) ? `学校 API 返回 HTTP ${code.slice(5)}，请稍后重试。` : code)
  );
}
export const learningDiagnosticSchema = z.object({
  kind: z.literal('fdu-elearning-diagnostic-v1'),
  checked_at: z.iso.datetime(),
  region: z.string().max(80),
  ok: z.boolean(),
  code: z.string().max(200),
  message: z.string().max(1000),
  auth_evidence: z
    .object({
      http_status: z.number().int(),
      challenge_present: z.boolean(),
      response_type: z.enum(['json', 'html', 'other']),
    })
    .optional(),
});
export type LearningDiagnostic = z.infer<typeof learningDiagnosticSchema>;
const stamp = z.iso.datetime({ offset: true });
export const assignmentImportSchema = z.object({
  external_id: z.string().regex(/^\d+$/),
  original_title: z.string().min(1).max(200),
  original_description: z.string().max(20000),
  original_due_at: stamp.nullable(),
  submission_state: z.enum(['unknown', 'unsubmitted', 'submitted', 'pending_review', 'graded']),
  submitted_at: stamp.nullable(),
  grading_state: z.enum(['unknown', 'ungraded', 'pending_review', 'graded']),
  official_url: z.url().refine((v) => new URL(v).origin === canvasOrigin),
});
export const courseImportSchema = z.object({
  external_id: z.string().regex(/^\d+$/),
  name: z.string().min(1).max(200),
  code: z.string().max(200),
  workflow_state: z.string().max(40),
  assignments: z.array(assignmentImportSchema).max(5000).nullable(),
  error: z.string().max(200).nullable(),
});
export type CourseImport = z.infer<typeof courseImportSchema>;
export const materialImportSchema = z
  .strictObject({
    external_id: z.string().regex(/^\d+$/),
    course_external_id: z.string().regex(/^\d+$/),
    name: z.string().min(1).max(200),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    official_url: z.url(),
  })
  .refine(
    (v) =>
      v.official_url === `${canvasOrigin}/courses/${v.course_external_id}/files/${v.external_id}`,
    '资料链接必须指向对应的复旦官方文件',
  );
export const learningImportSchema = z.strictObject({
  identity: z.string().regex(/^\d+$/),
  courses: z.array(courseImportSchema).max(200),
  materials: z.array(materialImportSchema).max(5000).default([]),
  materials_partial: z.boolean().default(false),
});
export type LearningImport = z.infer<typeof learningImportSchema>;
export const learningSchema = z.object({
  courses: z.array(
    z.object({
      id: z.uuid(),
      external_id: z.string(),
      name: z.string(),
      code: z.string(),
      workflow_state: z.string(),
      availability: z.string(),
      error: z.string().nullable(),
      last_success_at: stamp.nullable(),
    }),
  ),
  assignments: z.array(
    assignmentImportSchema.extend({
      id: z.uuid(),
      course_id: z.uuid(),
      task_id: z.uuid(),
      available: z.boolean(),
      last_success_at: stamp,
    }),
  ),
  last_success_at: stamp.nullable(),
  error: z.string().nullable().default(null),
});
export type Learning = z.infer<typeof learningSchema>;
export const emptyLearning = (): Learning => ({
  courses: [],
  assignments: [],
  last_success_at: null,
  error: null,
});
export const submissionLabel = (value: string) =>
  ({
    unknown: '未知',
    unsubmitted: '尚未提交',
    submitted: '已提交',
    pending_review: '等待审核',
    graded: '已评分',
  })[value] ?? '未知';
