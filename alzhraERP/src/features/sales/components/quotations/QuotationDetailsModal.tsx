// ============================================
// نافذة تفاصيل عرض السعر
// ============================================
// كانت تكرّر قالب الطباعة داخل النافذة (ترويسة + جدول + CSS حجب بـvisibility)،
// وتشارك ملف إكسل عبر واتساب. الآن تعرض قالب الطباعة الموحّد PrintableQuotation
// (يوفّر الطباعة وتصدير PDF وتغيير التخطيط واللون)، وترسل نصاً مقروءاً عبر واتساب.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC, ReactElement, RefObject } from 'react';
import {
  ArrowRightLeft,
  CheckCircle,
  Copy,
  FileText,
  Loader2,
  Send,
  Share2,
  XCircle,
} from 'lucide-react';
import Modal from '@/ui/base/Modal';
import { PdfCaptureHost } from '@/core/components/PdfCaptureHost';
import type { WhatsappHeaderConfig } from '@/core/types/documentHeader';
import { buildWhatsappHeader } from '@/core/utils/whatsappHeader';
import { exportToPDF } from '@/core/utils/pdfExporter';
import { logger } from '@/core/utils/logger';
import { parseError } from '@/core/utils/errorUtils';
import {
  exportQuotationToExcel,
  generateQuotationExcelBlob,
} from '@/core/utils/quotationExcelExporter';
import type { QuotationExcelData } from '@/core/utils/quotationExcelExporter';
import { shareSpreadsheet } from '@/core/utils/shareUtils';
import { useAuthStore } from '@/features/auth/store';
import { useFeedbackStore } from '@/features/feedback/store';
import { useCompany } from '@/features/settings/hooks';
import { useDocumentHeaderSettings, useInvoiceSettings } from '@/features/settings/settingsStore';
import { salesQuotationsApi } from '../../api/quotationsApi';
import type { QuotationDetailItem, QuotationDetailRow } from '../../api/quotationsApi';
import { useSalesStore } from '../../store';
import type { SalesCartItem } from '../../store';
import {
  buildQuotationCaption,
  copyQuotationText,
  openQuotationTelegram,
  openQuotationWhatsApp,
} from '../../utils/quotationShareHelper';
import type { QuotationSharePayload } from '../../utils/quotationShareHelper';
import PrintableQuotation from './PrintableQuotation';
import type { QuotationRowAction } from './QuotationActionIcons';
import {
  mapQuotationToPrintData,
  toQuotationExcelData,
  toSharePayload,
} from './print/quotationPrintModel';
import type { QuotationExcelContext } from './print/quotationPrintModel';

interface QuotationDetailsModalProps {
  quotationId: string;
  onClose: () => void;
  onRefresh: () => void;
  onConvertToInvoice?: (() => void) | undefined;
  /** إجراء يبدأ تلقائياً بعد تحميل العرض (من أيقونات قائمة العروض). */
  initialAction?: QuotationRowAction | undefined;
}

interface StatusAction {
  label: string;
  icon: ReactElement;
  color: string;
  nextStatus: string;
}

const statusActions = (status: string): StatusAction[] => {
  switch (status) {
    case 'draft':
      return [
        {
          label: 'إرسال للعميل',
          icon: <Send size={14} />,
          color: 'bg-blue-600 hover:bg-blue-700',
          nextStatus: 'sent',
        },
      ];
    case 'sent':
      return [
        {
          label: 'قبول',
          icon: <CheckCircle size={14} />,
          color: 'bg-emerald-600 hover:bg-emerald-700',
          nextStatus: 'accepted',
        },
        {
          label: 'رفض',
          icon: <XCircle size={14} />,
          color: 'bg-rose-600 hover:bg-rose-700',
          nextStatus: 'rejected',
        },
      ];
    case 'accepted':
      return [
        {
          label: 'تحويل لفاتورة',
          icon: <ArrowRightLeft size={14} />,
          color: 'bg-indigo-600 hover:bg-indigo-700',
          nextStatus: 'converted',
        },
      ];
    default:
      return [];
  }
};

