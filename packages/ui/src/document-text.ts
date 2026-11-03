export async function documentText(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.split('.').at(-1)?.toLowerCase();
  if (ext === 'md' || ext === 'txt') return new TextDecoder().decode(bytes).slice(0, 60000);
  if (ext === 'docx' || ext === 'pptx') {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.keys(zip.files)
      .filter((n) =>
        ext === 'docx' ? n === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(n),
      )
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let text = '';
    for (const entry of entries.slice(0, 200)) {
      const item = zip.file(entry)!;
      const declared = (item as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (declared !== undefined && declared > 5_000_000)
        throw new Error('文档正文过大，请使用桌面工作台');
      const xml = await item.async('string');
      if (xml.length > 5_000_000) throw new Error('文档内容过大，请使用桌面工作台读取');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      text +=
        (ext === 'pptx' ? `\n第 ${entries.indexOf(entry) + 1} 页\n` : '') +
        [...doc.getElementsByTagNameNS('*', 't')].map((n) => n.textContent ?? '').join(' ') +
        '\n';
      if (text.length >= 60000) break;
    }
    return text.slice(0, 60000);
  }
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const loading = pdfjs.getDocument({ data: bytes.slice() });
    const doc = await loading.promise;
    let text = '';
    try {
      for (let i = 1; i <= Math.min(doc.numPages, 100); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text +=
          `\n[第${i}页] ` +
          content.items.map((item) => ('str' in item ? item.str : '')).join(' ') +
          '\n';
        if (text.length >= 60000) break;
      }
    } finally {
      await loading.destroy();
    }
    return text.slice(0, 60000);
  }
  return '';
}
