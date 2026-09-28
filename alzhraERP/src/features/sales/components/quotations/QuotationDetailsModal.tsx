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
import { exportQuotationToExcel } from '@/core/utils/quotationExcelExporter';
import { useAuthStore } from '@/features/auth/store';
import { useFeedbackStore } from '@/features/feedback/store';
import { useCompany } from '@/features/settings/hooks';
import { useDocumentHeaderSettings } from '@/features/settings/settingsStore';
import { salesQuotationsApi } from '../../api/quotationsApi';
import type { QuotationDetailItem, QuotationDetailRow } from '../../api/quotationsApi';
import { useSalesStore } from '../../store';
import type { SalesCartItem } from '../../store';
import {
  copyQuotationText,
  openQuotationTelegram,
  openQuotationWhatsApp,
} from '../../utils/quotationShareHelper';
import type { QuotationSharePayload } from '../../utils/quotationShareHelper';
import PrintableQuotation from './PrintableQuotation';
import { mapQuotationToPrintData, toSharePayload } from './print/quotationPrintModel';

interface QuotationDetailsModalProps {
  quotationId: string;
  onClose: () => void;
  onRefresh: () => void;
  onConvertToInvoice?: (() => void) | undefined;
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

const emitQuotationExcel = (
  quotation: QuotationDetailRow,
  companyName: string,
  issuedBy: string
): void => {
  const data = mapQuotationToPrintData(quotation);
  void exportQuotationToExcel({
    companyName,
    quotationNumber: data.header.number,
    issueDate: data.header.issueDate,
    validUntil: data.header.validUntil,
    customerName: data.header.customerName,
    issuedBy,
    currency: data.header.currencyCode,
    items: data.items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    subtotal: data.subtotal,
    totalAmount: data.totalAmount,
    notes: data.notes,
  });
};

interface ShareOptions {
  quotation: QuotationDetailRow | null;
  companyName: string;
  companyPhone: string;
  companyTaxNumber: string;
  slogan: string;
  whatsapp: WhatsappHeaderConfig;
  issuedBy: string;
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
  const { quotation, companyName, issuedBy, notify } = options;
  const payload = useSharePayload(options);

  const shareWhatsApp = useCallback((): void => {
    if (payload === null) return;
    openQuotationWhatsApp(payload);
    notify('تم فتح واتساب مع نص العرض', 'success');
  }, [payload, notify]);

  const shareTelegram = useCallback((): void => {
    if (payload === null) return;
    openQuotationTelegram(payload);
  }, [payload]);

  const copyText = useCallback((): void => {
    if (payload === null) return;
    void copyQuotationText(payload).then(copied => {
      notify(copied ? 'تم نسخ نص العرض' : 'تعذّر النسخ', copied ? 'success' : 'error');
    });
  }, [payload, notify]);

  const exportExcel = useCallback((): void => {
    if (quotation === null) return;
    emitQuotationExcel(quotation, companyName, issuedBy);
  }, [quotation, companyName, issuedBy]);

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

const useQuotationAction = (options: ActionOptions): { busy: boolean; run: (s: string) => void } => {
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
    actions={statusActions(quotation?.status ?? '')}
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
  const { showToast } = useFeedbackStore();

  return useQuotationShare(
    buildShareOptions({
      quotation,
      company,
      issuedBy: user?.full_name ?? user?.email ?? 'النظام',
      headerConfig,
      notify: showToast,
    })
  );
};

const QuotationDetailsModal: FC<QuotationDetailsModalProps> = ({
  quotationId,
  onClose,
  onRefresh,
  onConvertToInvoice,
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
