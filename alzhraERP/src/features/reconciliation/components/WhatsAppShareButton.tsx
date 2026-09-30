import React, { useState } from 'react';
import { Copy, Check, MessageSquare } from 'lucide-react';
import Button from '../../../ui/base/Button';
import { useFeedbackStore } from '../../feedback/store';
import { reconciliationService } from '../services/reconciliationService';
import type { DailyDrawerSummary } from '../types';

interface WhatsAppShareButtonProps {
  summary: DailyDrawerSummary;
  actualCash: number;
  actualCard: number;
  floatRetained: number;
  cashToOwner: number;
  shopName?: string;
  className?: string;
}

interface ShareActionButtonsProps {
  copied: boolean;
  onCopy: () => void;
  onOpenWhatsApp: () => void;
}

/** أزرار النسخ والإرسال — مفصولة لتبقى دالة المكوّن الرئيسي قصيرة وواضحة */
const ShareActionButtons: React.FC<ShareActionButtonsProps> = ({
  copied,
  onCopy,
  onOpenWhatsApp,
}) => (
  <>
    <Button
      type="button"
      variant="secondary"
      onClick={onCopy}
      className="text-xs font-bold"
      title="نسخ نص التقرير لإرساله في واتساب"
    >
      {copied ? (
        <>
          <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" />
          تم النسخ
        </>
      ) : (
        <>
          <Copy className="mr-1 h-3.5 w-3.5" />
          نسخ للواتساب
        </>
      )}
    </Button>

    <Button
      type="button"
      variant="primary"
      onClick={onOpenWhatsApp}
      className="bg-[#25D366] text-xs font-bold text-white shadow-sm hover:bg-[#20bd5a]"
    >
      <MessageSquare className="mr-1 h-3.5 w-3.5" />
      إرسال للمالك عبر واتساب
    </Button>
  </>
);

export const WhatsAppShareButton: React.FC<WhatsAppShareButtonProps> = ({
  summary,
  actualCash,
  actualCard,
  floatRetained,
  cashToOwner,
  shopName = 'المحل',
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const { showToast } = useFeedbackStore();

  const buildMessageText = (): string =>
    reconciliationService.formatWhatsAppSummary(summary, {
      actualCash,
      actualCard,
      floatRetained,
      cashToOwner,
      shopName,
    });

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildMessageText());
      setCopied(true);
      showToast('تم نسخ تقرير اليومية بتنسيق الواتساب', 'success');
      setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch {
      showToast('تعذر النسخ إلى الحافظة', 'error');
    }
  };

  const handleOpenWhatsApp = (): void => {
    const text = encodeURIComponent(buildMessageText());
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <ShareActionButtons
        copied={copied}
        onCopy={() => void handleCopy()}
        onOpenWhatsApp={handleOpenWhatsApp}
      />
    </div>
  );
};
