/**
 * excelExporterBase.ts — قاعدة موحدة لمُصدِّرات Excel (bond / returns / invoice / quotation / statement)
 * ---------------------------------------------------------------------------------------------------
 * يوحّد العناصر التي كانت مكررة حرفياً عبر عائلة المُصدِّرات:
 *   1. loadXLSX() — lazy-load موحّد لـ xlsx-js-style (يُبقي ~930KB خارج الحزمة الابتدائية)
 *      ويتضمّن إعادة محاولة عند فشل الاستيراد (أمان إضافي مقابل النسخ القديمة).
 *   2. buildStyledSheet() — بناء ورقة + أعمدة + دمج + حلقة التنسيق القياسية
 *      (حدود D3D3D3، خط Arial، رأس أزرق 1F4E78، مفاتيح وصفية F2F2F2،
 *       ملخص EBF1DE، صفوف متناوبة FAFAFA، أرقام إنجليزية #,##0.00).
 *   3. saveWorkbookToFile() / workbookToBlob() — الحفظ أو التحويل لـ Blob.
 *
 * قاعدة صارمة للمستخدمين: لا يُستورد xlsx-js-style مباشرة خارج هذا الملف.
 */

// ── أنواع محلية لـ xlsx-js-style (شحيحة التعريف) ──────────────────────────────

export interface ExcelCellAddress {
  r: number;
  c: number;
}

export interface ExcelMergeRange {
  s: ExcelCellAddress;
  e: ExcelCellAddress;
}

export interface XlsxCell {
  v?: unknown;
  z?: string;
  s?: Record<string, unknown>;
}

export interface XlsxSheet {
  '!ref'?: string;
  '!cols'?: Array<{ wch?: number }>;
  '!merges'?: ExcelMergeRange[];
  '!props'?: Record<string, unknown>;
  '!view'?: Array<{ RTL?: boolean }>;
  [key: string]: XlsxCell | string | unknown[] | Array<Record<string, unknown>> | undefined;
}

export interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XlsxSheet>;
  /**
   * إعدادات على مستوى الملف. اتجاه RTL الفعلي يُكتب من هنا
   * (`Workbook.Views[0].RTL`) لا من `sheet['!view']`.
   */
  Workbook?: { Views?: Array<{ RTL?: boolean }> };
}

/** يفعّل اتجاه RTL فعلياً في الملف المكتوب (مستوى الـ workbook). */
export const enableWorkbookRtl = (wb: XlsxWorkbook): void => {
  wb.Workbook = { ...(wb.Workbook ?? {}), Views: [{ RTL: true }] };
};

export interface XlsxLike {
  utils: {
    book_new: () => XlsxWorkbook;
    aoa_to_sheet: (rows: unknown[][]) => XlsxSheet;
    json_to_sheet: (data: unknown[]) => XlsxSheet;
    book_append_sheet: (wb: XlsxWorkbook, ws: XlsxSheet, name: string) => void;
    encode_cell: (address: ExcelCellAddress) => string;
    decode_range: (ref: string) => { s: ExcelCellAddress; e: ExcelCellAddress };
    sheet_to_json: (
      ws: XlsxSheet,
      opts?: Record<string, unknown>
    ) => Array<Record<string, unknown>>;
  };
  writeFile: (wb: XlsxWorkbook, filename: string) => void;
  write: (
    wb: XlsxWorkbook,
    opts: { bookType: string; type: string; compression?: boolean }
  ) => unknown;
  read: (data: ArrayBuffer, opts?: Record<string, unknown>) => XlsxWorkbook;
}

let xlsxPromise: Promise<XlsxLike> | null = null;

/** Lazy-load موحّد — مع إعادة تعيين الوعد عند الفشل للسماح بإعادة المحاولة. */
export const loadXLSX = (): Promise<XlsxLike> => {
  xlsxPromise ??= import('xlsx-js-style')
    .then((m: unknown) => {
      const mod = m as { default?: XlsxLike };
      return mod.default ?? (m as XlsxLike);
    })
    .catch((err: unknown) => {
      xlsxPromise = null;
      throw err;
    });
  return xlsxPromise;
};

/** يزيل المحارف غير الصالحة في أسماء ملفات Windows. */
export const sanitizeFileName = (value: string): string => {
  const sanitized = Array.from(value)
    .filter(ch => ch.charCodeAt(0) >= 32)
    .join('');
  return (
    sanitized
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'export'
  );
};

// ── خيارات التنسيق القياسي ────────────────────────────────────────────────────

