export function relevantPassages(text: string, question: string, budget = 5500) {
  const pages = text.split(/(?=\[第\s*\d+\s*页\])|(?<!\[)(?=第\s+\d+\s+页)/).flatMap((page) => {
    const marker = page.match(/^(?:\[第\s*\d+\s*页\]|第\s*\d+\s*页)/)?.[0] ?? '';
    return (
      page
        .match(/[\s\S]{1,1100}/g)
        ?.map((chunk) => (marker && !chunk.startsWith(marker) ? `${marker} ${chunk}` : chunk)) ?? []
    );
  });
  const words = [
    ...new Set(
      (question.toLowerCase().match(/[a-z0-9_]{2,}|[\p{Script=Han}]{1,}/gu) ?? []).flatMap(
        (word) =>
          /^\p{Script=Han}+$/u.test(word) && word.length > 2
            ? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
            : [word],
      ),
    ),
  ];
  const ranked = pages.map((chunk, index) => ({
    chunk,
    index,
    score: words.reduce((n, word) => n + (chunk.toLowerCase().split(word).length - 1), 0),
  }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  let size = 0;
  const chosen = ranked
    .filter((item) => {
      const keep = size + item.chunk.length + 30 <= budget;
      if (keep) size += item.chunk.length + 30;
      return keep;
    })
    .sort((a, b) => a.index - b.index);
  return (
    `检索范围：已提取正文共 ${text.length} 字，选取 ${chosen.length}/${pages.length} 段，未包含片段不能推测。\n` +
    chosen.map((p) => `[段${p.index + 1}] ${p.chunk}`).join('\n')
  );
}
