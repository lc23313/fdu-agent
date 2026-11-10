import type { TaskPatch } from '../../core/src/task.ts';
import { TaskEditor } from './TaskEditor.tsx';
export function NewSchedule({
  title,
  day,
  courses,
  selectedCourse = '',
  save,
  close,
}: {
  title: string;
  day: string;
  courses: { id: string; name: string }[];
  selectedCourse?: string;
  save: (title: string, patch: TaskPatch) => Promise<unknown>;
  close: () => void;
}) {
  return (
    <TaskEditor
      title={title}
      day={day}
      courses={courses}
      course={selectedCourse}
      tasks={[]}
      create={save}
      save={async () => {}}
      remove={async () => {}}
      close={close}
    />
  );
}
