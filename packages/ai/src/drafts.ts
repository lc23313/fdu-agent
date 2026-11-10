import { z } from 'zod';
import { taskPatchSchema, newTaskFields, type Task } from '../../core/src/task.ts';
import { projectTask } from '../../sync/src/replica.ts';
import type { Store, ReplicaState } from '../../sync/src/types.ts';
export const proposalSchema = z
  .object({
    reply: z.string().max(16000),
    plan_title: z.string().max(200).optional(),
    operations: z
      .array(
        z.discriminatedUnion('action', [
          z
            .object({
              action: z.literal('create'),
              local_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
              parent_ref: z.string().max(80).optional(),
              patch: taskPatchSchema.refine((p) => !!p.title, '新任务必须有标题'),
            })
            .strict(),
          z.object({ action: z.literal('patch'), id: z.uuid(), patch: taskPatchSchema, parent_ref: z.string().max(80).optional() }).strict(),
          z.object({ action: z.literal('delete'), id: z.uuid() }).strict(),
        ]),
      )
      .max(50),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type Draft = {
  id: string;
  proposal: Proposal;
  base: Record<string, Task>;
  status: 'pending' | 'applied' | 'cancelled' | 'undone';
  applied?: Record<string, Task | null>;
  created_at: string;
};
export type AiState = ReplicaState & {
  aiDrafts?: Draft[];
  catalog?: {
    courses: { id: string; name: string }[];
    theme: string;
    plans: { id: string; title: string; task_ids: string[] }[];
  };
  catalogDirty?: boolean;
};
export async function stageDraft(store: Store, input: unknown) {
  const proposal = proposalSchema.parse(input);
  return store.update((s) => {
    const state = s as AiState;
    const base: Record<string, Task> = {};
    const targets = proposal.operations.filter((o) => o.action !== 'create').map((o) => o.id);
    if (new Set(targets).size !== targets.length) throw new Error('同一任务的变更请合并为一项');
    for (const op of proposal.operations)
      if (op.action !== 'create') {
        const t = projectTask(state, op.id);
        if (!t || t.deleted_at) throw new Error('草稿引用的任务不存在');
        base[op.id] = t;
      }
    const drafts = state.aiDrafts ?? [];
    if (drafts.filter((d) => d.status === 'pending').length >= 20)
      throw new Error('请先确认或放弃已有草稿');
    const draft: Draft = {
      id: crypto.randomUUID(),
      proposal,
      base,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    state.aiDrafts = [...drafts.filter((d) => d.status === 'pending').slice(-19), draft];
    return draft;
  });
}
export async function decideDraft(store: Store, id: string, confirm: boolean, edited?: unknown) {
  return store.update((s) => {
    const state = s as AiState;
    const draft = state.aiDrafts?.find((d) => d.id === id);
    if (!draft) throw new Error('草稿不存在');
    if (draft.status === 'applied') return;
    if (draft.status === 'cancelled') throw new Error('草稿已放弃');
    if (draft.status === 'undone') throw new Error('此草稿已撤销，请重新生成');
    if (!confirm) {
      draft.status = 'cancelled';
      return;
    }
    const proposal = edited === undefined ? draft.proposal : proposalSchema.parse(edited);
    if (proposal.operations.some((op) => op.action !== 'create' && !draft.base[op.id])) throw new Error('编辑草稿不能引用预览之外的任务，请重新生成');
    for (const [taskId, base] of Object.entries(draft.base))
      if (
        JSON.stringify(projectTask(state, taskId)) !== JSON.stringify(base) ||
        state.conflicts.some((c) => c.entity_id === taskId)
      )
        throw new Error('任务已发生变化，请重新生成草稿');
    const created: string[] = [];
    const refs = new Map<string, string>();
    for (const op of proposal.operations) if (op.action === 'create' && op.local_id) {
      if (refs.has(op.local_id)) throw new Error('草稿临时标识重复');
      refs.set(op.local_id, crypto.randomUUID());
    }
    const remaining = [...proposal.operations];
    const ordered: typeof remaining = [];
    const done = new Set<string>();
    while (remaining.length) {
      const index = remaining.findIndex((op) => !('parent_ref' in op) || !op.parent_ref || done.has(op.parent_ref));
      if (index < 0) throw new Error('子任务引用不存在或形成循环');
      const op = remaining.splice(index, 1)[0]!; ordered.push(op);
      if (op.action === 'create' && op.local_id) done.add(op.local_id);
    }
    for (const op of ordered) {
      const entity = op.action === 'create' ? (op.local_id ? refs.get(op.local_id)! : crypto.randomUUID()) : op.id;
      const patch =
        op.action === 'create'
          ? { ...newTaskFields(op.patch.title!), ...op.patch }
          : op.action === 'patch'
            ? op.patch
            : undefined;
      if (patch && 'parent_ref' in op && op.parent_ref) {
        const parent = refs.get(op.parent_ref); if (!parent) throw new Error('新父任务引用不存在'); patch.parent_id = parent;
      }
      if (
        patch?.course_id &&
        ![
          ...(state.catalog?.courses ?? []),
          ...((state as AiState & { learning?: { courses: { id: string }[] } }).learning?.courses ??
            []),
        ].some((c) => c.id === patch.course_id)
      )
        throw new Error('课程不存在');
      state.pending.push({
        local_id: crypto.randomUUID(),
        entity_id: entity,
        action: op.action,
        patch,
        base: state.shadow[entity] ?? null,
        created_at: new Date().toISOString(),
        request: null,
        blocked: false,
      });
      if (op.action === 'create') created.push(entity);
    }
    draft.proposal = proposal;
    const ids = new Set([...Object.keys(state.shadow), ...state.pending.map((p) => p.entity_id)]);
    for (const taskId of ids) {
      let t = projectTask(state, taskId);
      if (!t || t.deleted_at) continue;
      if (t.start_at && t.due_at && Date.parse(t.start_at) > Date.parse(t.due_at))
        throw new Error('截止时间不能早于开始时间');
      const seen = new Set([taskId]);
      while (t.parent_id) {
        if (seen.has(t.parent_id)) throw new Error('子任务不能形成循环');
        seen.add(t.parent_id);
        const parent = projectTask(state, t.parent_id);
        if (!parent) throw new Error('父任务不存在');
        t = parent;
      }
    }
    if (draft.proposal.plan_title && created.length) {
      const catalog = state.catalog ?? { courses: [], theme: 'system', plans: [] };
      catalog.plans.push({
        id: crypto.randomUUID(),
        title: draft.proposal.plan_title,
        task_ids: created,
      });
      state.catalog = catalog;
      state.catalogDirty = true;
    }
    draft.status = 'applied';
    draft.applied = Object.fromEntries([...created,...Object.keys(draft.base)].map((id)=>[id,projectTask(state,id)]));
  });
}
export async function undoDraft(store:Store,id:string) {
  return store.update((s)=>{
    const state=s as AiState,draft=state.aiDrafts?.find((d)=>d.id===id);
    if(!draft||draft.status!=='applied'||!draft.applied)throw new Error('此批变更已经不能撤销');
    const fields=Object.keys(newTaskFields('x')).concat(['time_kind','repeat']);
    for(const [key,after] of Object.entries(draft.applied)){
      const current=projectTask(state,key);
      if(!current||!after||!!current.deleted_at!==!!after.deleted_at||fields.some((f)=>JSON.stringify(current[f as keyof Task]??null)!==JSON.stringify(after[f as keyof Task]??null)))throw new Error('任务后来又有变更，请手动核对，未执行撤销');
    }
    for(const [key,after] of Object.entries(draft.applied)){
      const before=draft.base[key];
      state.pending.push({local_id:crypto.randomUUID(),entity_id:key,action:!before?'delete':after?.deleted_at?'restore':'patch',...(before&&!after?.deleted_at?{patch:Object.fromEntries(fields.filter((f)=>f in before).map((f)=>[f,before[f as keyof Task]]))}:{}),base:state.shadow[key]??null,request:null,created_at:new Date().toISOString(),blocked:false});
    }
    draft.status='undone';
  });
}
