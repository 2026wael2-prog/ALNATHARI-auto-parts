/**
 * Re-export shim (audit F22).
 *
 * The implementation moved to `@/core/utils/whatsapp` so features outside
 * debts (sales requisitions, quotations, party statements) no longer import
 * from inside the debts feature. Keeping this file means the existing
 * debts/parties importers keep working untouched.
 *
 * @deprecated Import from '@/core/utils/whatsapp' in new code.
 */
export {
  normalizePhoneForWhatsApp,
  buildWhatsAppLink,
  buildWhatsAppWebLink,
  hasValidWhatsAppPhone,
} from '@/core/utils/whatsapp';
