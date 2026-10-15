import { mobileApiFetch, MOBILE_PAYMENT_RETURN, readErrorMessage } from './client';

export type VerificationDocumentsPayload = {
  applicableDocumentTypes: string[];
  requiredDocumentTypes: string[];
  documents: Array<{ documentType: string; fileName: string; mimeType: string; sizeBytes: number; expiryDate: string | null; uploadedAt: string }>;
  isSoleTrader: boolean;
  isIncorporated: boolean;
  soleTraderEvidence: { strongTypes: string[]; moderateTypes: string[]; eligible: boolean } | null;
};

export async function loadVerificationDocuments(): Promise<VerificationDocumentsPayload> {
  const response = await mobileApiFetch('/api/retailer/verification/documents');
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load verification documents.'));
  return response.json() as Promise<VerificationDocumentsPayload>;
}

export async function uploadVerificationDocument(input: {
  documentType: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadId: string;
  expiryDate?: string;
}) {
  const response = await mobileApiFetch('/api/retailer/verification/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to upload the document.'));
}

export async function submitVerification() {
  const response = await mobileApiFetch('/api/retailer/verification', { method: 'POST' });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to submit verification.'));
  return response.json() as Promise<{ verificationStatus: string }>;
}

export type IndependentReviewPayload = {
  active: boolean;
  eligible: boolean;
  fees: { BRONZE: number; SILVER: number; GOLD: number };
  status: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | null;
  purchasableTiers: Array<'BRONZE' | 'SILVER' | 'GOLD'>;
};

export async function loadIndependentReview(): Promise<IndependentReviewPayload> {
  const response = await mobileApiFetch('/api/retailer/independent-review');
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load enhanced verification.'));
  return response.json() as Promise<IndependentReviewPayload>;
}

export async function purchaseIndependentReview(tier: 'BRONZE' | 'SILVER' | 'GOLD') {
  const response = await mobileApiFetch('/api/retailer/independent-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier, mobileReturnUrl: MOBILE_PAYMENT_RETURN }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to start enhanced verification payment.'));
  return response.json() as Promise<{ checkoutUrl?: string | null; paymentId: string }>;
}