/**
 * لوحة ألوان الورقة. القيم الافتراضية هي نفس الألوان المعتمدة سابقاً، فأي مُصدِّر
 * لا يمرّر palette يبقى مخرجُه مطابقاً تماماً لما كان عليه.
 */
export interface ExcelPalette {
  /** لون التمييز: اسم الشركة والقيم البارزة. */
  accent: string;
  /** خلفية شريط اسم المنشأة. */
  titleFill: string;
  /** خلفية شريط نوع المستند (عرض سعر / فاتورة). */
  subtitleFill: string;
  /** خلفية رأس جدول الأصناف. */
  headerFill: string;
  /** لون خط رأس جدول الأصناف. */
  headerFont: string;
  /** خلفية خلايا المفاتيح الوصفية. */
  metaFill: string;
  /** خلفية قيم الملخص. */
  summaryFill: string;
  /** خلفية الصفوف المتناوبة. */
  alternateFill: string;
  /** لون الحدود. */
  border: string;
}

const DEFAULT_PALETTE: ExcelPalette = {
  accent: '1F4E78',
  titleFill: '1F4E78',
  subtitleFill: 'DCE6F1',
  headerFill: '1F4E78',
  headerFont: 'FFFFFF',
  metaFill: 'F2F2F2',
  summaryFill: 'EBF1DE',
  alternateFill: 'FAFAFA',
  border: 'D3D3D3',
};

const pickColor = (value: string | undefined, fallback: string): string => value ?? fallback;

/** يحوّل الألوان الممرَّرة إلى لوحة كاملة بلا فهرسة ديناميكية. */
export const resolvePalette = (override: Partial<ExcelPalette> = {}): ExcelPalette => ({
  accent: pickColor(override.accent, DEFAULT_PALETTE.accent),
  titleFill: pickColor(override.titleFill, DEFAULT_PALETTE.titleFill),
  subtitleFill: pickColor(override.subtitleFill, DEFAULT_PALETTE.subtitleFill),
  headerFill: pickColor(override.headerFill, DEFAULT_PALETTE.headerFill),
  headerFont: pickColor(override.headerFont, DEFAULT_PALETTE.headerFont),
  metaFill: pickColor(override.metaFill, DEFAULT_PALETTE.metaFill),
  summaryFill: pickColor(override.summaryFill, DEFAULT_PALETTE.summaryFill),
  alternateFill: pickColor(override.alternateFill, DEFAULT_PALETTE.alternateFill),
  border: pickColor(override.border, DEFAULT_PALETTE.border),
});

/**
 * شريط أفقي بعرض الورقة — يُطبَّق آخر شيء فيتغلّب على أي قاعدة أخرى.
 * يُستخدم لبناء ترويسة فخمة (شريط ملوّن لاسم المنشأة ونوع المستند).
 */
export interface ExcelBandRow {
  row: number;
  fill?: string;
  fontColor?: string;
  fontSize?: number;
  bold?: boolean;
  /** ارتفاع الصف بالنقاط (pt). */
  height?: number;
}

export interface ExcelStylingOptions {
  /** صف اسم الشركة/العنوان الرئيسي (Arial 16 عريض أزرق 1F4E78) — عادة 0. */
  companyRow?: number;
  /** نطاق صفوف العناوين الفرعية (Arial 12 عريض). */
  subHeaderRows?: [number, number];
  /** أعمدة مفاتيح البيانات الوصفية التي تُظلل F2F2F2. */
  metaKeyColumns?: number[];
  /** نطاق صفوف البيانات الوصفية. */
  metaRows?: [number, number];
  /** صف رأس الجدول (خلفية 1F4E78 + خط أبيض). */
  tableHeaderRow?: number;
  /** صفوف ملخص القاع: مفتاح F2F2F2 / قيمة EBF1DE. */
  summaryRows?: [number, number];
  summaryKeyCol?: number;
  summaryValueCol?: number;
  /** تناوب صفوف بيانات الجدول (parity: حتى/فردي). */
  alternate?: { startRow: number; endRow?: number; parity: 'even' | 'odd' };
  /** أعمدة تُنسق أرقاماً صحيحة (#,##0) — الباقي #,##0.00. */
  integerColumns?: number[];
  /** صف مخصص للملاحظات (Arial 11 عريض على العمود 0). */
  notesRow?: number;
  /** صف عنوان القائمة (Arial 14 عريض) — مثل قائمة السندات. */
  listTitleRow?: number;
  /** خلايا وصفية إضافية تُظلل F2F2F2 خارج نطاق metaRows. */
  extraMetaCells?: Array<{ row: number; col: number }>;
  /** صف عنوان كتلة الملخص (خلفية EBF1DE + خط 1F4E78 عريض على كل الأعمدة). */
  summaryTitleRow?: number;
  /** مفاتيح كتلة الملخص بعد العنوان (F2F2F2 عريض) — { fromRow, col }. */
  summaryKeys?: { fromRow: number; col: number };
  /** تنسيق كل الأرقام ابتداءً من صف معيّن كأرقام صحيحة (#,##0). */
  integerFromRow?: number;
  /** أعمدة يجب تحويل قيمها النصية إلى أرقام حقيقية وتطبيق التنسيق المالي عليها. */
  numericColumns?: number[];
  /** عدد الأعمدة (يُستخدم عند غياب !ref). */
  columnCount?: number;
  /** لوحة ألوان مخصّصة (افتراضياً الألوان المعتمدة). */
  palette?: Partial<ExcelPalette>;
  /** أشرطة أفقية بعرض الورقة تُطبَّق آخر شيء (ترويسة فخمة). */
  bandRows?: ExcelBandRow[];
}

