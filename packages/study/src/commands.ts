import { z } from 'zod';
import { blockSchema, recordSchema, sessionSchema, studyTaskSchema } from './model.ts';
import { scheduleImportSchema } from './import.ts';
export const studyCommandSchema = z.discriminatedUnion('type', [
  scheduleImportSchema,
  z.object({ type: z.literal('task'), value: studyTaskSchema, before: studyTaskSchema.nullable() }),
  z.object({ type: z.literal('block'), value: blockSchema, before: blockSchema.nullable() }),
  z.object({ type: z.literal('deleteBlock'), id: z.uuid(), before: blockSchema }),
  z.object({
    type: z.literal('deleteTask'),
    id: z.uuid(),
    before: studyTaskSchema,
    block_ids: z.array(z.uuid()),
  }),
  z.object({ type: z.literal('record'), value: recordSchema, before: recordSchema }),
  z.object({ type: z.literal('deleteRecord'), id: z.uuid(), before: recordSchema }),
  z.object({ type: z.literal('importPlan') }),
  z.object({
    type: z.literal('start'),
    task: studyTaskSchema,
    preset: z.boolean(),
    method: z.enum(['complete', 'stopwatch', 'pomodoro']),
    focus_minutes: z.number().int().min(1).max(360),
    rest_minutes: z.number().int().min(1).max(120),
  }),
  z.object({
    type: z.literal('transition'),
    before: sessionSchema,
    action: z.enum(['pause', 'resume', 'end', 'rest', 'next']),
  }),
  z.object({ type: z.literal('save'), before: sessionSchema, record: recordSchema }),
  z.object({
    type: z.literal('resolve'),
    ids: z.array(z.uuid()).min(1),
    record: recordSchema.optional(),
  }),
]);
export type StudyCommand = z.infer<typeof studyCommandSchema>;