/** قراءة نصية آمنة (null → سلسلة فارغة) بلا تكرار لمعامل `??`. */
const text = (value: string | null | undefined): string => value ?? '';

const toCartItem = (item: QuotationDetailItem): SalesCartItem => {
  const unitPrice = item.unit_price;
  const product = item.product;
  return {
    id: crypto.randomUUID(),
    productId: text(item.product_id),
    sku: text(product?.sku),
    name: text(product?.name_ar) !== '' ? text(product?.name_ar) : item.description,
    partNumber: text(product?.part_number),
    brand: text(product?.brand),
    quantity: item.quantity,
    basePrice: unitPrice,
    price: unitPrice,
    discount: item.discount_percent > 0 ? (unitPrice * item.discount_percent) / 100 : 0,
    costPrice: product?.cost_price ?? 0,
  };
};

/** ينسخ أصناف العرض إلى سلة البيع استعداداً لتحويله إلى فاتورة. */
const applyQuotationToCart = (quotation: QuotationDetailRow): void => {
  const { resetCart, setCustomer, setMetadata, calculateTotals } = useSalesStore.getState();
  resetCart();

  const party = quotation.party;
  if (party !== null) {
    setCustomer({
      id: party.id,
      name: party.name,
      ...(party.phone !== null ? { phone: party.phone } : {}),
    });
  }

  setMetadata('invoiceType', 'credit');
  useSalesStore.setState({ items: quotation.quotation_items.map(toCartItem) });
  calculateTotals();
};

