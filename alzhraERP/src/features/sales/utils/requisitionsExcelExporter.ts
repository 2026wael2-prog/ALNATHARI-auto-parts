/* eslint-disable complexity, max-lines-per-function, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-floating-promises */
// ============================================
// Sales Requisitions Excel Exporter
// Professional styled Excel export for purchase requisitions
// Uses shared excelExporterBase for lean bundle and uniform styling
// ============================================

import {
  loadXLSX,
  buildStyledSheet,
  appendSheetToWorkbook,
  saveWorkbookToFile,
  sanitizeFileName,
} from '@/core/utils/excelExporterBase';
import type { ExcelMergeRange, XlsxWorkbook } from '@/core/utils/excelExporterBase';
import type { RequisitionItem, RequisitionSupplier } from '../types/requisitions';
import { filledRequisitionItems, sumRequisitionQuantities } from './requisitionsValidation';
import { formatLocalDate } from '@/core/utils/dateUtils';

export interface RequisitionExcelPayload {
  companyName: string;
  companyAddress?: string;
  taxNumber?: string;
  supplier?: RequisitionSupplier | null;
  items: RequisitionItem[];
  title?: string;
  notes?: string;
  date?: string;
  /** Server document number (REQ-YYYY-NNNN) when the requisition was saved. */
  number?: string | null;
}

export const generateRequisitionsWorkbook = async (
  payload: RequisitionExcelPayload
): Promise<XlsxWorkbook> => {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();

  const rows: unknown[][] = [];
  const reqDate = payload.date || formatLocalDate();
  const supplierName = payload.supplier?.name.trim() || 'عام / غير محدد';
  const supplierPhone = payload.supplier?.phone?.trim() || '---';
  // Audit F17: placeholder rows never reach the sheet, and no quantity is
  // silently rewritten to 1.
  const items = filledRequisitionItems(payload.items);
  const totalQty = sumRequisitionQuantities(items);

  // 1. Company Header
  rows.push([payload.companyName]);
  rows.push([payload.companyAddress || '']);
  rows.push([`الرقم الضريبي: ${payload.taxNumber || '---'}`]);
  rows.push([]);

  // 2. Document Title
  const documentTitle = payload.title || 'قائمة المنتجات والقطع المطلوبة (طلب شراء)';
  rows.push([payload.number ? documentTitle + ' — رقم ' + payload.number : documentTitle]);
  rows.push([]);

  // 3. Meta Information
  rows.push(['المورد:', supplierName, '', 'الهاتف:', supplierPhone]);
  rows.push(['تاريخ الطلب:', reqDate, '', 'عدد الأصناف:', items.length]);
  rows.push(['رقم الطلب:', payload.number || 'لم يُرقّم بعد', '', 'إجمالي الكميات:', totalQty]);
  rows.push([]);

  // 4. Table Header
  const headerRowIndex = rows.length;
  rows.push([
    '#',
    'اسم القطعة المطلوبة',
    'رقم القطعة (Part No)',
    'الشركة الصانعة',
    'الكمية',
    'ملاحظات',
  ]);

  // 5. Data Rows
  items.forEach((item, idx) => {
    rows.push([
      idx + 1,
      item.name || '---',
      item.partNumber || '---',
      item.brand || '---',
      Number(item.quantity) || 0,
      item.notes || '',
    ]);
  });

  // 6. Summary Footer
  rows.push([]);
  const summaryRowIndex = rows.length;
  rows.push(['', '', '', 'إجمالي الكميات المطلوبة:', totalQty, '']);

  if (payload.notes?.trim()) {
    rows.push([]);
    rows.push(['ملاحظات إضافية:', payload.notes.trim()]);
  }

  // Merges
  const merges: ExcelMergeRange[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, // Company Name
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, // Address
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }, // Tax
    { s: { r: 4, c: 0 }, e: { r: 4, c: 5 } }, // Title
  ];

  if (payload.notes?.trim()) {
    merges.push({
      s: { r: rows.length - 1, c: 1 },
      e: { r: rows.length - 1, c: 5 },
    });
  }

  const ws = buildStyledSheet(XLSX, rows, {
    colWidths: [6, 38, 22, 20, 12, 30],
    merges,
    styling: {
      companyRow: 0,
      subHeaderRows: [1, 2],
      metaRows: [6, 8],
      metaKeyColumns: [0, 3],
      tableHeaderRow: headerRowIndex,
      summaryRows: [summaryRowIndex, summaryRowIndex],
      summaryKeyCol: 3,
      summaryValueCol: 4,
      alternate: {
        startRow: headerRowIndex + 1,
        endRow: summaryRowIndex - 1,
        parity: 'even',
      },
      integerColumns: [0, 4], // Row number and quantity formatted as integer #,##0
    },
  });

  appendSheetToWorkbook(XLSX, wb, ws, 'المطلوبات');
  return wb;
};

export const exportRequisitionsToExcel = async (
  payload: RequisitionExcelPayload
): Promise<void> => {
  const wb = await generateRequisitionsWorkbook(payload);
  const supplierPart = payload.supplier?.name ? sanitizeFileName(payload.supplier.name) : 'عام';
  const numberPart = payload.number ? sanitizeFileName(payload.number) + '_' : '';
  const fileName = `مطلوبات_${numberPart}${supplierPart}_${formatLocalDate()}.xlsx`;
  saveWorkbookToFile(wb, fileName);
};
