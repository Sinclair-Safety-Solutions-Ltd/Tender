import { createHash, createHmac } from 'node:crypto';

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function canonicalUri(pathname: string): string {
  const segments = pathname.split('/').map((segment) => encodeRfc3986(decodeURIComponent(segment)));
  const joined = segments.join('/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((left, right) => (left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0])))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function headerValue(headers: Record<string, string>, name: string): string {
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return (match ? headers[match] : '').trim().replace(/\s+/g, ' ');
}

export function authorizationHeader(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now: Date;
  service?: string;
}): { authorization: string; amzDate: string; payloadHash: string; signedHeaders: string } {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.now);
  const date = stamp.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: input.url.host };
  const names = [...new Set(Object.keys(headers).map((key) => key.toLowerCase()))].sort();
  const canonicalHeaders = names.map((name) => `${name}:${headerValue(headers, name)}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [
    input.method.toUpperCase(),
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate: stamp,
    payloadHash: input.payloadHash,
    signedHeaders,
  };
}

export function presignGetUrl(input: {
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  ttlSeconds: number;
  now: Date;
}): string {
  const stamp = amzDate(input.now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const signed = new URL(input.url.toString());
  signed.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  signed.searchParams.set('X-Amz-Credential', `${input.accessKeyId}/${scope}`);
  signed.searchParams.set('X-Amz-Date', stamp);
  signed.searchParams.set('X-Amz-Expires', String(input.ttlSeconds));
  signed.searchParams.set('X-Amz-SignedHeaders', 'host');
  const canonical = [
    'GET',
    canonicalUri(signed.pathname),
    canonicalQuery(signed.searchParams),
    `host:${signed.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  signed.searchParams.set('X-Amz-Signature', signature);
  return signed.toString();
}

export function emptyPayloadHash(): string {
  return sha256Hex('');
}

export function payloadHash(body: Buffer): string {
  return sha256Hex(body);
}
