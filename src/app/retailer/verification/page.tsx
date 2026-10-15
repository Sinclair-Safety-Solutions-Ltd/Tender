'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { VERIFICATION_DOCUMENT_TYPES, isUploadedVerificationDocumentCurrent, isVerificationSubmitReady, verificationDocumentExpires, type VerificationDocumentType } from '@/lib/verification-documents';
import { buildSafeAttachmentName, MAX_VERIFICATION_DOCUMENT_BYTES } from '@/lib/attachment-utils';
import { DEFAULT_INDEPENDENT_REVIEW_FEES_GBP, INDEPENDENT_REVIEW_TIER_DESCRIPTIONS, INDEPENDENT_REVIEW_TIER_LABELS, INDEPENDENT_REVIEW_TIERS, type IndependentReviewTier } from '@/lib/independentReviewTiers';

type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
const REOPEN_STATUSES: VerificationStatus[] = ['UNVERIFIED', 'REJECTED', 'EXPIRED', 'PENDING'];

type UploadedDocument = {
  documentType: VerificationDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiryDate: string | null;
  uploadedAt: string;
};

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export default function ProviderVerificationPage() {
  const [selectedOption, setSelectedOption] = useState<'ai' | 'enhanced'>('ai');
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('UNVERIFIED');
  const [isSoleTrader, setIsSoleTrader] = useState(false);
  const [applicableTypes, setApplicableTypes] = useState<VerificationDocumentType[]>([]);
  const [requiredTypes, setRequiredTypes] = useState<VerificationDocumentType[]>([]);
  const [soleTraderEvidence, setSoleTraderEvidence] = useState<{ strongTypes: VerificationDocumentType[]; moderateTypes: VerificationDocumentType[]; eligible: boolean } | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [enhancedReview, setEnhancedReview] = useState<{
    active: boolean;
    fees: Record<IndependentReviewTier, number>;
    status: string;
    tier: IndependentReviewTier | null;
    purchasableTiers: IndependentReviewTier[];
    expired: boolean;
  } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingType, setUploadingType] = useState<VerificationDocumentType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  async function load() {
    setLoading(true);
    const [profileResponse, documentsResponse, reviewResponse] = await Promise.all([
      fetch('/api/retailer/profile'),
      fetch('/api/retailer/verification/documents'),
      fetch('/api/retailer/independent-review'),
    ]);
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      setVerificationStatus(profile.verificationStatus);
      setIsSoleTrader(Boolean(profile.isSoleTrader));
    }
    if (documentsResponse.ok) {
      const data = await documentsResponse.json();
      setApplicableTypes(data.applicableDocumentTypes);
      setRequiredTypes(data.requiredDocumentTypes);
      setSoleTraderEvidence(data.soleTraderEvidence);
      setDocuments(data.documents);
    }
    if (reviewResponse.ok) {
      setEnhancedReview(await reviewResponse.json());
    }
    setCurrentTime(Date.now());
    setLoading(false);
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('option=enhanced')) {
      setSelectedOption('enhanced');
    }
    void load();
  }, []);

  async function handleUpload(documentType: VerificationDocumentType) {
    const file = pendingFiles[documentType];
    const expiryDate = expiryDates[documentType];
    const expires = verificationDocumentExpires(documentType);
    if (!file || (expires && !expiryDate)) {
      setError(expires ? 'Choose a PDF and an expiry date before uploading.' : 'Choose a PDF before uploading.');
      return;
    }
    if (!isPdfFile(file)) {
      setError('Upload a PDF. Photographs and other file types are not accepted.');
      return;
    }
    if (file.size > MAX_VERIFICATION_DOCUMENT_BYTES) {
      setError('Use a PDF smaller than 2 MB. Export a text PDF from Companies House or your insurer; large scans are not accepted.');
      return;
    }
    setUploadingType(documentType);
    setError(null);
    setMessage(null);
    try {
      const name = buildSafeAttachmentName(file.name);
      const staged = await fetch('/api/uploads', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': name,
          'x-file-mime': 'application/pdf',
          'x-upload-purpose': 'verification-document',
        },
        body: file,
      });
      const stagedBody = await staged.json().catch(() => null) as { uploadId?: string; error?: string } | null;
      if (!staged.ok || !stagedBody?.uploadId) {
        setError(stagedBody?.error ?? 'Unable to upload this document.');
        return;
      }
      const response = await fetch('/api/retailer/verification/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          name,
          mimeType: 'application/pdf',
          sizeBytes: file.size,
          uploadId: stagedBody.uploadId,
          ...(expires ? { expiryDate } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.issues?.fieldErrors?.expiryDate?.[0] ?? data?.error ?? 'Unable to upload this document.');
        return;
      }
      setDocuments((current) => [...current.filter((doc) => doc.documentType !== documentType), data.document]);
      setPendingFiles((current) => { const next = { ...current }; delete next[documentType]; return next; });
      setExpiryDates((current) => { const next = { ...current }; delete next[documentType]; return next; });
      setMessage(`${documentLabel(documentType)} uploaded.`);
    } finally {
      setUploadingType(null);
    }
  }

  async function handleRemove(documentType: VerificationDocumentType) {
    setUploadingType(documentType);
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/retailer/verification/documents/${documentType}`, { method: 'DELETE' });
    setUploadingType(null);
    if (!response.ok) {
      setError('Unable to remove this document.');
      return;
    }
    setDocuments((current) => current.filter((doc) => doc.documentType !== documentType));
  }

  async function handleSubmitForReview() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const response = await fetch('/api/retailer/verification', { method: 'POST' });
    const data = await response.json().catch(() => null);
    setSubmitting(false);
    if (!response.ok) {
      setError(data?.error ?? 'Unable to submit your verification request.');
      return;
    }
    setVerificationStatus(data.verificationStatus);
    if (data.verificationStatus === 'VERIFIED') {
      setMessage('Your documents passed automated assessment and your account is now verified.');
      return;
    }
    setError('Automated assessment could not confirm the required documents. Verification failed. Upload text PDFs that show the registered company name, the correct document type, and a matching expiry date, then submit again.');
  }

  function documentLabel(documentType: VerificationDocumentType) {
    return VERIFICATION_DOCUMENT_TYPES.find((doc) => doc.type === documentType)?.label ?? documentType;
  }

  const applicableDocuments = VERIFICATION_DOCUMENT_TYPES.filter((doc) => applicableTypes.includes(doc.type));
  const soleTraderDocuments = soleTraderEvidence
    ? VERIFICATION_DOCUMENT_TYPES.filter((doc) => soleTraderEvidence.strongTypes.includes(doc.type) || soleTraderEvidence.moderateTypes.includes(doc.type))
    : [];
  const now = currentTime;
  const validUploadedTypes = documents.filter((doc) => isUploadedVerificationDocumentCurrent(doc.expiryDate, now)).map((doc) => doc.documentType);
  const requiredUploaded = requiredTypes.filter((type) => validUploadedTypes.includes(type));
  const missingRequired = requiredTypes.filter((type) => !validUploadedTypes.includes(type));
  const canSubmit = isVerificationSubmitReady({ isSoleTrader, requiredTypes, validUploadedTypes });
  const canEdit = REOPEN_STATUSES.includes(verificationStatus);

  if (loading) return <AppShell role="retailer" title="Become Verified"><p className="text-sm text-concrete-grey">Loading...</p></AppShell>;
  const minExpiryDate = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <AppShell role="retailer" title="Become Verified">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/retailer/profile" className="inline-block text-sm font-semibold text-concrete-grey hover:text-foundation-navy">&larr; Back to profile</Link>

        {message && <p role="status" className="rounded-lg border border-steel-blue/20 bg-steel-blue/5 px-4 py-3 text-sm text-steel-blue">{message}</p>}
        {error && <p role="alert" className="rounded-lg border border-attention/30 bg-attention/5 px-4 py-3 text-sm text-attention">{error}</p>}

        <Card className="border-l-4 border-steel-blue bg-steel-blue/5">
          <h2 className="font-heading text-xl font-bold text-foundation-navy">Choose your verification option</h2>
          <p className="mt-1 text-sm text-concrete-grey">
            Trade Tender offers two verification options. Automated assessment reads PDF text for company name, document type, and expiry. If it cannot confirm those facts, verification fails. Enhanced Verification is a paid professional review.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div
              className={`rounded-lg border p-4 transition-all ${selectedOption === 'ai' ? 'border-steel-blue bg-white shadow-sm ring-2 ring-steel-blue/20' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-heading text-base font-bold text-foundation-navy">Automated assessment</p>
                <StatusBadge status={verificationStatus === 'VERIFIED' ? 'approved' : verificationStatus === 'PENDING' ? 'pending' : 'neutral'}>
                  {verificationStatus === 'VERIFIED' ? 'Verified' : 'Automated'}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-steel-blue">Automated Evidence Check &middot; Included</p>
              <p className="mt-2 text-xs leading-relaxed text-concrete-grey">
                Upload a text PDF of your legal-entity or self-employment evidence. The checker reads company name, document type, and expiry from the file. PDFs only — photographs and scans are not accepted. If the checker cannot confirm the document, the upload path fails.
              </p>
              <div className="mt-4">
                <Button
                  variant={selectedOption === 'ai' ? 'primary' : 'secondary'}
                  size="md"
                  onClick={() => setSelectedOption('ai')}
                >
                  {selectedOption === 'ai' ? 'Selected: Upload Evidence Below' : 'Select automated assessment'}
                </Button>
              </div>
            </div>

            <div
              className={`rounded-lg border p-4 transition-all ${selectedOption === 'enhanced' ? 'border-steel-blue bg-white shadow-sm ring-2 ring-steel-blue/20' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-heading text-base font-bold text-foundation-navy">Enhanced Verification</p>
                <StatusBadge status={enhancedReview?.status === 'APPROVED' ? 'approved' : enhancedReview?.status === 'PURCHASED' ? 'pending' : 'neutral'}>
                  {enhancedReview?.status === 'APPROVED' ? (enhancedReview.tier ?? 'Bronze') : 'Enhanced'}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-steel-blue">
                Professional H&amp;S Review &middot; Bronze £{enhancedReview?.fees.BRONZE ?? DEFAULT_INDEPENDENT_REVIEW_FEES_GBP.BRONZE} / Silver £{enhancedReview?.fees.SILVER ?? DEFAULT_INDEPENDENT_REVIEW_FEES_GBP.SILVER} / Gold £{enhancedReview?.fees.GOLD ?? DEFAULT_INDEPENDENT_REVIEW_FEES_GBP.GOLD} excl. VAT
              </p>
              <p className="mt-2 text-xs leading-relaxed text-concrete-grey">
                Purchase Bronze, Silver, or Gold. After payment, HSQE Consult Hub starts onboarding. The auditor may award the purchased tier or a lower tier.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant={selectedOption === 'enhanced' ? 'primary' : 'secondary'}
                  size="md"
                  onClick={() => setSelectedOption('enhanced')}
                >
                  {selectedOption === 'enhanced' ? 'Selected' : 'Select Enhanced Verification'}
                </Button>
                <Link href="/retailer/independent-review">
                  <Button variant="secondary" size="md">
                    Choose a verification tier →
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>

        {selectedOption === 'enhanced' && (
          <Card className="border-l-4 border-approved bg-approved/5 space-y-4">
            <div>
              <h2 className="font-heading text-xl font-bold text-foundation-navy">Enhanced Health &amp; Safety Review</h2>
              <p className="mt-2 text-sm text-concrete-grey">
                Enhanced Verification involves a professional assessment of your business by a qualified Health &amp; Safety professional. Once purchased, an auditor contacts you directly to review your safety management system, risk assessments, and training records.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-foundation-navy">Verification products</p>
              <p className="mt-1 text-xs text-concrete-grey">
                Choose the product to purchase. The auditor may award that tier or a lower tier, never a higher unpaid product.
              </p>
              <dl className="mt-3 grid gap-3 text-sm text-concrete-grey sm:grid-cols-3">
                {INDEPENDENT_REVIEW_TIERS.map((tier) => (
                  <div key={tier} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                    <dt className="font-bold text-foundation-navy">{INDEPENDENT_REVIEW_TIER_LABELS[tier]} · £{enhancedReview?.fees[tier] ?? '—'} excl. VAT</dt>
                    <dd className="mt-1 text-xs">{INDEPENDENT_REVIEW_TIER_DESCRIPTIONS[tier]}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <StatusBadge status={enhancedReview?.status === 'APPROVED' ? 'approved' : enhancedReview?.status === 'PURCHASED' ? 'pending' : enhancedReview?.status === 'DECLINED' ? 'attention' : 'neutral'}>
                {enhancedReview?.status === 'APPROVED' ? `Enhanced Verified · ${enhancedReview.tier ?? 'Bronze'}` : enhancedReview?.status === 'PURCHASED' ? 'Awaiting review' : enhancedReview?.status === 'DECLINED' ? 'Not approved' : 'Not purchased'}
              </StatusBadge>
              <Link href="/retailer/independent-review">
                <Button>
                  {enhancedReview?.purchasableTiers?.length ? 'Purchase or upgrade' : 'View enhanced verification'}
                </Button>
              </Link>
            </div>
          </Card>
        )}

        {selectedOption === 'ai' && (
          <>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-heading text-xl font-bold text-foundation-navy">Verification documents</h2>
                  <p className="mt-1 max-w-xl text-sm text-concrete-grey">
                    {isSoleTrader
                      ? 'Upload sole trader self-employment evidence as PDFs below. Every upload is submitted separately, so you can complete this at your own pace.'
                      : 'Upload each required PDF below with its expiry date. Every upload is submitted separately, so you can complete this checklist at your own pace.'}
                    {!isSoleTrader && requiredTypes.length > 0 && ` Required documents uploaded: ${requiredUploaded.length} of ${requiredTypes.length}.`}
                  </p>
                </div>
                <StatusBadge status={verificationStatus === 'VERIFIED' ? 'approved' : verificationStatus === 'PENDING' ? 'pending' : verificationStatus === 'REJECTED' || verificationStatus === 'EXPIRED' ? 'attention' : 'neutral'}>
                  {verificationStatus === 'VERIFIED' ? 'Verified' : verificationStatus === 'PENDING' ? 'Pending' : verificationStatus === 'REJECTED' ? 'Not approved' : verificationStatus === 'EXPIRED' ? 'Expired' : (isSoleTrader ? 'Sole Trader' : 'Unverified')}
                </StatusBadge>
              </div>
            </Card>

            {isSoleTrader && <Card><p className="text-sm font-semibold text-foundation-navy">Sole trader evidence rule</p><p className="mt-2 text-sm text-concrete-grey">Upload one strong evidence document, or at least two moderate evidence documents, to become eligible for automated verification. Strong evidence: HMRC UTR confirmation, SA302 tax calculation, VAT registration certificate, proof of CIS registration, or public liability/professional indemnity insurance in the trading name. Moderate evidence: business bank statement, customer invoices, customer quotations or contracts, trade body membership, or trading activity evidence (business website, trading-domain email, or marketing materials).</p></Card>}

        <Card>
          <p className="text-sm font-semibold text-foundation-navy">Compliance score disclaimer</p>
          <p className="mt-2 text-sm text-concrete-grey">
            The automated check is a PDF text check for company identity, document type, and expiry. It is not a
            Companies House, HMRC, or insurer lookup, and it does not confirm insurance cover or competence. Each
            uploaded PDF receives a score from 0-100%. Required documents must together reach at least 90%. If
            automated assessment cannot confirm the documents, verification fails. There is no human review of this
            upload path. Trade Tender does not replace client due diligence, and clients must carry out suitable
            checks before entering any formal agreement.
          </p>
        </Card>

        {(isSoleTrader ? soleTraderDocuments : applicableDocuments).map((doc) => {
          const uploaded = documents.find((item) => item.documentType === doc.type);
          const expired = uploaded?.expiryDate ? new Date(uploaded.expiryDate).getTime() <= now : false;
          const busy = uploadingType === doc.type;
          const pendingFile = pendingFiles[doc.type];
          const tierLabel = isSoleTrader
            ? (soleTraderEvidence?.strongTypes.includes(doc.type) ? 'Strong evidence' : 'Moderate evidence')
            : (requiredTypes.includes(doc.type) ? 'Required' : 'Optional');
          return (
            <Card key={doc.type}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-heading text-base font-bold text-foundation-navy">{doc.label}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wide text-concrete-grey">{tierLabel}</span>
                    {uploaded && !expired && <StatusBadge status="approved">Uploaded</StatusBadge>}
                    {uploaded && expired && <StatusBadge status="attention">Expired</StatusBadge>}
                  </div>
                  <p className="mt-1 text-sm text-concrete-grey">{doc.description}</p>
                  {uploaded && (
                    <p className="mt-2 text-sm text-foundation-navy">
                      <a href={`/api/retailer/verification/documents/${doc.type}`} download={uploaded.fileName} className="font-semibold text-steel-blue hover:underline">{uploaded.fileName}</a>
                      <span className="ml-2 text-concrete-grey">({formatFileSize(uploaded.sizeBytes)}) &middot; uploaded {new Date(uploaded.uploadedAt).toLocaleDateString('en-GB')}{uploaded.expiryDate && ` \u00b7 expires ${new Date(uploaded.expiryDate).toLocaleDateString('en-GB')}`}</span>
                    </p>
                  )}
                </div>
              </div>
              {(canEdit || verificationStatus === 'PENDING') && (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-semibold text-foundation-navy">PDF</span>
                    <span className="text-xs font-normal text-concrete-grey">PDF only, under 2 MB. Text PDFs can be read; photographs and large scans are not accepted.</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (!isPdfFile(file)) {
                          event.target.value = '';
                          setError('Upload a PDF. Photographs and other file types are not accepted.');
                          return;
                        }
                        if (file.size > MAX_VERIFICATION_DOCUMENT_BYTES) {
                          event.target.value = '';
                          setError('Use a PDF smaller than 2 MB. Export a text PDF from Companies House or your insurer; large scans are not accepted.');
                          return;
                        }
                        setError(null);
                        setPendingFiles((current) => ({ ...current, [doc.type]: file }));
                      }}
                      className="text-sm"
                    />
                  </label>
                  {doc.expires && (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-semibold text-foundation-navy">Expiry date</span>
                      <input
                        type="date"
                        min={minExpiryDate}
                        disabled={busy}
                        value={expiryDates[doc.type] ?? ''}
                        onChange={(event) => setExpiryDates((current) => ({ ...current, [doc.type]: event.target.value }))}
                        className="rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  )}
                  <Button onClick={() => void handleUpload(doc.type)} loading={busy} disabled={!pendingFile || (doc.expires && !expiryDates[doc.type])}>
                    {uploaded ? 'Replace evidence' : 'Upload evidence'}
                  </Button>
                  {uploaded && (
                    <Button variant="danger" onClick={() => void handleRemove(doc.type)} disabled={busy}>Remove</Button>
                  )}
                </div>
              )}
            </Card>
          );
        })}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-concrete-grey">
              {verificationStatus === 'VERIFIED' && 'This account is verified. No further action is required.'}
              {verificationStatus === 'PENDING' && canSubmit && 'Documents are uploaded. Submit for automated verification. This is not a human review queue.'}
              {verificationStatus === 'PENDING' && !canSubmit && (isSoleTrader
                ? 'Upload one strong evidence PDF, or at least two moderate evidence PDFs, then submit for automated verification.'
                : missingRequired.length > 0
                  ? `Still needed: ${missingRequired.map(documentLabel).join(', ')}.`
                  : 'Upload at least one applicable PDF, then submit for automated verification.')}
              {canEdit && verificationStatus !== 'PENDING' && isSoleTrader && !canSubmit && 'Upload one strong evidence PDF, or at least two moderate evidence PDFs, then submit for automated verification.'}
              {canEdit && verificationStatus !== 'PENDING' && isSoleTrader && canSubmit && 'Your sole trader evidence meets the verification rule. Submit for automated verification.'}
              {canEdit && verificationStatus !== 'PENDING' && !isSoleTrader && !canSubmit && (missingRequired.length > 0
                ? `Still needed: ${missingRequired.map(documentLabel).join(', ')}.`
                : 'Upload at least one applicable PDF, then submit for automated verification.')}
              {canEdit && verificationStatus !== 'PENDING' && !isSoleTrader && canSubmit && (requiredTypes.length > 0
                ? 'All required PDFs are uploaded. Submit for automated verification.'
                : 'Evidence is uploaded. Submit for automated verification.')}
            </p>
            {canEdit && (
              <Button type="button" onClick={() => void handleSubmitForReview()} loading={submitting} disabled={!canSubmit}>Become verified</Button>
            )}
          </div>
        </Card>
      </>
    )}
  </div>
</AppShell>
  );
}

