// ============================================
// Quotation Excel Exporter — شبكة احترافية ملوّنة
// ============================================
// يبني ورقة عرض سعر كجدول شبكي كامل: شريط ترويسة فخم لاسم المنشأة، شريط نوع
// المستند، شبكة بيانات وصفية، رأس جدول ملوّن، صفوفاً متناوبة الظل، وكتلة إجماليات
// بارزة — كل ذلك بحدود على كل خلية واتجاه RTL.
//
// الألوان تُمرَّر كـ palette إلى المحرّك الموحّد (excelExporterBase) فلا تتكرر
// حلقة التنسيق هنا.

import {
  loadXLSX,
  buildStyledSheet,
  appendSheetToWorkbook,
  saveWorkbookToFile,
  workbookToBlob,
} from './excelExporterBase';
import type {
  ExcelBandRow,
  ExcelMergeRange,
  ExcelPalette,
  ExcelStylingOptions,
  XlsxWorkbook,
} from './excelExporterBase';

export interface QuotationExcelItem {
  name: string;
  sku?: string | undefined;
  partNumber?: string | undefined;
  brand?: string | undefined;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | undefined;
  total: number;
}

export interface QuotationExcelData {
  companyName: string;
  companyNameEn?: string | undefined;
  companySpecialization?: string | undefined;
  companyAddress?: string | undefined;
  companyPhone?: string | undefined;
  taxNumber?: string | undefined;
  quotationNumber: string;
  issueDate: string;
  validUntil?: string | undefined;
  customerName: string;
  customerPhone?: string | undefined;
  /** 'العميل' (افتراضياً) أو 'المورد' لعروض المشتريات — يغيّر تسميات الشبكة. */
  partyNoun?: string | undefined;
  issuedBy: string;
  currency?: string | undefined;
  discountAmount?: number | undefined;
  taxAmount?: number | undefined;
  paymentTerms?: string | undefined;
  deliveryTerms?: string | undefined;
  items: QuotationExcelItem[];
  subtotal: number;
  totalAmount: number;
  notes?: string | undefined;
  /** لون تمييز الترويسة (افتراضياً كحلي ملكي). */
  accentColor?: string | undefined;
}

/** مواضع ثابتة تُحسب منها بقية الصفوف — تجعل التنسيق والدمج دقيقين. */
const LAYOUT = {
  companyRow: 0,
  taglineRow: 1,
  contactRow: 2,
  titleRow: 4,
  metaFirstRow: 6,
  metaLastRow: 8,
  tableHeaderRow: 10,
} as const;

const COLUMNS = 8;
const LAST_COL = COLUMNS - 1;
const ITEMS_START = LAYOUT.tableHeaderRow + 1;
const DEFAULT_ACCENT = '1F4E78';

const text = (value: string | undefined | null): string => (value ?? '').trim();
const amount = (value: number | undefined): number => value ?? 0;

/**
 * يُطبّع لون التمييز إلى صيغة xlsx (ستة أرقام hex بلا `#`).
 * أي قيمة غير صالحة ترجع إلى الكحلي الافتراضي بدل تلوين خاطئ في الملف.
 */
export const normalizeAccent = (value: string): string => {
  const raw = value.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : DEFAULT_ACCENT;
};

/** لوحة ألوان فخمة مشتقة من لون التمييز (كاملة حتى لا تبقى قيم اختيارية). */
export const quotationPalette = (accent: string): ExcelPalette => ({
  accent,
  titleFill: accent,
  subtitleFill: 'EAF1FA',
  headerFill: accent,
  headerFont: 'FFFFFF',
  metaFill: 'F3F6FB',
  summaryFill: 'EAF1FA',
  alternateFill: 'F8FAFC',
  border: 'D6DEE8',
});

const contactLine = (data: QuotationExcelData): string =>
  [
    text(data.companyAddress),
    text(data.companyPhone) !== '' ? `هاتف: ${text(data.companyPhone)}` : '',
    text(data.taxNumber) !== '' ? `الرقم الضريبي: ${text(data.taxNumber)}` : '',
    text(data.companyNameEn),
  ]
    .filter(part => part !== '')
    .join('  •  ');

const buildTopRows = (data: QuotationExcelData): unknown[][] => [
  [data.companyName],
  [text(data.companySpecialization)],
  [contactLine(data)],
  [],
  [`عرض سعر  —  ${data.quotationNumber}`],
  [],
];

