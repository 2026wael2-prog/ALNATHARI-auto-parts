import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shareSpreadsheet, shareExcelFile } from './shareUtils';

describe('shareSpreadsheet', () => {
  const blob = new Blob(['dummy'], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const options = {
    blob,
    fileName: 'فاتورة_100.xlsx',
    shareTitle: 'فاتورة 100',
    shareText: 'مرفق فاتورة رقم 100',
    fallbackText: 'مرفق فاتورة رقم 100. يرجى الاطلاع على الملف المرفق.',
    onDownloadFallback: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (navigator as unknown as { canShare?: unknown }).canShare;
    vi.restoreAllMocks();
  });

  it('uses the native share sheet when canShare supports files', async () => {
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { canShare: unknown }).canShare = canShare;
    (navigator as unknown as { share: unknown }).share = share;

    await shareSpreadsheet(options);

    expect(canShare).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    expect(options.onDownloadFallback).not.toHaveBeenCalled();
    // Ensure the file MIME is preserved
    const callArgs = share.mock.calls[0][0] as { files: File[] };
    expect(callArgs.files[0].name).toBe('فاتورة_100.xlsx');
    expect(callArgs.files[0].type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  it('falls back to download + WhatsApp when canShare is unavailable', async () => {
    // No canShare — simulate an unsupported browser (e.g. desktop Chrome).
    (navigator as unknown as { canShare?: unknown }).canShare = undefined;

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await shareSpreadsheet(options);

    expect(options.onDownloadFallback).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
  });

  it('falls back to download + WhatsApp when canShare rejects files', async () => {
    const canShare = vi.fn().mockReturnValue(false);
    (navigator as unknown as { canShare: unknown }).canShare = canShare;

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await shareSpreadsheet(options);

    expect(options.onDownloadFallback).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to download + WhatsApp when the native share sheet fails', async () => {
    // سطح المكتب قد يفشل فيه share() (NotAllowedError لأنها تُنادى بعد await) —
    // يجب أن ينزل إلى المسار المضمون بدل أن ينتهي الزر بلا أثر.
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockRejectedValue(new Error('share failed'));
    (navigator as unknown as { canShare: unknown }).canShare = canShare;
    (navigator as unknown as { share: unknown }).share = share;

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await expect(shareSpreadsheet(options)).resolves.toBeUndefined();

    expect(options.onDownloadFallback).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect((openSpy.mock.calls[0][0] as string).startsWith('https://wa.me/?text=')).toBe(true);
  });

  it('does not force the fallback when the user cancels the share sheet', async () => {
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    (navigator as unknown as { canShare: unknown }).canShare = canShare;
    (navigator as unknown as { share: unknown }).share = share;

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await expect(shareSpreadsheet(options)).resolves.toBeUndefined();

    expect(options.onDownloadFallback).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('shareExcelFile (legacy)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (navigator as unknown as { canShare?: unknown }).canShare;
  });

  it('shares natively when available', async () => {
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { canShare: unknown }).canShare = canShare;
    (navigator as unknown as { share: unknown }).share = share;

    await shareExcelFile(new Blob(['x']), 'test.xlsx', 'T', 'text');

    expect(share).toHaveBeenCalledTimes(1);
  });
});