interface QuotationState {
  quotation: QuotationDetailRow | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const useQuotationDetails = (quotationId: string): QuotationState => {
  const [quotation, setQuotation] = useState<QuotationDetailRow | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    const { data } = await salesQuotationsApi.getQuotationDetails(quotationId);
    setQuotation(data);
    setLoading(false);
  }, [quotationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { quotation, loading, reload };
};

/** سياق بيانات المنشأة لملف الإكسل (لون التمييز الافتراضي كحلي ملكي). */
interface ExcelContextInput {
  company: ReturnType<typeof useCompany>['data'];
  specialization: string;
  issuedBy: string;
}

type CompanyLike = ReturnType<typeof useCompany>['data'];

const companyIdentityFor = (
  company: CompanyLike
): { companyName: string; companyNameEn: string } => ({
  companyName: company?.name_ar ?? 'الشركة',
  companyNameEn: company?.name_en ?? '',
});

const companyContactFor = (
  company: CompanyLike
): { companyAddress: string; companyPhone: string; taxNumber: string } => ({
  companyAddress: company?.address ?? '',
  companyPhone: company?.phone ?? '',
  taxNumber: company?.tax_number ?? '',
});

const excelContextFor = (input: ExcelContextInput): QuotationExcelContext => ({
  ...companyIdentityFor(input.company),
  ...companyContactFor(input.company),
  companySpecialization: input.specialization,
  issuedBy: input.issuedBy,
  accentColor: '1F4E78',
});

const excelDataFor = (
  quotation: QuotationDetailRow,
  context: QuotationExcelContext
): QuotationExcelData => toQuotationExcelData(mapQuotationToPrintData(quotation), context);

/**
 * يشارك ملف الإكسل عبر ورقة المشاركة الأصلية (يختار المستخدم واتساب من النظام)،
 * وعند تعذّرها يُنزّل الملف ثم يفتح واتساب بالتعليق نفسه.
 */
const sendExcelToWhatsApp = async (data: QuotationExcelData, caption: string): Promise<void> => {
  const blob = await generateQuotationExcelBlob(data);
  await shareSpreadsheet({
    blob,
    fileName: `عرض_سعر_${data.quotationNumber}.xlsx`,
    shareTitle: `عرض سعر ${data.quotationNumber}`,
    shareText: caption,
    fallbackText: caption,
    onDownloadFallback: () => exportQuotationToExcel(data),
  });
};

/**
 * هل يدعم هذا المتصفح مشاركة ملفات فعلية (`navigator.share` مع `files`)؟
 * سطح المكتب غالباً لا يدعمها؛ والاعتماد عليها يعني زراً لا يفعل شيئاً على الشاشة.
 * الفحص متزامن عمداً حتى يُتّخذ القرار داخل إيماءة النقر نفسها.
 */
const supportsNativeFileShare = (): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File(['probe'], 'probe.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

/** يسجّل فشل المشاركة ويعرض سببه للمستخدم بدل الفشل الصامت. */
const reportShareError = (
  error: unknown,
  notify: (message: string, type: 'success' | 'error') => void
): void => {
  logger.error('QuotationDetailsModal', 'WhatsApp share failed', error);
  notify(parseError(error).message, 'error');
};

/**
 * تنفيذ إرسال واتساب بطريقتين حسب قدرة المتصفح:
 * - بلا مشاركة ملفات أصلية (سطح المكتب): نفتح المحادثة فوراً ومزامنةً داخل إيماءة
 *   النقر ثم ننزّل الملف ليُرفق — لأن أي `window.open` بعد `await` تحجبه المتصفحات.
 * - مع مشاركة الملفات الأصلية (الجوال): نُظهر ورقة المشاركة ليُرفق الملف مباشرة.
 */
const runWhatsAppShare = (
  data: QuotationExcelData,
  payload: QuotationSharePayload,
  notify: (message: string, type: 'success' | 'error') => void
): void => {
  if (!supportsNativeFileShare()) {
    openQuotationWhatsApp(payload);
    void exportQuotationToExcel(data).then(
      () => {
        notify('تم فتح واتساب وتنزيل ملف العرض لإرفاقه', 'success');
      },
      (error: unknown) => {
        reportShareError(error, notify);
      }
    );
    return;
  }
  void sendExcelToWhatsApp(data, buildQuotationCaption(payload)).then(
    () => {
      notify('تم تجهيز ملف عرض السعر للإرسال', 'success');
    },
    (error: unknown) => {
      reportShareError(error, notify);
    }
  );
};

interface ShareOptions {
  quotation: QuotationDetailRow | null;
  companyName: string;
  companyPhone: string;
  companyTaxNumber: string;
  slogan: string;
  whatsapp: WhatsappHeaderConfig;
  issuedBy: string;
  excelContext: QuotationExcelContext;
  notify: (message: string, type: 'success' | 'error') => void;
}

const useSharePayload = (options: ShareOptions): QuotationSharePayload | null => {
  const { quotation, companyName, companyPhone, companyTaxNumber, slogan, whatsapp } = options;
  return useMemo(() => {
    if (quotation === null) return null;
    const headerText = buildWhatsappHeader(whatsapp, {
      name: companyName,
      phone: companyPhone,
      taxNumber: companyTaxNumber,
      slogan,
    });
    return toSharePayload(mapQuotationToPrintData(quotation), { companyName, headerText });
  }, [quotation, companyName, companyPhone, companyTaxNumber, slogan, whatsapp]);
};

interface ShareResult {
  shareWhatsApp: () => void;
  shareTelegram: () => void;
  copyText: () => void;
  exportExcel: () => void;
}

const useQuotationShare = (options: ShareOptions): ShareResult => {
  const { quotation, excelContext, notify } = options;
  const payload = useSharePayload(options);

  const buildExcel = useCallback(
    (): QuotationExcelData | null =>
      quotation === null ? null : excelDataFor(quotation, excelContext),
    [quotation, excelContext]
  );

  // زر «واتساب»: يفتح المحادثة فوراً ثم يجهّز ملف الإكسل (التفاصيل في runWhatsAppShare).
  const shareWhatsApp = useCallback((): void => {
    const data = buildExcel();
    if (data === null || payload === null) {
      notify('لم تُحمَّل بيانات العرض بعد، أعد المحاولة بعد لحظة', 'error');
      return;
    }
    runWhatsAppShare(data, payload, notify);
  }, [buildExcel, payload, notify]);

  const shareTelegram = useCallback((): void => {
    if (payload === null) {
      notify('لم تُحمَّل بيانات العرض بعد، أعد المحاولة بعد لحظة', 'error');
      return;
    }
    openQuotationTelegram(payload);
  }, [payload, notify]);

  const copyText = useCallback((): void => {
    if (payload === null) return;
    void copyQuotationText(payload).then(copied => {
      notify(copied ? 'تم نسخ نص العرض' : 'تعذّر النسخ', copied ? 'success' : 'error');
    });
  }, [payload, notify]);

  const exportExcel = useCallback((): void => {
    const data = buildExcel();
    if (data === null) return;
    void exportQuotationToExcel(data).then(() => {
      notify('تم تنزيل ملف عرض السعر', 'success');
    });
  }, [buildExcel, notify]);

  return { shareWhatsApp, shareTelegram, copyText, exportExcel };
};

interface PdfResult {
  printRef: RefObject<HTMLDivElement | null>;
  isExporting: boolean;
  exportPdf: () => Promise<void>;
}

const useQuotationPdf = (quotation: QuotationDetailRow | null): PdfResult => {
  const printRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const exportPdf = useCallback(async (): Promise<void> => {
    setIsExporting(true);
    // مهلة قصيرة حتى يُثبّت React نسخة الالتقاط في DOM قبل القياس.
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      if (printRef.current !== null) {
        const number = quotation?.quotation_number ?? 'عرض-سعر';
        await exportToPDF(printRef.current, `عرض-سعر-${number}`);
      }
    } catch (error) {
      logger.error('QuotationDetailsModal', 'PDF export failed', error);
    } finally {
      setIsExporting(false);
    }
  }, [quotation]);

  return { printRef, isExporting, exportPdf };
};

interface ActionOptions {
  quotation: QuotationDetailRow | null;
  onClose: () => void;
  onRefresh: () => void;
  onConvertToInvoice?: (() => void) | undefined;
  reload: () => Promise<void>;
}

const useQuotationAction = (
  options: ActionOptions
): { busy: boolean; run: (s: string) => void } => {
  const { quotation, onClose, onRefresh, onConvertToInvoice, reload } = options;
  const [busy, setBusy] = useState<boolean>(false);

  const run = useCallback(
    (nextStatus: string): void => {
      if (quotation === null) return;
      void (async (): Promise<void> => {
        setBusy(true);
        try {
          if (nextStatus === 'converted') {
            applyQuotationToCart(quotation);
            await salesQuotationsApi.markAsConverted(quotation.id);
            onClose();
            if (onConvertToInvoice !== undefined) onConvertToInvoice();
            return;
          }
          await salesQuotationsApi.updateStatus(quotation.id, nextStatus);
          await reload();
          onRefresh();
        } finally {
          setBusy(false);
        }
      })();
    },
    [quotation, onClose, onRefresh, onConvertToInvoice, reload]
  );

  return { busy, run };
};

const FooterButton = ({
  label,
  icon,
  onClick,
  tone,
}: {
  label: string;
  icon: ReactElement;
  onClick: () => void;
  tone: string;
}): ReactElement => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors sm:px-3 sm:py-2 ${tone}`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

interface ShareButtonsProps {
  onWhatsApp: () => void;
  onTelegram: () => void;
  onCopy: () => void;
  onExcel: () => void;
}

const ShareButtons = ({
  onWhatsApp,
  onTelegram,
  onCopy,
  onExcel,
}: ShareButtonsProps): ReactElement => (
  <>
    <FooterButton
      label="واتساب"
      icon={<Share2 size={14} />}
      onClick={onWhatsApp}
      tone="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/30 dark:bg-emerald-900/20 dark:text-emerald-400"
    />
    <FooterButton
      label="تيليجرام"
      icon={<Send size={14} />}
      onClick={onTelegram}
      tone="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800/30 dark:bg-sky-900/20 dark:text-sky-400"
    />
    <FooterButton
      label="نسخ النص"
      icon={<Copy size={14} />}
      onClick={onCopy}
      tone="border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-slate-700 dark:text-gray-400 dark:hover:bg-slate-800"
    />
    <FooterButton
      label="إكسل"
      icon={<FileText size={14} />}
      onClick={onExcel}
      tone="border-emerald-100 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800/20 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
    />
  </>
);

interface FooterProps {
  busy: boolean;
  actions: StatusAction[];
  onClose: () => void;
  onWhatsApp: () => void;
  onTelegram: () => void;
  onCopy: () => void;
  onExcel: () => void;
  run: (nextStatus: string) => void;
}

const QuotationFooter = ({
  busy,
  actions,
  onClose,
  onWhatsApp,
  onTelegram,
  onCopy,
  onExcel,
  run,
}: FooterProps): ReactElement => (
  <div className="no-print flex w-full flex-wrap items-center justify-between gap-1.5 sm:gap-2">
    <button
      type="button"
      onClick={onClose}
      className="rounded-lg px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800 sm:px-4 sm:py-2 sm:text-sm"
    >
      إغلاق
    </button>
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <ShareButtons
        onWhatsApp={onWhatsApp}
        onTelegram={onTelegram}
        onCopy={onCopy}
        onExcel={onExcel}
      />
      {actions.map(action => (
        <button
          key={action.nextStatus}
          type="button"
          onClick={() => {
            run(action.nextStatus);
          }}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm ${action.color}`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : action.icon}
          {action.label}
        </button>
      ))}
    </div>
  </div>
);

