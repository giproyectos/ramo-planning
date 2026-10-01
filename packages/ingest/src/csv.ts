export interface CsvTable {
  headers: string[];
  rows: { line: number; cells: string[] }[];
  delimiter: string;
}

/** Parser CSV mínimo: BOM, comillas con "" escapado, \r\n, líneas vacías y delimitador autodetectado (; , tab). */
export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts: [string, number][] = [';', '\t', ','].map((d) => [d, firstLine.split(d).length - 1]);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ';';

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cur);
    cur = '';
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || cells.length > 0) endRecord();

  const [head, ...rows] = records;
  return { headers: head ? head.cells.map((h) => h.trim()) : [], rows, delimiter };
}

export type DecimalSeparator = 'comma' | 'dot';

/** Número con separador decimal configurable. 'comma' (por defecto, exportes SAP es-CO): "1.234,56" → 1234.56. */
export function parseNumber(raw: string, decimal: DecimalSeparator = 'comma'): number | null {
  let s = raw.trim().replace(/\s/g, '');
  if (s === '') return null;
  // Signo final de SAP: "1.234-" significa negativo.
  if (s.endsWith('-')) s = '-' + s.slice(0, -1);
  s = decimal === 'comma' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Fechas SAP/ISO → 'YYYY-MM-DD' (o null si no es una fecha real). Acepta YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY y YYYYMMDD. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** 'HH:MM', 'HH:MM:SS' o 'HHMMSS' → 'HH:MM' (o null). */
export function parseTime(raw: string): string | null {
  const s = raw.trim();
  const match = s.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/) ?? s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const h = +match[1];
  const mi = +match[2];
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