const buildMetaRows = (data: QuotationExcelData, currency: string): unknown[][] => {
  const noun = text(data.partyNoun) !== '' ? text(data.partyNoun) : 'العميل';
  return [
    [noun, data.customerName, '', '', 'تاريخ الإصدار', data.issueDate, '', ''],
    [
      'صالح حتى',
      text(data.validUntil) !== '' ? text(data.validUntil) : '—',
      '',
      '',
      'العملة',
      currency,
      '',
      '',
    ],
    [
      'صادر بواسطة',
      data.issuedBy,
      '',
      '',
      `هاتف ${noun}`,
      text(data.customerPhone) !== '' ? text(data.customerPhone) : '—',
      '',
      '',
    ],
    [],
  ];
};

const buildTableHeaderRow = (currency: string): unknown[] => [
  '#',
  'رقم القطعة',
  'الوصف',
  'الماركة',
  'الكمية',
  `سعر الوحدة (${currency})`,
  'خصم %',
  `الإجمالي (${currency})`,
];

const buildItemRow = (item: QuotationExcelItem, index: number): unknown[] => {
  const partNumber = text(item.partNumber);
  const discount = amount(item.discountPercent);
  return [
    index + 1,
    partNumber !== '' ? partNumber : text(item.sku),
    text(item.name),
    text(item.brand),
    amount(item.quantity),
    amount(item.unitPrice),
    discount > 0 ? `${String(discount)}%` : '—',
    amount(item.total),
  ];
};

const buildItemRows = (items: QuotationExcelItem[]): unknown[][] => {
  if (items.length === 0) {
    return [['', '', 'لا توجد أصناف في هذا العرض', '', '', '', '', '']];
  }
  return items.map(buildItemRow);
};

const buildSummaryRows = (data: QuotationExcelData, currency: string): unknown[][] => [
  [`المجموع الفرعي (${currency})`, '', '', '', '', '', amount(data.subtotal), ''],
  [`الخصم (${currency})`, '', '', '', '', '', amount(data.discountAmount), ''],
  [`الضريبة (${currency})`, '', '', '', '', '', amount(data.taxAmount), ''],
  [`الإجمالي النهائي (${currency})`, '', '', '', '', '', amount(data.totalAmount), ''],
];

interface FooterBlock {
  rows: unknown[][];
  /** فهرس صف الشكر (الشريط الأخير). */
  thanksRow: number;
}

