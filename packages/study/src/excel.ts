import type JSZip from 'jszip';
import type { ScheduleEntry } from './import.ts';
export interface ScheduleSheet {
  name: string;
  entries: ScheduleEntry[];
  breaks: { name: string; start: number; end: number }[];
  warnings: string[];
}
export interface ScheduleWorkbook {
  sheets: ScheduleSheet[];
  ignored: string[];
}
interface Cell {
  row: number;
  col: number;
  value: string;
  numeric: boolean;
  formula: boolean;
  ref: string;
  green: boolean;
}
interface Merge {
  top: number;
  bottom: number;
  left: number;
  right: number;
  ref: string;
}
interface Range {
  start: number;
  end: number;
}
const nodes = (element: Document | Element, name: string) => [
  ...element.getElementsByTagNameNS('*', name),
];
function xml(text: string) {
  if (text.length > 4000000 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('工作表 XML 格式不支持');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (nodes(document, 'parsererror').length) throw new Error('Excel 文件内容损坏，无法读取');
  return document;
}
function position(ref: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) throw new Error('Excel 单元格地址无效');
  return {
    col: [...match[1]!.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
    row: Number(match[2]),
  };
}
function weekday(text: string): number | undefined {
  const value = text.trim().toLowerCase().replace(/\s|\./g, '');
  const index = [
    ['mon', 'monday', '周一', '星期一'],
    ['tue', 'tues', 'tuesday', '周二', '星期二'],
    ['wed', 'wednesday', '周三', '星期三'],
    ['thu', 'thur', 'thurs', 'thursday', '周四', '星期四'],
    ['fri', 'friday', '周五', '星期五'],
    ['sat', 'saturday', '周六', '星期六'],
    ['sun', 'sunday', '周日', '周天', '星期日', '星期天'],
  ].findIndex((list) => list.includes(value));
  return index < 0 ? undefined : index;
}
function clock(text: string): number | undefined {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  return match && Number(match[1]) < 24 ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}
function cellTime(cell: Cell): { start: number; end?: number } | undefined {
  if (cell.formula) return;
  const value = cell.value.replace(/\s/g, '').replaceAll('：', ':');
  const parts = value.split(/[-–—~～至]/);
  const start = clock(parts[0]!);
  if (parts.length === 2) {
    const end = clock(parts[1]!);
    if (start !== undefined && end !== undefined && end > start) return { start, end };
  }
  if (parts.length === 1 && start !== undefined) return { start };
  if (cell.numeric && Number(value) >= 0 && Number(value) < 1) {
    const minute = Number(value) * 1440;
    if (Math.abs(minute - Math.round(minute)) < 0.01) return { start: Math.round(minute) };
  }
}

export async function readScheduleExcel(
  bytes: ArrayBuffer | Uint8Array,
): Promise<ScheduleWorkbook> {
  if (bytes.byteLength > 10000000) throw new Error('请使用 10 MB 以内的 .xlsx 周表');
  let zip: JSZip;
  try {
    const { default: Zip } = await import('jszip');
    zip = await Zip.loadAsync(bytes);
  } catch {
    throw new Error('请上传有效的 .xlsx 文件；不支持旧版 .xls 或加密工作簿');
  }
  const part = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`Excel 缺少必要内容：${path}`);
    return xml(await file.async('string'));
  };
  const book = await part('xl/workbook.xml'),
    relationships = await part('xl/_rels/workbook.xml.rels');
  const styles = zip.file('xl/styles.xml') ? await part('xl/styles.xml') : null;
  const theme = zip.file('xl/theme/theme1.xml') ? await part('xl/theme/theme1.xml') : null;
  const themeScheme = theme ? nodes(theme, 'clrScheme')[0] : null;
  const themeNames = [
    'lt1',
    'dk1',
    'lt2',
    'dk2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ];
  const fills = styles ? nodes(styles, 'fills')[0] : null;
  const greenFills = fills
    ? nodes(fills, 'fill').map((fill) => {
        const pattern = nodes(fill, 'patternFill')[0];
        if (pattern?.getAttribute('patternType') !== 'solid') return false;
        const color = nodes(pattern, 'fgColor')[0];
        let rgb = color?.getAttribute('rgb');
        const themeIndex = color?.getAttribute('theme');
        if (!rgb && themeIndex !== null && themeIndex !== undefined && themeScheme) {
          const entry = nodes(themeScheme, themeNames[Number(themeIndex)] ?? '')[0]
            ?.firstElementChild;
          rgb = entry?.getAttribute('val') ?? entry?.getAttribute('lastClr');
        }
        const indexed = color?.getAttribute('indexed');
        if (!rgb && indexed)
          rgb = (
            {
              '3': '00FF00',
              '11': '00FF00',
              '17': '008000',
              '35': 'CCFFCC',
              '42': 'CCFFCC',
            } as Record<string, string>
          )[indexed];
        if (!rgb || !/^(?:[A-F\d]{2})?[A-F\d]{6}$/i.test(rgb)) return false;
        const tint = Number(color?.getAttribute('tint') ?? 0);
        const [r, g, b] = rgb
          .slice(-6)
          .match(/../g)!
          .map((v) => {
            const n = parseInt(v, 16);
            return tint < 0 ? n * (1 + tint) : n * (1 - tint) + 255 * tint;
          });
        return g! > r! + 8 && g! > b! + 8;
      })
    : [];
  const cellStyles = styles ? nodes(styles, 'cellXfs')[0] : null;
  const greenStyles = cellStyles
    ? nodes(cellStyles, 'xf').map(
        (xf) => greenFills[Number(xf.getAttribute('fillId') ?? 0)] ?? false,
      )
    : [];
  const sharedPart = zip.file('xl/sharedStrings.xml');
  const shared = sharedPart
    ? nodes(xml(await sharedPart.async('string')), 'si').map((si) =>
        nodes(si, 't')
          .map((t) => t.textContent ?? '')
          .join(''),
      )
    : [];
  const sheets: ScheduleSheet[] = [],
    ignored: string[] = [];
  const sheetNodes = nodes(book, 'sheet');
  if (sheetNodes.length > 30) throw new Error('工作表过多，请仅保留要导入的周表');
  for (const sheetNode of sheetNodes) {
    const name = sheetNode.getAttribute('name') ?? '未命名工作表';
    const id = [...sheetNode.attributes].find((a) => a.localName === 'id')?.value;
    const relation = nodes(relationships, 'Relationship').find(
      (r) => r.getAttribute('Id') === id && r.getAttribute('TargetMode') !== 'External',
    );
    if (!relation) {
      ignored.push(`${name}：不是本地工作表`);
      continue;
    }
    const target = relation.getAttribute('Target') ?? '';
    const path: string[] = [];
    for (const segment of (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/')) {
      if (segment === '..') path.pop();
      else if (segment && segment !== '.') path.push(segment);
    }
    if (path[0] !== 'xl') throw new Error('工作表路径无效');
    const sheet = await part(path.join('/'));
    const cells: Cell[] = nodes(sheet, 'c').map((c) => {
      const ref = c.getAttribute('r') ?? '',
        p = position(ref),
        type = c.getAttribute('t');
      const v = nodes(c, 'v')[0]?.textContent ?? '';
      return {
        ...p,
        ref,
        numeric: type === null || type === 'n',
        formula: nodes(c, 'f').length > 0,
        green: greenStyles[Number(c.getAttribute('s') ?? 0)] ?? false,
        value: (type === 's'
          ? (shared[Number(v)] ?? '')
          : type === 'inlineStr'
            ? nodes(c, 't')
                .map((t) => t.textContent ?? '')
                .join('')
            : v
        ).trim(),
      };
    });
    if (cells.length > 30000) throw new Error(`工作表「${name}」过大，请仅保留周表区域`);
    if (!cells.some((c) => c.value)) {
      ignored.push(`${name}：空白工作表`);
      continue;
    }
    const header = [
      ...new Set(
        cells
          .filter((c) => c.row <= 30 && !c.formula && weekday(c.value) !== undefined)
          .map((c) => c.row),
      ),
    ].find(
      (row) =>
        new Set(
          cells
            .filter((c) => c.row === row && !c.formula)
            .map((c) => weekday(c.value))
            .filter((d) => d !== undefined),
        ).size === 7,
    );
    if (!header) {
      ignored.push(`${name}：未找到完整的周一至周日表头`);
      continue;
    }
    const days = new Map(
      cells
        .filter((c) => c.row === header && !c.formula && weekday(c.value) !== undefined)
        .map((c) => [c.col, weekday(c.value)!]),
    );
    if (days.size !== 7) throw new Error(`工作表「${name}」的星期表头重复，请先检查`);
    const left = Math.min(...days.keys());
    const timeColumns = [
      ...new Set(
        cells.filter((c) => c.col < left && c.row > header && cellTime(c)).map((c) => c.col),
      ),
    ];
    timeColumns.sort(
      (a, b) =>
        cells.filter((c) => c.col === b && cellTime(c)).length -
        cells.filter((c) => c.col === a && cellTime(c)).length,
    );
    const timeCol = timeColumns[0];
    if (!timeCol) {
      ignored.push(`${name}：未找到左侧时间刻度`);
      continue;
    }
    const axis = cells
      .filter((c) => c.col === timeCol && c.row > header && c.value)
      .sort((a, b) => a.row - b.row);
    const times = new Map<number, Range>(),
      breaks: ScheduleSheet['breaks'] = [],
      warnings: string[] = [];
    for (let index = 0; index < axis.length; index++) {
      const cell = axis[index]!,
        at = cellTime(cell);
      if (at) {
        const next = axis
          .slice(index + 1)
          .map(cellTime)
          .find((v) => v !== undefined);
        const end = at.end ?? (next?.start === at.start + 30 ? next.start : at.start + 30);
        if (at.start < 1320) times.set(cell.row, { start: at.start, end });
      } else if (/^(午休|晚休)$/.test(cell.value)) {
        const previous = [...times.values()].at(-1),
          next = axis
            .slice(index + 1)
            .map(cellTime)
            .find((v) => v !== undefined);
        if (previous && next && next.start > previous.end) {
          const range = { start: previous.end, end: next.start };
          times.set(cell.row, range);
          breaks.push({ name: cell.value, ...range });
        } else warnings.push(`${cell.ref}：无法确定${cell.value}的起止时间`);
      } else warnings.push(`${cell.ref}：无法识别时间「${cell.value}」`);
    }
    const merges: Merge[] = nodes(sheet, 'mergeCell').map((m) => {
      const ref = m.getAttribute('ref') ?? '',
        [a, b = a] = ref.split(':'),
        start = position(a!),
        end = position(b!);
      return { ref, top: start.row, left: start.col, bottom: end.row, right: end.col };
    });
    const entries: ScheduleEntry[] = [];
    if (nodes(sheet, 'conditionalFormatting').length)
      warnings.push('仅识别单元格静态绿色填充，不计算条件格式颜色');
    for (const cell of cells.filter((c) => c.row > header && days.has(c.col) && c.value)) {
      if (!cell.green) continue;
      if (cell.formula) {
        warnings.push(`${cell.ref}：任务名称含公式，未导入`);
        continue;
      }
      const merge = merges.find(
        (m) =>
          m.top <= cell.row && m.bottom >= cell.row && m.left <= cell.col && m.right >= cell.col,
      );
      if (merge && (merge.top !== cell.row || merge.left !== cell.col)) continue;
      const first = times.get(cell.row),
        last = times.get(merge?.bottom ?? cell.row);
      const covered = [...times]
        .filter(([row]) => row >= cell.row && row <= (merge?.bottom ?? cell.row))
        .map(([, range]) => range);
      if (!first || !last || covered.some((v, i) => i > 0 && v.start !== covered[i - 1]!.end)) {
        warnings.push(`${cell.ref}：时间范围不完整，未导入「${cell.value}」`);
        continue;
      }
      if (cell.value.length > 200 || cell.numeric) {
        warnings.push(`${cell.ref}：不是有效的任务名称，未导入`);
        continue;
      }
      if (first.start < 450 || last.end > 1320 || first.start % 30 || last.end % 30) {
        warnings.push(`${cell.ref}：时间超出 07:30—22:00 或不符合半小时刻度，未导入`);
        continue;
      }
      for (const [column, day] of days)
        if (column >= cell.col && column <= (merge?.right ?? cell.col))
          entries.push({
            name: cell.value,
            day,
            start: first.start,
            end: last.end,
            source: `${name}!${merge?.ref ?? cell.ref}`,
          });
    }
    sheets.push({ name, entries, breaks, warnings });
  }
  if (!sheets.length) throw new Error(`未找到可识别的每周时间表。${ignored.join('；')}`);
  return { sheets, ignored };
}