interface BodyProps {
  loading: boolean;
  quotation: QuotationDetailRow | null;
  exportPdf: () => void;
  isExporting: boolean;
  printRef: RefObject<HTMLDivElement | null>;
}

const QuotationBody = ({
  loading,
  quotation,
  exportPdf,
  isExporting,
  printRef,
}: BodyProps): ReactElement => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }
  if (quotation === null) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        تعذّر تحميل عرض السعر
      </div>
    );
  }
  return (
    <>
      <div className="custom-scrollbar flex max-h-[70vh] justify-center overflow-auto rounded-xl bg-slate-200 p-3 dark:bg-slate-900">
        <div className="w-full max-w-4xl shrink-0 rounded-xl border border-slate-300 bg-white p-2 shadow-lg">
          <PrintableQuotation
            quotation={quotation}
            onExportPDF={exportPdf}
            isExporting={isExporting}
          />
        </div>
      </div>
      {isExporting && (
        <PdfCaptureHost innerRef={printRef}>
          <PrintableQuotation quotation={quotation} />
        </PdfCaptureHost>
      )}
    </>
  );
};

interface ShareOptionInput {
  quotation: QuotationDetailRow | null;
  company: ReturnType<typeof useCompany>['data'];
  specialization: string;
  issuedBy: string;
  headerConfig: ReturnType<typeof useDocumentHeaderSettings>;
  notify: (message: string, type: 'success' | 'error') => void;
}

