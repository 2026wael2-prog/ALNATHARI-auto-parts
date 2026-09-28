// ============================================
// قالب طباعة عرض السعر
// ============================================
// قالب مستقل عن نافذة العرض (كانت الطباعة تُنفَّذ بحيلة visibility على النافذة
// كاملة). يعيد استخدام ترويسة المستند وشريط أدوات الطباعة المعتمدين في الفاتورة،
// ويحترم عملة العرض في كل مبلغ مع كتابة الإجمالي بالحروف.

import { useMemo, useState } from 'react';
import type { FC, ReactElement } from 'react';
import { formatCurrency } from '@/core/utils/currencyUtils';
import { tafqeet } from '@/core/utils/tafqeet';
import { useCompany } from '@/features/settings/hooks';
import { useInvoiceSettings } from '@/features/settings/settingsStore';
import type { QuotationDetailRow } from '../../api/quotationsApi';
import {
  PrintDocumentHeader,
  type CompanyHeaderData,
  type DocumentHeaderMeta,
  type HeaderLayoutMode,
} from '../print/PrintDocumentHeader';
import { PrintToolbar } from '../print/PrintToolbar';
import {
  mapQuotationToPrintData,
  statusToneClasses,
  type QuotationPrintData,
  type QuotationPrintItem,
} from './print/quotationPrintModel';

interface PrintableQuotationProps {
  quotation: QuotationDetailRow;
  onExportPDF?: (() => void) | undefined;
  isExporting?: boolean | undefined;
}

const currencyUnitLabel = (code: string): string => {
  switch (code) {
    case 'SAR':
      return 'ريال سعودي';
    case 'YER':
      return 'ريال يمني';
    case 'USD':
      return 'دولار أمريكي';
    default:
      return code;
  }
};

/** إعدادات المستند أولاً، ثم بيانات المنشأة، ثم قيمة افتراضية. */
const pick = (primary: string, fallback: string): string =>
  primary.trim() !== '' ? primary.trim() : fallback.trim();

/** أنواع مستنبطة من الهوكس: لا حاجة لتخمين مسارات أنواع المنشأة/الإعدادات. */
type CompanyLike = ReturnType<typeof useCompany>['data'];
type InvoiceSettingsLike = ReturnType<typeof useInvoiceSettings>;

const companyIdentity = (
  company: CompanyLike,
  settings: InvoiceSettingsLike
): { nameAr: string; nameEn: string } => ({
  nameAr: pick(settings.company_name_ar, company?.name_ar ?? 'اسم المنشأة التجارية'),
  nameEn: pick(settings.company_name_en, company?.name_en ?? ''),
});

const companyContact = (
  company: CompanyLike,
  settings: InvoiceSettingsLike
): Pick<
  CompanyHeaderData,
  'specialization' | 'address' | 'phone' | 'email' | 'taxNumber' | 'logoUrl'
> => ({
  specialization: settings.company_specialization.trim(),
  address: pick(settings.company_address, company?.address ?? ''),
  phone: pick(settings.company_phone, company?.phone ?? ''),
  email: settings.company_email.trim(),
  taxNumber: company?.tax_number ?? '',
  logoUrl: company?.logo_url ?? '',
});

/** ترويسة المنشأة المعروضة أعلى عرض السعر.
 *  القيم الفارغة مقبولة: PrintDocumentHeader يفحص كل حقل قبل عرضه. */
const useCompanyHeaderData = (): CompanyHeaderData => {
  const { data: company } = useCompany();
  const settings = useInvoiceSettings();

  return useMemo(
    () => ({
      ...companyIdentity(company, settings),
      ...companyContact(company, settings),
    }),
    [company, settings]
  );
};

const PrintStyles = ({ accentColor }: { accentColor: string }): ReactElement => (
  <style>{`
    @media print {
      body { background-color: #fff !important; margin: 0 !important; }
      .no-print { display: none !important; }
      .quotation-print-root { display: block !important; width: 100% !important; }
      .quotation-page-box {
        max-width: 100% !important; margin: 0 !important; padding: 0 !important;
        box-shadow: none !important; border: none !important;
      }
      @page { margin: 8mm; size: A4 portrait; }
      tr { page-break-inside: avoid !important; break-inside: avoid !important; }
      .avoid-break { page-break-inside: avoid !important; break-inside: avoid !important; }
    }
    .quotation-page-box {
      max-width: 210mm; margin: auto; padding: 8mm 10mm;
      background: #ffffff; color: #0f172a; line-height: 1.45;
      font-variant-numeric: tabular-nums;
    }
    .quotation-th {
      background-color: ${accentColor} !important; color: #ffffff !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  `}</style>
);

