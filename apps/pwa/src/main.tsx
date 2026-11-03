import { createRoot } from 'react-dom/client';
import { TaskClient } from '../../../packages/client/src/client.ts';
import { IndexedDbStore } from '../../../packages/storage/src/indexeddb.ts';
import { TodoApp } from '../../../packages/ui/src/TodoApp.tsx';
import '../../../packages/ui/src/style.css';
let id = localStorage.getItem('fdu-local-id');
if (!id) {
  id = crypto.randomUUID();
  localStorage.setItem('fdu-local-id', id);
}
const client = new TaskClient((id) => new IndexedDbStore('fdu-agent', id), localStorage, id);
const env = import.meta.env;
if (
  !localStorage.getItem('fdu-config') &&
  env.VITE_SUPABASE_URL &&
  env.VITE_SUPABASE_PUBLISHABLE_KEY
)
  localStorage.setItem(
    'fdu-config',
    JSON.stringify({ url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY }),
  );
await client.init().catch(console.error);
createRoot(document.getElementById('root')!).render(<TodoApp api={client} />);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller)
            window.dispatchEvent(new Event('fdu-update'));
        });
      });
    })
    .catch(console.error);
}
