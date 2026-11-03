import { z } from 'zod';
export const fileSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().min(1).max(200),
    size: z
      .number()
      .int()
      .min(0)
      .max(20 * 1024 * 1024),
    type: z.enum(['pdf', 'docx', 'pptx', 'md', 'txt', 'doc', 'ppt']),
    course_ids: z.array(z.uuid()).max(50),
    text: z.string().max(60000),
    uploaded: z.boolean(),
    created_at: z.iso.datetime({ offset: true }),
    version: z.number().int().min(0),
  })
  .strict();
export type LibraryFile = z.infer<typeof fileSchema>;
