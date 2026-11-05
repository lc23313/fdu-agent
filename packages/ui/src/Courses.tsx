import { Library } from './Library.tsx';
import { LearningConnection } from './LearningConnection.tsx';
import type { DesktopLearningApi } from './LearningTokenSetup.tsx';
import type { ClientApi } from '../../client/src/client.ts';
import { useState, type ReactNode } from 'react';
import type { Snapshot } from '../../client/src/client.ts';
import { canvasOrigin, learningErrorMessage, submissionLabel } from '../../elearning/src/schema.ts';
export function Courses({
  snapshot,
  add,
  selectTask,
  library,
  refresh,
  api,
  reload,
  desktopLearning,
}: {
  snapshot: Snapshot;
  add: (name: string) => Promise<unknown>;
  selectTask: (id: string) => void;
  library?: ReactNode;
  refresh: () => void;
  api: ClientApi;
  reload: () => Promise<unknown>;
  desktopLearning?: DesktopLearningApi;
}) {
  const [section, setSection] = useState('courses'),
    [course, setCourse] = useState(''),
    [tab, setTab] = useState('概览');
  const selected = snapshot.courses.find((c) => c.id === course);
  const rawCourse = snapshot.learning.courses.find((c) => c.id === course);
  const assignments = snapshot.learning.assignments.filter((a) => a.course_id === course);
  const tasks = snapshot.tasks.filter((t) => t.course_id === course);
  return (
    <section className="courses-panel">
      <div className="view-tabs" aria-label="课程页面">
        <button
          className={section === 'courses' ? 'selected' : ''}
          onClick={() => setSection('courses')}
        >
          我的课程
        </button>
        <button
          className={section === 'library' ? 'selected' : ''}
          onClick={() => setSection('library')}
        >
          资料库
        </button>
      </div>
      <LearningConnection
        api={api}
        snapshot={snapshot}
        refresh={refresh}
        desktop={desktopLearning}
      />
      {section === 'library' ? (
        <>
          <p className="subtitle">跨课程资料统一查看，课程内的资料使用同一文件记录。</p>
          <Library api={api} snapshot={snapshot} refresh={reload} />
          {library && (
            <details>
              <summary>Windows 高级文件工作台（复用原 Dela）</summary>
              {library}
            </details>
          )}
        </>
      ) : selected ? (
        <>
          <button onClick={() => setCourse('')}>‹ 我的课程</button>
          <h2>{selected.name}</h2>
          <div className="view-tabs">
            {['概览', '作业', '公告', '资料'].map((v) => (
              <button key={v} className={tab === v ? 'selected' : ''} onClick={() => setTab(v)}>
                {v}
              </button>
            ))}
          </div>
          {tab === '概览' && (
            <p>
              {rawCourse
                ? `eLearning · ${rawCourse.code} · ${rawCourse.workflow_state === 'completed' ? '已归档' : rawCourse.availability === 'available' ? '可访问' : '暂不可访问或数据过期'}`
                : '个人课程分类'}{' '}
              · {tasks.filter((t) => t.status !== 'completed').length} 项待完成任务
            </p>
          )}
          {rawCourse && (
            <a
              href={`${canvasOrigin}/courses/${rawCourse.external_id}`}
              target="_blank"
              rel="noreferrer"
            >
              打开官方课程 ↗
            </a>
          )}
          {rawCourse?.error && (
            <p className="notice">
              本课程读取失败：{learningErrorMessage(rawCourse.error)}，显示上次保存的数据。
            </p>
          )}
          {(tab === '概览' || tab === '作业') &&
            assignments.map((a) => {
              const task = snapshot.tasks.find((t) => t.id === a.task_id);
              return (
                <article className="assignment-row" key={a.id}>
                  <h3>{a.original_title}</h3>
                  <p>
                    官方截止：
                    {a.original_due_at
                      ? new Date(a.original_due_at).toLocaleString('zh-CN')
                      : '未设置截止'}
                  </p>
                  <p>
                    Canvas 提交：{submissionLabel(a.submission_state)}
                    {a.submitted_at
                      ? ` · ${new Date(a.submitted_at).toLocaleString('zh-CN')}`
                      : ''}{' '}
                    · 评分：
                    {a.grading_state === 'graded'
                      ? '已评分'
                      : a.grading_state === 'unknown'
                        ? '未知'
                        : '尚未评分'}
                  </p>
                  <p>
                    个人任务：
                    {task
                      ? task.status === 'completed'
                        ? '已完成'
                        : task.status === 'in_progress'
                          ? '进行中'
                          : '待办'
                      : '已删除'}
                    {!a.available ? ' · 官方接口本次未返回此作业' : ''}
                  </p>
                  {tab === '作业' && (
                    <p className="assignment-description">
                      {a.original_description || '无作业描述'}
                    </p>
                  )}
                  {task && <button onClick={() => selectTask(task.id)}>编辑个人任务</button>}{' '}
                  <a href={a.official_url} target="_blank" rel="noreferrer">
                    官方作业 ↗
                  </a>
                </article>
              );
            })}
          {(tab === '概览' || tab === '作业') && (
            <div className="course-tasks">
              {tasks
                .filter((t) => !assignments.some((a) => a.task_id === t.id))
                .map((t) => (
                  <button key={t.id} onClick={() => selectTask(t.id)}>
                    {t.title}
                    <small>{t.status === 'completed' ? '个人已完成' : '个人待办'}</small>
                  </button>
                ))}
              {!tasks.length && (
                <p className="subtitle">暂无关联任务。可在任务详情中选择此课程。</p>
              )}
            </div>
          )}
          {tab === '公告' && <p className="subtitle">公告读取尚未接入。可从官方课程页面查看。</p>}
          {tab === '资料' && (
            <Library key={course} api={api} snapshot={snapshot} refresh={reload} course={course} />
          )}
        </>
      ) : (
        <div className="course-list">
          {!snapshot.courses.length && (
            <p className="subtitle">
              尚无课程。连接 eLearning 后显示真实课程，也可添加个人课程分类。
            </p>
          )}
          {snapshot.courses.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCourse(c.id);
                setTab('概览');
              }}
            >
              {c.name}
              <small>
                {snapshot.learning.courses.some((raw) => raw.id === c.id)
                  ? 'eLearning'
                  : '个人课程分类'}{' '}
                ·{' '}
                {
                  snapshot.tasks.filter((t) => t.course_id === c.id && t.status !== 'completed')
                    .length
                }{' '}
                项待办
              </small>
              {snapshot.learning.courses.some((raw) => raw.id === c.id) && (
                <small>
                  {(() => {
                    const deadlines = snapshot.learning.assignments
                      .filter(
                        (a) =>
                          a.course_id === c.id &&
                          a.available &&
                          a.original_due_at &&
                          snapshot.tasks.some(
                            (t) => t.id === a.task_id && t.status !== 'completed',
                          ),
                      )
                      .map((a) => a.original_due_at!)
                      .sort();
                    return deadlines[0]
                      ? `最近截止：${new Date(deadlines[0]).toLocaleString('zh-CN')}`
                      : '暂无待办作业截止';
                  })()}
                </small>
              )}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = String(new FormData(form).get('name')).trim();
              if (name)
                void add(name)
                  .then(() => form.reset())
                  .catch(() => {});
            }}
          >
            <input
              name="name"
              aria-label="新课程名称"
              placeholder="添加个人课程分类"
              required
              maxLength={200}
            />
            <button>＋ 新建课程</button>
          </form>
        </div>
      )}
    </section>
  );
}