/** الخيارات بعد حلّ اللوحة — يُمرَّر داخلياً لتجنّب تجاوز حد المعاملات. */
type ResolvedStylingOptions = ExcelStylingOptions & { palette: ExcelPalette };

export interface BuildSheetOptions {
  colWidths: number[];
  autoFitWidths?: boolean;
  merges?: ExcelMergeRange[];
  styling?: ExcelStylingOptions;
}

/** طول النص المعروض لخلية — بلا تحويل كائنات إلى نص. */
const cellTextLength = (value: unknown): number => {
  if (typeof value === 'string') return value.trim().length;
  if (typeof value === 'number') return String(value).length;
  return 0;
};

/**
 * احتساب ديناميكي لعرض الأعمدة بناءً على أطول نص في كل عمود مع هامش أمان.
 * يتجاهل النصوص الطويلة جداً التي تنتمي لصفوف العناوين أو الملاحظات المدمجة.
 *
 * كُتبت بأسلوب دالّي (Array.from + at) بدل حلقة تكتب بالفهرس: الكتابة بمؤشّر
 * متغيّر داخل مصفوفة تُطلق قاعدة security/detect-object-injection.
 */
export const computeAutoFitWidths = (
  rows: unknown[][],
  baseWidths?: number[],
  padding = 4
): number[] => {
  const maxCols = Math.max(...rows.map(r => (Array.isArray(r) ? r.length : 0)), 0);

  return Array.from({ length: maxCols }, (_unused, c) => {
    const minWidth = baseWidths?.at(c) ?? 10;
    const longest = rows.reduce((max, row) => {
      const cell = Array.isArray(row) ? row.at(c) : undefined;
      const len = Math.min(60, cellTextLength(cell));
      return len > max ? len : max;
    }, 0);
    const needed = longest > 0 ? longest + padding : minWidth;
    return Math.max(minWidth, Math.min(60, needed));
  });
};

const borderFor = (palette: ExcelPalette): Record<string, unknown> => ({
  top: { style: 'thin', color: { rgb: palette.border } },
  bottom: { style: 'thin', color: { rgb: palette.border } },
  left: { style: 'thin', color: { rgb: palette.border } },
  right: { style: 'thin', color: { rgb: palette.border } },
});

const ARIAL_11 = { name: 'Arial', sz: 11, color: { rgb: '000000' } };
const SUB_HEADER_FONT = { name: 'Arial', sz: 12, bold: true };

const readCell = (sheet: XlsxSheet, ref: string): XlsxCell | undefined => {
  // cellRef متغيّر ديناميكي وفق مواصفات xlsx — الوصول المقصود هنا غير قابل للفهرسة الثابتة.
  // eslint-disable-next-line security/detect-object-injection
  const cell = sheet[ref] as XlsxCell | undefined;
  return cell;
};

const applyDefaultCellStyle = (cell: XlsxCell, palette: ExcelPalette): void => {
  cell.s = {
    border: borderFor(palette),
    alignment: { horizontal: 'center', vertical: 'center' },
    font: ARIAL_11,
  };
};

const applyNumberFormat = (
  cell: XlsxCell,
  options: ResolvedStylingOptions,
  row: number,
  col: number
): void => {
  if (typeof cell.v === 'string' && options.numericColumns?.includes(col) === true) {
    const parsed = Number(cell.v.replace(/[,\s]/g, ''));
    if (Number.isFinite(parsed)) {
      cell.v = parsed;
    }
  }
  if (typeof cell.v !== 'number') return;
  const isInteger =
    options.integerColumns?.includes(col) === true ||
    (options.integerFromRow !== undefined && row >= options.integerFromRow);
  cell.z = isInteger ? '#,##0' : '#,##0.00';
};