/** يبني خيارات المشاركة خارج المكوّن لإبقاء تعقيده منخفضاً. */
const buildShareOptions = (input: ShareOptionInput): ShareOptions => ({
  quotation: input.quotation,
  companyName: input.company?.name_ar ?? 'الشركة',
  companyPhone: input.company?.phone ?? '',
  companyTaxNumber: input.company?.tax_number ?? '',
  slogan: input.headerConfig.details.sloganText ?? '',
  whatsapp: input.headerConfig.whatsapp,
  issuedBy: input.issuedBy,
  excelContext: excelContextFor({
    company: input.company,
    specialization: input.specialization,
    issuedBy: input.issuedBy,
  }),
  notify: input.notify,
});

interface FooterBarProps {
  quotation: QuotationDetailRow | null;
  busy: boolean;
  share: ShareResult;
  onClose: () => void;
  run: (nextStatus: string) => void;
}

const QuotationFooterBar = ({
  quotation,
  busy,
  share,
  onClose,
  run,
}: FooterBarProps): ReactElement => (
  <QuotationFooter
    busy={busy}
    /* عروض المشتريات تُشارك كعرض سعر فقط: أزرار المبيعات (إرسال للعميل/قبول/
       رفض/تحويل لفاتورة) لا معنى لها ولا يجوز ظهورها لمستخدم المشتريات. */
    actions={
      quotation !== null && quotation.type === 'purchase'
        ? []
        : statusActions(quotation?.status ?? '')
    }
    onClose={onClose}
    onWhatsApp={share.shareWhatsApp}
    onTelegram={share.shareTelegram}
    onCopy={share.copyText}
    onExcel={share.exportExcel}
    run={run}
  />
);

