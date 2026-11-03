import type { SyncEngine } from './engine.ts';

export function startForegroundSync(
  engine: SyncEngine,
  onError: (error: unknown) => void,
): () => void {
  let stopped = false;
  const run = () => {
    if (!stopped && document.visibilityState !== 'hidden') void engine.run().catch(onError);
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', run);
  const timer = setInterval(run, 30000);
  run();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', run);
  };
}