const applyHeaderFonts = (
  style: Record<string, unknown>,
  options: ResolvedStylingOptions,
  row: number
): void => {
  if (options.companyRow !== undefined && row === options.companyRow) {
    style.font = { name: 'Arial', sz: 16, bold: true, color: { rgb: options.palette.accent } };
  }
  if (
    options.subHeaderRows !== undefined &&
    row >= options.subHeaderRows[0] &&
    row <= options.subHeaderRows[1]
  ) {
    style.font = SUB_HEADER_FONT;
  }
  if (options.listTitleRow !== undefined && row === options.listTitleRow) {
    style.font = { name: 'Arial', sz: 14, bold: true };
  }
};

const applyMetaStyles = (
  style: Record<string, unknown>,
  options: ResolvedStylingOptions,
  row: number,
  col: number
): void => {
  const inMetaRow =
    options.metaRows !== undefined && row >= options.metaRows[0] && row <= options.metaRows[1];
  const isMetaKeyCol =
    options.metaKeyColumns !== undefined &&
    (col === options.metaKeyColumns[0] || col === options.metaKeyColumns[1]);
  const isExtraMeta =
    options.extraMetaCells?.some(cell => cell.row === row && cell.col === col) === true;
  if ((inMetaRow && isMetaKeyCol) || isExtraMeta) {
    style.font = { name: 'Arial', sz: 11, bold: true };
    style.fill = { fgColor: { rgb: options.palette.metaFill } };
  }
};

const applyTableAndSummary = (
  style: Record<string, unknown>,
  options: ResolvedStylingOptions,
  row: number,
  col: number
): void => {
  if (options.tableHeaderRow !== undefined && row === options.tableHeaderRow) {
    style.fill = { fgColor: { rgb: options.palette.headerFill } };
    style.font = { name: 'Arial', sz: 12, bold: true, color: { rgb: options.palette.headerFont } };
  }
  if (
    options.summaryRows !== undefined &&
    row >= options.summaryRows[0] &&
    row <= options.summaryRows[1]
  ) {
    const summaryKeyCol = options.summaryKeyCol ?? 3;
    const summaryValueCol = options.summaryValueCol ?? 4;
    if (col === summaryKeyCol) {
      style.font = { name: 'Arial', sz: 12, bold: true };
      style.fill = { fgColor: { rgb: options.palette.metaFill } };
    }
    if (col === summaryValueCol) {
      style.font = { name: 'Arial', sz: 12, bold: true, color: { rgb: options.palette.accent } };
      style.fill = { fgColor: { rgb: options.palette.summaryFill } };
    }
  }
};

const applySummaryBlock = (
  style: Record<string, unknown>,
  options: ResolvedStylingOptions,
  row: number,
  col: number
): void => {
  if (options.summaryTitleRow !== undefined && row === options.summaryTitleRow) {
    style.fill = { fgColor: { rgb: options.palette.summaryFill } };
    style.font = { name: 'Arial', sz: 12, bold: true, color: { rgb: options.palette.accent } };
  }
  if (
    options.summaryKeys !== undefined &&
    row > options.summaryKeys.fromRow &&
    col === options.summaryKeys.col
  ) {
    style.font = { name: 'Arial', sz: 11, bold: true };
    style.fill = { fgColor: { rgb: options.palette.metaFill } };
  }
};

const applyAlternateAndNotes = (
  style: Record<string, unknown>,
  options: ResolvedStylingOptions,
  row: number,
  rangeEndRow: number
): void => {
  if (options.alternate !== undefined && row > options.alternate.startRow) {
    const endRow =
      options.alternate.endRow ??
      (options.summaryRows === undefined ? rangeEndRow : options.summaryRows[0] - 1);
    const isAlternateParity = row % 2 === (options.alternate.parity === 'odd' ? 1 : 0);
    if (row < endRow && isAlternateParity) {
      style.fill = { fgColor: { rgb: options.palette.alternateFill } };
    }
  }
  if (options.notesRow !== undefined && row === options.notesRow) {
    style.font = { name: 'Arial', sz: 11, bold: true };
  }
};

