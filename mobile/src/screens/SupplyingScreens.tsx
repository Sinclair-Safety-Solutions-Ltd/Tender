import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { loadOpportunities, type MobileOpportunitySummary } from '../api/opportunities';
import { loadIndependentReview, loadVerificationDocuments, purchaseIndependentReview, submitVerification, uploadVerificationDocument, type IndependentReviewPayload, type VerificationDocumentsPayload } from '../api/verification';
import { loadSubmittedQuotes, type SubmittedQuoteRow } from '../api/workspace';
import { formatUkDate } from '../constants';
import { uploadMobileFile } from '../api/uploads';
import { pickVerificationDocument } from '../files';
import type { Route } from '../navigation/types';
import { Body, Card, Field, Notice, OptionList, PrimaryButton, SecondaryButton, Title } from '../ui';

export function OpportunitiesScreen({ go }: { go: (route: Route) => void }) {
  const [opportunities, setOpportunities] = useState<MobileOpportunitySummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOpportunities().then(setOpportunities).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load opportunities.'));
  }, []);

  return (
    <View>
      <Title>Opportunities</Title>
      <SecondaryButton label="Submitted quotes" onPress={() => go({ name: 'quotes' })} />
      <SecondaryButton label="Verification" onPress={() => go({ name: 'verification' })} />
      <Notice>{error}</Notice>
      {opportunities.length === 0 ? <Body>No matched opportunities available.</Body> : opportunities.map((opportunity) => (
        <Card key={opportunity.id}>
          <Title>{opportunity.reference}</Title>
          <Body>{opportunity.category} · {opportunity.location}</Body>
          <Body>Closes {formatUkDate(opportunity.closingDate)} · {opportunity.unlockFeeGbp === 0 ? 'Launch credit available' : `Unlock fee: £${opportunity.unlockFeeGbp}`}</Body>
          <SecondaryButton label={`Open ${opportunity.reference}`} onPress={() => go({ name: 'tender', tenderId: opportunity.id, intent: 'supply' })} />
        </Card>
      ))}
    </View>
  );
}

export function SubmittedQuotesScreen({ go }: { go: (route: Route) => void }) {
  const [quotes, setQuotes] = useState<SubmittedQuoteRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSubmittedQuotes().then(setQuotes).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load submitted quotes.'));
  }, []);

  return (
    <View>
      <Title>Submitted quotes</Title>
      <Notice>{error}</Notice>
      {quotes.length === 0 ? <Body>No quotes have been submitted for this account.</Body> : quotes.map((quote) => (
        <Card key={quote.id}>
          <Title>{quote.reference}</Title>
          <Body>{quote.tender.reference} · {quote.tender.subcategory}</Body>
          <Body>£{quote.priceGbp} excl. VAT · {quote.validityDays} days · {quote.status}</Body>
          <SecondaryButton label="Open tender" onPress={() => go({ name: 'tender', tenderId: quote.tender.id, intent: 'supply' })} />
        </Card>
      ))}
    </View>
  );
}

export function VerificationScreen() {
  const [data, setData] = useState<VerificationDocumentsPayload | null>(null);
  const [review, setReview] = useState<IndependentReviewPayload | null>(null);
  const [documentType, setDocumentType] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const [loaded, independentReview] = await Promise.all([loadVerificationDocuments(), loadIndependentReview()]);
    setData(loaded);
    setReview(independentReview);
    setDocumentType(loaded.applicableDocumentTypes[0] ?? loaded.requiredDocumentTypes[0] ?? '');
  }

  useEffect(() => {
    reload().catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Unable to load verification.'));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        reload().catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, []);

  if (!data && !message) return <Body>Loading verification…</Body>;

  return (
    <View>
      <Title>Verification</Title>
      <Body>Upload the required PDF evidence (under 2 MB each), then submit. Required types must have a future expiry date where they expire. Use a text PDF from Companies House or your insurer; photographs and large scans are not accepted. This is a PDF text check, not a Companies House, HMRC, or insurer lookup, and it does not confirm insurance or competence.</Body>
      <Notice>{message}</Notice>
      {data && (
        <>
          <Body>Required: {data.requiredDocumentTypes.join(', ') || 'None'}</Body>
          {data.documents.map((document) => (
            <Body key={document.documentType}>{document.documentType} · {document.fileName}</Body>
          ))}
          <OptionList
            label="Document type"
            onChange={setDocumentType}
            options={(data.applicableDocumentTypes.length > 0 ? data.applicableDocumentTypes : data.requiredDocumentTypes).map((type) => ({ label: type, value: type }))}
            value={documentType}
          />
          <Field label="Expiry date (YYYY-MM-DD) if required" onChangeText={setExpiryDate} value={expiryDate} />
          <SecondaryButton label="Upload document" onPress={() => {
            pickVerificationDocument().then(async (picked) => {
              if (!picked || !documentType) return;
              const uploaded = await uploadMobileFile(picked, 'verification-document');
              await uploadVerificationDocument({
                documentType,
                name: uploaded.fileName,
                mimeType: picked.mimeType,
                sizeBytes: picked.sizeBytes || uploaded.sizeBytes,
                uploadId: uploaded.uploadId,
                expiryDate: expiryDate || undefined,
              });
              setMessage('Document uploaded.');
              await reload();
            }).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Unable to upload the document.'));
          }} />
          <PrimaryButton label="Submit verification" onPress={() => {
            submitVerification().then((result) => setMessage(`Verification ${result.verificationStatus.toLowerCase()}.`)).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Unable to submit verification.'));
          }} />
        </>
      )}
      {review?.active && review.eligible && (
        <Card>
          <Title>Enhanced verification</Title>
          <Body>Bronze £{review.fees.BRONZE} / Silver £{review.fees.SILVER} / Gold £{review.fees.GOLD} excl. VAT. After payment, HSQE Consult Hub starts onboarding. The auditor may award the purchased tier or a lower tier.</Body>
          <Body>Status: {review.status === 'APPROVED' ? (review.tier ?? 'Bronze') : review.status === 'PURCHASED' ? 'Awaiting review' : review.status === 'DECLINED' ? 'Not approved' : 'Not purchased'}</Body>
          {review.purchasableTiers.map((tier) => (
            <SecondaryButton
              key={tier}
              label={`Purchase ${tier[0]}${tier.slice(1).toLowerCase()} (£${review.fees[tier]})`}
              onPress={() => {
                purchaseIndependentReview(tier).then(async (outcome) => {
                  if (outcome.checkoutUrl) {
                    await Linking.openURL(outcome.checkoutUrl);
                    setMessage('Payment is pending. Return to the app after payment to check confirmation.');
                    return;
                  }
                  setMessage('Payment is pending server confirmation.');
                }).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Unable to start enhanced verification payment.'));
              }}
            />
          ))}
        </Card>
      )}
    </View>
  );
}