const StatusChip = ({
  label,
  tone,
}: {
  label: string;
  tone: { chip: string; text: string };
}): ReactElement => (
  <div className="mb-3 flex items-center gap-2">
    <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${tone.chip} ${tone.text}`}>
      {label}
    </span>
  </div>
);

const MetaCards = ({
  data,
  accentColor,
}: {
  data: QuotationPrintData;
  accentColor: string;
}): ReactElement => {
  const { header } = data;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 font-bold text-slate-700">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          <span>بيانات العميل:</span>
        </div>
        <p className="pr-3 text-sm font-bold text-slate-900">
          {header.customerName !== '' ? header.customerName : 'عميل نقدي'}
        </p>
        {header.customerPhone !== '' && (
          <p className="pr-3 text-[11px] text-slate-600" dir="ltr">
            {header.customerPhone}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 font-bold text-slate-700">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          <span>بيانات العرض:</span>
        </div>
        <p className="pr-3 text-[11px] text-slate-700">
          <span className="font-semibold">رقم العرض:</span> {header.number}
        </p>
        <p className="pr-3 text-[11px] text-slate-700">
          <span className="font-semibold">تاريخ الإصدار:</span> {header.issueDate}
        </p>
        <p className="pr-3 text-[11px] text-slate-700">
          <span className="font-semibold">صالح حتى:</span>{' '}
          {header.validUntil !== '' ? header.validUntil : 'غير محدد'}
        </p>
        <p className="pr-3 text-[11px] text-slate-700">
          <span className="font-semibold">العملة:</span> {currencyUnitLabel(header.currencyCode)}
        </p>
      </div>
    </div>
  );
};

const ItemRow = ({
  item,
  index,
  currencyCode,
}: {
  item: QuotationPrintItem;
  index: number;
  currencyCode: string;
}): ReactElement => (
  <tr className="border-b border-slate-100">
    <td className="px-2 py-1.5 text-center text-[11px] text-slate-500">{index + 1}</td>
    <td className="px-2 py-1.5 text-[11px]">
      <span className="font-semibold text-slate-800">{item.name}</span>
      {item.code !== '' && (
        <span className="block font-mono text-[10px] text-slate-500">{item.code}</span>
      )}
    </td>
    <td className="px-2 py-1.5 text-center text-[11px] text-slate-600">{item.brand}</td>
    <td className="px-2 py-1.5 text-center text-[11px] font-bold">{item.quantity}</td>
    <td className="px-2 py-1.5 text-center font-mono text-[11px]" dir="ltr">
      {formatCurrency(item.unitPrice, currencyCode)}
    </td>
    <td className="px-2 py-1.5 text-center text-[11px]">{item.discountPercent}%</td>
    <td className="px-2 py-1.5 text-center font-mono text-[11px] font-bold" dir="ltr">
      {formatCurrency(item.total, currencyCode)}
    </td>
  </tr>
);

const ItemsTable = ({
  items,
  currencyCode,
}: {
  items: QuotationPrintItem[];
  currencyCode: string;
}): ReactElement => (
  <table className="mb-4 w-full border-collapse text-right">
    <thead>
      <tr>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-[11px]">#</th>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-right text-[11px]">
          الوصف
        </th>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-[11px]">الماركة</th>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-[11px]">الكمية</th>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-[11px]">سعر الوحدة</th>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-[11px]">خصم %</th>
        <th className="quotation-th border border-slate-300 px-2 py-1.5 text-[11px]">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      {items.map((item, index) => (
        <ItemRow key={item.id} item={item} index={index} currencyCode={currencyCode} />
      ))}
      {items.length === 0 && (
        <tr>
          <td colSpan={7} className="border border-slate-300 px-2 py-3 text-center text-[11px]">
            لا توجد أصناف في هذا العرض
          </td>
        </tr>
      )}
    </tbody>
  </table>
);

const TotalRow = ({ label, value }: { label: string; value: string }): ReactElement => (
  <div className="flex items-center justify-between border-b border-slate-100 py-1">
    <span className="text-[11px] text-slate-600">{label}</span>
    <span className="font-mono text-[11px] font-semibold text-slate-800" dir="ltr">
      {value}
    </span>
  </div>
);

const TotalsBlock = ({ data }: { data: QuotationPrintData }): ReactElement => {
  const currency = data.header.currencyCode;
  return (
    <div className="avoid-break ml-auto mb-4 w-full max-w-[320px]">
      <TotalRow label="المجموع" value={formatCurrency(data.subtotal, currency)} />
      {data.discountAmount > 0 && (
        <TotalRow label="الخصم" value={`- ${formatCurrency(data.discountAmount, currency)}`} />
      )}
      {data.taxAmount > 0 && (
        <TotalRow label="الضريبة" value={formatCurrency(data.taxAmount, currency)} />
      )}
      <div className="mt-1 flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
        <span className="text-xs font-bold text-emerald-800">الإجمالي النهائي</span>
        <span className="font-mono text-sm font-bold text-emerald-800" dir="ltr">
          {formatCurrency(data.totalAmount, currency)}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-600">
        فقط: {tafqeet(data.totalAmount, currencyUnitLabel(currency))}
      </p>
    </div>
  );
};

const TermLine = ({ label, value }: { label: string; value: string }): ReactElement => (
  <p className="text-[11px] text-slate-700">
    <span className="font-bold">{label}:</span> {value}
  </p>
);

const TermsBlock = ({ data }: { data: QuotationPrintData }): ReactElement => (
  <>
    {data.paymentTerms !== '' && <TermLine label="شروط الدفع" value={data.paymentTerms} />}
    {data.deliveryTerms !== '' && <TermLine label="شروط التسليم" value={data.deliveryTerms} />}
    {data.notes !== '' && <TermLine label="ملاحظات" value={data.notes} />}
    {data.termsAndConditions !== '' && (
      <TermLine label="الشروط والأحكام" value={data.termsAndConditions} />
    )}
  </>
);

const PrintableQuotation: FC<PrintableQuotationProps> = ({
  quotation,
  onExportPDF,
  isExporting = false,
}) => {
  const [layoutMode, setLayoutMode] = useState<HeaderLayoutMode>('modern-centered');
  const [accentColor, setAccentColor] = useState<string>('#1F4E78');
  const companyHeader = useCompanyHeaderData();
  const data = useMemo(() => mapQuotationToPrintData(quotation), [quotation]);
  const tone = statusToneClasses(data.header.statusTone);
  const documentMeta: DocumentHeaderMeta = {
    titleAr: 'عرض سعر',
    titleEn: 'Quotation',
    documentNumber: data.header.number,
    documentDate: data.header.issueDate,
    badge: data.header.statusLabel,
  };

  return (
    <div className="quotation-print-root w-full bg-white font-sans text-black">
      <PrintStyles accentColor={accentColor} />
      <PrintToolbar
        layoutMode={layoutMode}
        onChangeLayout={setLayoutMode}
        accentColor={accentColor}
        onChangeAccentColor={setAccentColor}
        onPrint={() => {
          window.print();
        }}
        {...(onExportPDF !== undefined ? { onExportPDF } : {})}
        isExporting={isExporting}
      />
      <div className="quotation-page-box" dir="rtl">
        <PrintDocumentHeader
          company={companyHeader}
          document={documentMeta}
          layoutMode={layoutMode}
          accentColor={accentColor}
        />
        <StatusChip label={data.header.statusLabel} tone={tone} />
        <MetaCards data={data} accentColor={accentColor} />
        <ItemsTable items={data.items} currencyCode={data.header.currencyCode} />
        <TotalsBlock data={data} />
        <div className="avoid-break space-y-1 border-t border-slate-200 pt-3">
          <TermsBlock data={data} />
        </div>
      </div>
    </div>
  );
};

export default PrintableQuotation;