/** أشرطة الترويسة: تُطبَّق بعد كل القواعد الأخرى فتتغلّب عليها. */
const applyBands = (
  style: Record<string, unknown>,
  options: ResolvedStylingOptions,
  row: number,
  col: number
): void => {
  const band = options.bandRows?.find(entry => entry.row === row);
  if (band === undefined) return;

  if (band.fill !== undefined) {
    style.fill = { fgColor: { rgb: band.fill } };
  }
  const size = band.fontSize ?? (style.font as { sz?: number } | undefined)?.sz ?? 11;
  const color = band.fontColor ?? options.palette.accent;
  // الخط الافتراضي يبقى عريضاً في الأشرطة، ويُطبَّق على كل أعمدة الشريط.
  style.font = { name: 'Arial', sz: size, bold: band.bold ?? true, color: { rgb: color } };
  if (col === 0) {
    style.alignment = { horizontal: 'right', vertical: 'center' };
  } else {
    style.alignment = { horizontal: 'center', vertical: 'center' };
  }
};

/** حلقة التنسيق القياسية — تنسّق كل خلية موجودة في الورقة. */
export const applyExcelStyling = (
  sheet: XlsxSheet,
  XLSX: XlsxLike,
  options: ExcelStylingOptions = {}
): void => {
  const resolved: ResolvedStylingOptions = {
    ...options,
    palette: resolvePalette(options.palette),
  };
  const colCount = resolved.columnCount ?? 5;
  const lastColLetter = String.fromCharCode(64 + Math.min(26, colCount));
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? `A1:${lastColLetter}1`);

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = readCell(sheet, ref);
      if (cell === undefined) continue;

      applyDefaultCellStyle(cell, resolved.palette);
      applyNumberFormat(cell, resolved, R, C);

      const style = cell.s ?? {};
      applyHeaderFonts(style, resolved, R);
      applyMetaStyles(style, resolved, R, C);
      applyTableAndSummary(style, resolved, R, C);
      applySummaryBlock(style, resolved, R, C);
      applyAlternateAndNotes(style, resolved, R, range.e.r);
      applyBands(style, resolved, R, C);
    }
  }
};

/** يبني ورقة منمّقة كاملة (أعمدة + دمج + تنسيق + RTL). */
export const buildStyledSheet = (
  XLSX: XlsxLike,
  rows: unknown[][],
  options: BuildSheetOptions
): XlsxSheet => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const autoWidths = computeAutoFitWidths(rows, options.colWidths);
  const finalWidths =
    options.autoFitWidths === false
      ? options.colWidths
      : options.colWidths.map((w, i) => Math.max(w, autoWidths.at(i) ?? w));
  sheet['!cols'] = finalWidths.map(width => ({ wch: width }));
  if (options.merges !== undefined && options.merges.length > 0) {
    sheet['!merges'] = options.merges;
  }
  applyExcelStyling(sheet, XLSX, options.styling);

  // ارتفاعات صفوف الأشرطة (ترويسة فخمة) — تُكتب فقط للصفوف التي حدّدت ارتفاعاً.
  const bands = options.styling?.bandRows ?? [];
  const rowHeights: Array<Record<string, unknown>> = [];
  let hasHeight = false;
  for (const band of bands) {
    if (band.height === undefined) continue;
    rowHeights[band.row] = { hpt: band.height };
    hasHeight = true;
  }
  if (hasHeight) {
    sheet['!rows'] = rowHeights;
  }

  sheet['!props'] ??= {};
  // للقراءة فقط: كاتب xlsx-js-style يتجاهل `!view` ولا يكتب `rightToLeft`.
  sheet['!view'] = [{ RTL: true }];
  return sheet;
};

/** يلحق ورقة بملف عمل (workbook) مع تفعيل اتجاه RTL المكتوب فعلياً. */
export const appendSheetToWorkbook = (
  XLSX: XlsxLike,
  wb: XlsxWorkbook,
  sheet: XlsxSheet,
  sheetName: string
): void => {
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  enableWorkbookRtl(wb);
};

export const saveWorkbookToFile = async (wb: XlsxWorkbook, fileName: string): Promise<void> => {
  const XLSX = await loadXLSX();
  let cleanName = sanitizeFileName(fileName);
  if (!cleanName.toLowerCase().endsWith('.xlsx')) {
    cleanName += '.xlsx';
  }
  XLSX.writeFile(wb, cleanName);
};

/** يحوّل ملف العمل إلى Blob (للاستخدام مع واجهات المشاركة/الطباعة). */
export const workbookToBlob = async (wb: XlsxWorkbook): Promise<Blob> => {
  const XLSX = await loadXLSX();
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};
