import { z } from 'zod';
import {
  blockSchema,
  studyTaskSchema,
  validateStudy,
  type StudyData,
  type StudyTask,
  type StudyBlock,
} from './model.ts';
export interface ScheduleEntry {
  name: string;
  day: number;
  start: number;
  end: number;
  source: string;
}
export const scheduleImportSchema = z.object({
  type: z.literal('importSchedule'),
  fingerprint: z.string().max(200000),
  tasks: z.array(studyTaskSchema).max(300),
  blocks: z.array(blockSchema).min(1).max(203),
});
export function scheduleFingerprint(data: StudyData) {
  return JSON.stringify([
    Object.values(data.tasks)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) => [t.id, t.name, t.category, t.mode, t.focus_minutes]),
    Object.values(data.blocks)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => [b.id, b.task_id, b.day, b.start, b.end]),
  ]);
}
export function previewScheduleImport(
  entries: ScheduleEntry[],
  data: StudyData,
  settings: Record<
    string,
    { mode: StudyTask['mode']; category: string; focus_minutes: number }
  > = {},
) {
  const next = structuredClone(data),
    tasks: StudyTask[] = [],
    blocks: StudyBlock[] = [];
  const duplicates: ScheduleEntry[] = [],
    conflicts: { entry: ScheduleEntry; existing: string }[] = [];
  for (const entry of entries) {
    const name = entry.name.trim();
    const same = Object.values(next.tasks).find((t) => t.name.trim() === name);
    const overlap = Object.values(next.blocks).find(
      (b) => b.day === entry.day && b.start < entry.end && b.end > entry.start,
    );
    if (overlap) {
      if (
        overlap.task_id === same?.id &&
        overlap.start === entry.start &&
        overlap.end === entry.end
      )
        duplicates.push(entry);
      else conflicts.push({ entry, existing: next.tasks[overlap.task_id]!.name });
      continue;
    }
    const task =
      same ??
      studyTaskSchema.parse({
        id: crypto.randomUUID(),
        name,
        mode: 'timer',
        category: '',
        focus_minutes: 25,
        ...settings[name],
      });
    if (!same) {
      next.tasks[task.id] = task;
      tasks.push(task);
    }
    const block = blockSchema.parse({
      id: crypto.randomUUID(),
      task_id: task.id,
      day: entry.day,
      start: entry.start,
      end: entry.end,
    });
    next.blocks[block.id] = block;
    blocks.push(block);
  }
  validateStudy(next);
  return {
    command: {
      type: 'importSchedule' as const,
      fingerprint: scheduleFingerprint(data),
      tasks,
      blocks,
    },
    tasks,
    blocks,
    duplicates,
    conflicts,
    data: next,
  };
}
