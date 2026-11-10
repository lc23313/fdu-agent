export function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
    inbox: 'M4 4h16v16H4zM4 14h5l2 3h2l2-3h5',
    upcoming: 'M5 5h14v16H5zM8 2v6m8-6v6M5 10h14M9 14h2m2 0h2m-6 3h2',
    completed: 'm7 12 3 3 7-7M21 12a9 9 0 1 1-3-7',
    courses: 'M12 6v15M3 4c5-1 7 0 9 2 2-2 4-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z',
    ai: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
    plus: 'M12 5v14M5 12h14',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
    filter: 'M4 7h16M7 12h10M10 17h4',
    select: 'M5 3H3v4M19 3h2v4M3 17v4h4M21 17v4h-4M8 12l3 3 5-6',
    close: 'm6 6 12 12M6 18 18 6',
    more: 'M4 6h16M4 12h10M4 18h7M18 15v6m-3-3h6',
    undo: 'M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12',
    send: 'm3 11 18-8-8 18-3-8-7-2zM10 13l11-10',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.today} />
    </svg>
  );
}