const buildFooterBlock = (data: QuotationExcelData, grandTotalRow: number): FooterBlock => {
  const rows: unknown[][] = [[]];
  const addLine = (label: string, value: string): void => {
    if (value === '') return;
    rows.push([label, value, '', '', '', '', '', '']);
  };

  addLine('شروط الدفع', text(data.paymentTerms));
  addLine('شروط التسليم', text(data.deliveryTerms));
  addLine('ملاحظات', text(data.notes));

  const validity = text(data.validUntil);
  rows.push([
    validity !== ''
      ? `شكراً لتعاملكم معنا — هذا العرض ساري حتى ${validity}`
      : 'شكراً لتعاملكم معنا',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);

  return { rows, thanksRow: grandTotalRow + 1 + rows.length - 1 };
};

interface QuotationSheetLayout {
  rows: unknown[][];
  itemsEndRow: number;
  summaryStartRow: number;
  grandTotalRow: number;
  notesFirstRow: number;
  thanksRow: number;
  hasNotes: boolean;
}

const buildSheetLayout = (data: QuotationExcelData, currency: string): QuotationSheetLayout => {
  const itemRows = buildItemRows(data.items);
  const rows: unknown[][] = [
    ...buildTopRows(data),
    ...buildMetaRows(data, currency),
    buildTableHeaderRow(currency),
    ...itemRows,
  ];

  const itemsEndRow = ITEMS_START + itemRows.length - 1;
  rows.push([]); // فاصل
  const summaryStartRow = rows.length;
  rows.push(...buildSummaryRows(data, currency));
  const grandTotalRow = summaryStartRow + 3;

  const footer = buildFooterBlock(data, grandTotalRow);
  rows.push(...footer.rows);

  return {
    rows,
    itemsEndRow,
    summaryStartRow,
    grandTotalRow,
    notesFirstRow: grandTotalRow + 2,
    thanksRow: footer.thanksRow,
    hasNotes:
      footer.rows.length > 2 ||
      text(data.paymentTerms) !== '' ||
      text(data.deliveryTerms) !== '' ||
      text(data.notes) !== '',
  };
};

const rowMerges = (row: number, from: number, to: number): ExcelMergeRange => ({
  s: { r: row, c: from },
  e: { r: row, c: to },
});

const META_ROWS: number[] = [LAYOUT.metaFirstRow, LAYOUT.metaFirstRow + 1, LAYOUT.metaFirstRow + 2];

const buildMerges = (layout: QuotationSheetLayout): ExcelMergeRange[] => {
  const merges: ExcelMergeRange[] = [
    rowMerges(LAYOUT.companyRow, 0, LAST_COL),
    rowMerges(LAYOUT.taglineRow, 0, LAST_COL),
    rowMerges(LAYOUT.contactRow, 0, LAST_COL),
    rowMerges(LAYOUT.titleRow, 0, LAST_COL),
  ];

  for (const row of META_ROWS) {
    merges.push(rowMerges(row, 1, 3), rowMerges(row, 5, LAST_COL));
  }

  for (let row = layout.summaryStartRow; row <= layout.grandTotalRow; row++) {
    merges.push(rowMerges(row, 0, 5), rowMerges(row, 6, LAST_COL));
  }

  for (let row = layout.notesFirstRow; row < layout.thanksRow; row++) {
    merges.push(rowMerges(row, 1, LAST_COL));
  }
  merges.push(rowMerges(layout.thanksRow, 0, LAST_COL));
  return merges;
};

const buildBands = (accent: string, palette: ExcelPalette): ExcelBandRow[] => [
  {
    row: LAYOUT.companyRow,
    fill: palette.titleFill,
    fontColor: palette.headerFont,
    fontSize: 18,
    height: 34,
  },
  {
    row: LAYOUT.taglineRow,
    fill: palette.subtitleFill,
    fontColor: accent,
    fontSize: 12,
    height: 20,
  },
  { row: LAYOUT.contactRow, fontSize: 10, bold: false, fontColor: '475569', height: 18 },
  {
    row: LAYOUT.titleRow,
    fill: palette.titleFill,
    fontColor: palette.headerFont,
    fontSize: 14,
    height: 26,
  },
];

const buildStyling = (
  layout: QuotationSheetLayout,
  palette: ExcelPalette,
  bands: ExcelBandRow[]
): ExcelStylingOptions => ({
  companyRow: LAYOUT.companyRow,
  metaRows: [LAYOUT.metaFirstRow, LAYOUT.metaLastRow],
  metaKeyColumns: [0, 4],
  tableHeaderRow: LAYOUT.tableHeaderRow,
  alternate: {
    startRow: LAYOUT.tableHeaderRow,
    // المحرّك يشترط `row < endRow`، فتمرير فهرس آخر بند يستثنيه ويلغي التظليل كله.
    endRow: layout.itemsEndRow + 1,
    parity: 'even',
  },
  summaryRows: [layout.summaryStartRow, layout.grandTotalRow - 1],
  summaryKeyCol: 0,
  summaryValueCol: 6,
  notesRow: layout.notesFirstRow,
  integerColumns: [0, 4],
  columnCount: COLUMNS,
  palette,
  bandRows: bands,
});

const buildQuotationWorkbookFrom = async (data: QuotationExcelData): Promise<XlsxWorkbook> => {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const currency = text(data.currency) !== '' ? text(data.currency) : 'SAR';
  const accent = normalizeAccent(text(data.accentColor));
  const palette = quotationPalette(accent);
  const layout = buildSheetLayout(data, currency);

  const bands: ExcelBandRow[] = [
    ...buildBands(accent, palette),
    {
      row: layout.grandTotalRow,
      fill: palette.titleFill,
      fontColor: palette.headerFont,
      fontSize: 14,
      height: 26,
    },
    {
      row: layout.thanksRow,
      fill: palette.summaryFill,
      fontColor: accent,
      fontSize: 11,
      height: 22,
    },
  ];

  const ws = buildStyledSheet(XLSX, layout.rows, {
    colWidths: [6, 18, 40, 14, 9, 15, 9, 16],
    merges: buildMerges(layout),
    styling: buildStyling(layout, palette, bands),
  });

  appendSheetToWorkbook(XLSX, wb, ws, 'عرض سعر');
  return wb;
};

export const generateQuotationWorkbook = (data: QuotationExcelData): Promise<XlsxWorkbook> =>
  buildQuotationWorkbookFrom(data);

export const exportQuotationToExcel = async (data: QuotationExcelData): Promise<void> => {
  const wb = await generateQuotationWorkbook(data);
  await saveWorkbookToFile(wb, `عرض_سعر_${data.quotationNumber}.xlsx`);
};

export const generateQuotationExcelBlob = async (data: QuotationExcelData): Promise<Blob> => {
  const wb = await generateQuotationWorkbook(data);
  return workbookToBlob(wb);
};
