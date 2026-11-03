export function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
    inbox: 'M4 4h16v16H4zM4 14h5l2 3h2l2-3h5',
    upcoming: 'M5 5h14v16H5zM8 2v6m8-6v6M5 10h14M9 14h2m2 0h2m-6 3h2',
    completed: 'm7 12 3 3 7-7M21 12a9 9 0 1 1-3-7',
    courses: 'M12 6v15M3 4c5-1 7 0 9 2 2-2 4-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z',
    ai: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.today} />
    </svg>
  );
}
