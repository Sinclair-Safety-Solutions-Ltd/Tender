export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<Buffer> {
  if (!request.body) throw new PayloadTooLargeError('Upload body is empty');
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError('Upload exceeds the file size limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new PayloadTooLargeError('Upload body is empty');
  return Buffer.concat(chunks);
}
