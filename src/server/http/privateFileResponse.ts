import { NextResponse } from 'next/server';

function safeDownloadFileName(fileName: string) {
  return fileName.replace(/[\\r\\n"]/g, '_').slice(0, 255) || 'attachment';
}

function safeMimeType(mimeType: string) {
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

export function privateFileResponse(request: Request, file: { fileName: string; mimeType: string; content: Buffer; downloadUrl: string | null }) {
  const delivery = new URL(request.url).searchParams.get('delivery');
  if (delivery === 'url' && file.downloadUrl) {
    return NextResponse.json({ url: file.downloadUrl });
  }
  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      'Content-Type': safeMimeType(file.mimeType),
      'Content-Disposition': `attachment; filename="${safeDownloadFileName(file.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
