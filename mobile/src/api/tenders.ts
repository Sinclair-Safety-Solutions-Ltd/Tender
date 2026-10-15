import { mobileApiFetch, paymentReturnHeaders, readErrorMessage } from './client';

export type MobileTenderSummary = {
  id: string;
  reference: string;
  status: string;
  closingDate: string;
  location: string;
  category?: string;
  subcategory?: string;
};

export type TenderContact = { contactName: string; email: string; contactPhone: string | null };

export type MobileTenderDetail = {
  tender: Record<string, unknown>;
  unlocked: boolean;
  releasedProviders?: Array<{ id: string; contact: TenderContact }>;
  buyerContact?: TenderContact | null;
};

export async function loadMyTenders(): Promise<MobileTenderSummary[]> {
  const response = await mobileApiFetch('/api/tenders');
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load tenders.'));
  const body = await response.json() as { tenders?: MobileTenderSummary[] };
  return Array.isArray(body.tenders) ? body.tenders : [];
}

export async function loadTenderDetail(tenderId: string): Promise<MobileTenderDetail> {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}`);
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load tender details.'));
  const body = await response.json() as Partial<MobileTenderDetail>;
  if (!body.tender || typeof body.unlocked !== 'boolean') throw new Error('Invalid tender response.');
  return body as MobileTenderDetail;
}

export type MobileTenderCreation = {
  projectName: string;
  category: string;
  subcategory: string;
  item?: string;
  location: string;
  quantity: string;
  urgency: string;
  closingDate: string;
  supplyDate?: string;
  requirements?: string[];
  description: string;
  spec?: Record<string, unknown>;
  items?: Array<{ category: string; subcategory: string; item?: string; quantity: string; description?: string; spec?: Record<string, unknown> }>;
  attachments?: Array<{ name: string; mimeType: string; sizeBytes: number; uploadId: string; kind?: string }>;
  allowDirectContact?: boolean;
  allowProfessionalInterest?: boolean;
};

export async function createMobileTender(input: MobileTenderCreation): Promise<{ id: string; reference: string }> {
  const response = await mobileApiFetch('/api/tenders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null) as { id?: string; reference?: string; error?: string } | null;
  if (!response.ok || !body?.id || !body.reference) throw new Error(body?.error ?? 'Unable to create tender.');
  return { id: body.id, reference: body.reference };
}

export type MobileUnlockOutcome =
  | { status: 'ALREADY_UNLOCKED' }
  | { status: 'UNLOCKED_WITH_CREDIT' }
  | { status: 'UNLOCKED_WITHOUT_PAYMENT_REQUIRED' }
  | { status: 'PAYMENT_REQUIRED'; paymentId: string; checkoutUrl: string | null; devMode: boolean };

export async function requestTenderUnlock(tenderId: string): Promise<MobileUnlockOutcome> {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/unlock`, {
    method: 'POST',
    headers: paymentReturnHeaders(),
  });
  const body = await response.json().catch(() => null) as MobileUnlockOutcome | { error?: string } | null;
  if (!response.ok || !body || !('status' in body)) {
    throw new Error(body && 'error' in body && typeof body.error === 'string' ? body.error : 'Unable to unlock tender.');
  }
  return body;
}

export async function finalizeTenderUnlock(tenderId: string, paymentId: string) {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/unlock/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to confirm unlock payment.'));
}

export type PaymentPathOutcome =
  | { status: 'REGISTERED' | 'RELEASED' }
  | { status: 'PAYMENT_REQUIRED'; paymentId: string; checkoutUrl: string | null; feeGbp?: number };

export async function loadProfessionalInterest(tenderId: string) {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/professional-interest`);
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load professional interest.'));
  return response.json() as Promise<Record<string, unknown>>;
}

export async function registerProfessionalInterest(tenderId: string): Promise<PaymentPathOutcome> {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/professional-interest`, {
    method: 'POST',
    headers: paymentReturnHeaders(),
  });
  const body = await response.json().catch(() => null) as PaymentPathOutcome & { error?: string } | null;
  if (!response.ok || !body?.status) throw new Error(body?.error ?? 'Unable to register professional interest.');
  return body;
}

export async function loadDirectContact(tenderId: string) {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/direct-contact`);
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load direct contact.'));
  return response.json() as Promise<Record<string, unknown>>;
}

export async function requestDirectContact(tenderId: string): Promise<PaymentPathOutcome> {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/direct-contact`, {
    method: 'POST',
    headers: paymentReturnHeaders(),
  });
  const body = await response.json().catch(() => null) as PaymentPathOutcome & { error?: string } | null;
  if (!response.ok || !body?.status) throw new Error(body?.error ?? 'Unable to request direct contact.');
  return body;
}

export async function finalizeDirectContact(tenderId: string, paymentId: string) {
  const response = await mobileApiFetch(`/api/tenders/${encodeURIComponent(tenderId)}/direct-contact`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to confirm direct contact payment.'));
}
