import QRCode from 'qrcode';

export const generateQRCode = async (data: string): Promise<string> => {
  try {
    const qrCodeDataURL = await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 1,
      width: 300,
    } as any);
    return qrCodeDataURL;
  } catch (error) {
    throw new Error('Failed to generate QR code');
  }
};

export const generatePlayerId = (name: string, department: string): string => {
  const timestamp = Date.now().toString().slice(-6);
  const namePrefix = (name || 'XXX').substring(0, 3).toUpperCase();
  const deptPrefix = (department || 'XX').substring(0, 2).toUpperCase();
  return `${deptPrefix}${namePrefix}${timestamp}`;
};