/** يجمع سياق المشاركة (المنشأة، المستخدم، قالب الترويسة) في مكان واحد. */
const useQuotationShareFor = (quotation: QuotationDetailRow | null): ShareResult => {
  const { data: company } = useCompany();
  const { user } = useAuthStore();
  const headerConfig = useDocumentHeaderSettings();
  const invoiceSettings = useInvoiceSettings();
  const { showToast } = useFeedbackStore();

  return useQuotationShare(
    buildShareOptions({
      quotation,
      company,
      specialization: invoiceSettings.company_specialization,
      issuedBy: user?.full_name ?? user?.email ?? 'النظام',
      headerConfig,
      notify: showToast,
    })
  );
};

/**
 * ينفّذ إجراءً مطلوباً من القائمة مرة واحدة بعد جهوزية العرض.
 * يُحرس بـ ref لا بحالة: تحويله لحالة كان يسبب إعادة تشغيل التأثير فيُلغي
 * مؤقّت الطباعة (`clearTimeout`) قبل انقضاء المهلة فلا تُستدعى `window.print()` أبداً.
 */
const useInitialAction = (
  quotation: QuotationDetailRow | null,
  share: ShareResult,
  initialAction?: QuotationRowAction
): void => {
  const handled = useRef<boolean>(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (handled.current || initialAction === undefined || quotation === null) return;
    handled.current = true;
    if (initialAction === 'print') {
      // مهلة قصيرة حتى يكتمل رسم القالب قبل إظهار نافذة الطباعة.
      timer.current = setTimeout(() => {
        window.print();
      }, 350);
      return;
    }
    if (initialAction === 'excel') {
      share.exportExcel();
      return;
    }
    share.shareWhatsApp();
  }, [initialAction, quotation, share]);

  // إلغاء المؤقّت فقط عند إغلاق النافذة قبل انقضاء المهلة.
  useEffect(
    () => (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );
};

const QuotationDetailsModal: FC<QuotationDetailsModalProps> = ({
  quotationId,
  onClose,
  onRefresh,
  onConvertToInvoice,
  initialAction,
}) => {
  const { quotation, loading, reload } = useQuotationDetails(quotationId);
  const share = useQuotationShareFor(quotation);
  const pdf = useQuotationPdf(quotation);
  const { busy, run } = useQuotationAction({
    quotation,
    onClose,
    onRefresh,
    ...(onConvertToInvoice !== undefined ? { onConvertToInvoice } : {}),
    reload,
  });
  useInitialAction(quotation, share, initialAction);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      icon={FileText}
      title={quotation?.quotation_number ?? 'عرض سعر'}
      description="تفاصيل عرض السعر"
      size="xl"
      footer={
        <QuotationFooterBar
          quotation={quotation}
          busy={busy}
          share={share}
          onClose={onClose}
          run={run}
        />
      }
    >
      <QuotationBody
        loading={loading}
        quotation={quotation}
        exportPdf={() => {
          void pdf.exportPdf();
        }}
        isExporting={pdf.isExporting}
        printRef={pdf.printRef}
      />
    </Modal>
  );
};

export default QuotationDetailsModal;
