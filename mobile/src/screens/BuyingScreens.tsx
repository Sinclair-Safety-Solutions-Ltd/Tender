import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { loadPublishedCatalog } from '../api/registration';
import { createMobileTender, loadMyTenders, type MobileTenderSummary } from '../api/tenders';
import { loadAwards, type AwardRow } from '../api/workspace';
import {
  ATTACHMENT_KINDS,
  COMMON_EWC_CODES,
  REQUIREMENT_OPTIONS,
  URGENCY_OPTIONS,
  WASTE_CONTAINERS,
  defaultClosingDate,
  formatUkDate,
  isProfessionalService,
  isSiteVisitService,
  isSpecifiedItemService,
  quantityUnitsFor,
  type CategoryCatalog,
} from '../constants';
import { uploadMobileFile } from '../api/uploads';
import { pickDocument } from '../files';
import type { Route } from '../navigation/types';
import { Body, Card, Checkbox, ChipSelect, Field, Notice, OptionList, PrimaryButton, SecondaryButton, Title } from '../ui';

export function TendersScreen({ canRaiseTender, go }: { canRaiseTender: boolean; go: (route: Route) => void }) {
  const [tenders, setTenders] = useState<MobileTenderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMyTenders().then(setTenders).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load tenders.'));
  }, []);

  return (
    <View>
      <Title>My tenders</Title>
      {canRaiseTender && <PrimaryButton label="Create tender" onPress={() => go({ name: 'createTender' })} />}
      <SecondaryButton label="Awarded" onPress={() => go({ name: 'awarded' })} />
      <Notice>{error}</Notice>
      {tenders.length === 0 ? <Body>No tenders available.</Body> : tenders.map((tender) => (
        <Card key={tender.id}>
          <Title>{tender.reference}</Title>
          <Body>{tender.subcategory ?? tender.category ?? 'Tender'} · {tender.status} · {formatUkDate(tender.closingDate)}</Body>
          <Body>{tender.location}</Body>
          <SecondaryButton label={`Open ${tender.reference}`} onPress={() => go({ name: 'tender', tenderId: tender.id, intent: 'buy' })} />
        </Card>
      ))}
    </View>
  );
}

export function AwardedScreen({ go }: { go: (route: Route) => void }) {
  const [awards, setAwards] = useState<AwardRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAwards().then(setAwards).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load awards.'));
  }, []);

  return (
    <View>
      <Title>Awarded</Title>
      <Body>Awards on the record for your company, with the purchase order and package revision.</Body>
      <Notice>{error}</Notice>
      {awards.length === 0 ? <Body>No awards on the record.</Body> : awards.map((award) => (
        <Card key={award.id}>
          <Title>{award.tender.reference}</Title>
          <Body>{award.project?.name ?? award.tender.subcategory}</Body>
          <Body>{award.quote.reference} · £{award.quote.priceGbp} excl. VAT</Body>
          <Body>PO {award.purchaseOrderNumber || '—'} · {formatUkDate(award.awardedAt)}</Body>
          <SecondaryButton label="Open tender" onPress={() => go({ name: 'tender', tenderId: award.tender.id, intent: 'buy' })} />
        </Card>
      ))}
    </View>
  );
}

export function CreateTenderScreen({ go }: { go: (route: Route) => void }) {
  const [catalog, setCatalog] = useState<CategoryCatalog>({});
  const [projectName, setProjectName] = useState('');
  const [category, setCategory] = useState('Materials');
  const [subcategory, setSubcategory] = useState('');
  const [item, setItem] = useState('');
  const [location, setLocation] = useState('');
  const [quantityAmount, setQuantityAmount] = useState('20');
  const [quantityUnit, setQuantityUnit] = useState('tonnes');
  const [urgency, setUrgency] = useState<(typeof URGENCY_OPTIONS)[number]>('standard');
  const [closingDate, setClosingDate] = useState(defaultClosingDate());
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);
  const [ewcCode, setEwcCode] = useState('17 05 04');
  const [hazardous, setHazardous] = useState(false);
  const [container, setContainer] = useState<(typeof WASTE_CONTAINERS)[number]>('skip');
  const [hirePeriod, setHirePeriod] = useState('');
  const [allowDirectContact, setAllowDirectContact] = useState(false);
  const [allowProfessionalInterest, setAllowProfessionalInterest] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; mimeType: string; sizeBytes: number; uri: string; kind: string }>>([]);
  const [extraLines, setExtraLines] = useState<Array<{ category: string; subcategory: string; item: string; quantityAmount: string; quantityUnit: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadPublishedCatalog().then((loaded) => {
      setCatalog(loaded);
      const firstService = Object.keys(loaded)[0] ?? 'Materials';
      setCategory(firstService);
      const firstSub = Object.keys(loaded[firstService] ?? {})[0] ?? '';
      setSubcategory(firstSub);
      setItem(loaded[firstService]?.[firstSub]?.[0] ?? '');
      const units = quantityUnitsFor(firstService);
      setQuantityUnit(units[0] ?? 'tonnes');
    }).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Unable to load the catalogue.'));
  }, []);

  const services = Object.keys(catalog);
  const subcategories = Object.keys(catalog[category] ?? {});
  const items = catalog[category]?.[subcategory] ?? [];
  const units = useMemo(() => quantityUnitsFor(category), [category]);
  const quantity = quantityUnit === 'not applicable' ? 'not applicable' : `${quantityAmount.trim()} ${quantityUnit}`;

  function applyCategory(next: string) {
    setCategory(next);
    const nextSub = Object.keys(catalog[next] ?? {})[0] ?? '';
    setSubcategory(nextSub);
    setItem(catalog[next]?.[nextSub]?.[0] ?? '');
    const nextUnits = quantityUnitsFor(next);
    setQuantityUnit(nextUnits[0] ?? 'tonnes');
    if (nextUnits[0] === 'not applicable') setQuantityAmount('');
  }

  async function addAttachment() {
    try {
      const picked = await pickDocument();
      if (!picked) return;
      setAttachments((current) => [...current, { ...picked, kind: 'OTHER' }]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to attach the file.');
    }
  }

  async function handleSubmit() {
    setMessage(null);
    setSubmitting(true);
    try {
      const spec = category.toLowerCase() === 'waste'
        ? { ewcCode, hazardous, container }
        : category.toLowerCase() === 'plant hire'
          ? { period: hirePeriod || undefined }
          : undefined;
      const created = await createMobileTender({
        projectName,
        category,
        subcategory,
        item: isSpecifiedItemService(category) ? item : item || undefined,
        location,
        quantity,
        urgency,
        closingDate,
        description,
        requirements,
        spec,
        items: extraLines.map((line) => ({
          category: line.category,
          subcategory: line.subcategory,
          item: isSpecifiedItemService(line.category) ? line.item : line.item || undefined,
          quantity: line.quantityUnit === 'not applicable' ? 'not applicable' : `${line.quantityAmount.trim()} ${line.quantityUnit}`,
          description: '',
        })),
        attachments: await Promise.all(attachments.map(async (attachment) => {
          const uploaded = await uploadMobileFile(attachment, 'tender-attachment');
          return {
            name: uploaded.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            uploadId: uploaded.uploadId,
            kind: attachment.kind,
          };
        })),
        allowDirectContact: isSiteVisitService(category) ? allowDirectContact : undefined,
        allowProfessionalInterest: isProfessionalService(category) ? allowProfessionalInterest : undefined,
      });
      go({ name: 'tender', tenderId: created.id, intent: 'buy' });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to create tender.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View>
      <Title>Create tender</Title>
      <Body>Use a UK postcode so matching and delivery fees can be determined. Quantity needs a number and a catalogue unit.</Body>
      <Field label="Project name" onChangeText={setProjectName} value={projectName} />
      <OptionList label="Service" onChange={applyCategory} options={services.map((service) => ({ label: service, value: service }))} value={category} />
      <OptionList label="Subcategory" onChange={(value) => { setSubcategory(value); setItem(catalog[category]?.[value]?.[0] ?? ''); }} options={subcategories.map((value) => ({ label: value, value }))} value={subcategory} />
      {items.length > 0 && <OptionList label="Item" onChange={setItem} options={items.map((value) => ({ label: value, value }))} value={item} />}
      <Field label="Location with UK postcode" onChangeText={setLocation} placeholder="Leeds LS10 2AB" value={location} />
      {quantityUnit !== 'not applicable' && <Field keyboardType="decimal-pad" label="Quantity" onChangeText={setQuantityAmount} value={quantityAmount} />}
      <OptionList label="Unit" onChange={setQuantityUnit} options={units.map((unit) => ({ label: unit, value: unit }))} value={quantityUnit} />
      <OptionList label="Urgency" onChange={(value) => setUrgency(value as (typeof URGENCY_OPTIONS)[number])} options={URGENCY_OPTIONS.map((value) => ({ label: value, value }))} value={urgency} />
      <Field label="Quote deadline (YYYY-MM-DD)" onChangeText={setClosingDate} value={closingDate} />
      <Field label="Description" multiline onChangeText={setDescription} value={description} />
      <ChipSelect label="Requirements" onChange={setRequirements} options={REQUIREMENT_OPTIONS.map((value) => ({ label: value, value }))} selected={requirements} />
      {category.toLowerCase() === 'waste' && (
        <>
          <OptionList label="EWC code" onChange={setEwcCode} options={COMMON_EWC_CODES.map((code) => ({ label: code, value: code }))} value={ewcCode} />
          <Checkbox checked={hazardous} label="Hazardous waste" onToggle={() => setHazardous((value) => !value)} />
          <OptionList label="Container" onChange={(value) => setContainer(value as (typeof WASTE_CONTAINERS)[number])} options={WASTE_CONTAINERS.map((value) => ({ label: value, value }))} value={container} />
        </>
      )}
      {category.toLowerCase() === 'plant hire' && <Field label="Hire period" onChangeText={setHirePeriod} placeholder="2 weeks" value={hirePeriod} />}
      {isSiteVisitService(category) && <Checkbox checked={allowDirectContact} label="Allow direct contact requests" onToggle={() => setAllowDirectContact((value) => !value)} />}
      {isProfessionalService(category) && <Checkbox checked={allowProfessionalInterest} label="Allow professional interest" onToggle={() => setAllowProfessionalInterest((value) => !value)} />}
      <SecondaryButton label="Add another package" onPress={() => setExtraLines((current) => [...current, { category, subcategory, item, quantityAmount, quantityUnit }])} />
      {extraLines.map((line, index) => (
        <Card key={`${line.category}-${index}`}>
          <Body>Package {index + 2}: {line.item || line.subcategory} · {line.quantityUnit === 'not applicable' ? 'not applicable' : `${line.quantityAmount} ${line.quantityUnit}`}</Body>
          <SecondaryButton label="Remove package" onPress={() => setExtraLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
        </Card>
      ))}
      <SecondaryButton label="Add attachment" onPress={() => { void addAttachment(); }} />
      {attachments.map((attachment) => (
        <Body key={attachment.name}>{attachment.name}</Body>
      ))}
      {attachments.length > 0 && (
        <OptionList
          label="Latest attachment kind"
          onChange={(kind) => setAttachments((current) => current.map((attachment, index) => index === current.length - 1 ? { ...attachment, kind } : attachment))}
          options={ATTACHMENT_KINDS.map((kind) => ({ label: kind, value: kind }))}
          value={attachments[attachments.length - 1]?.kind ?? 'OTHER'}
        />
      )}
      <Notice>{message}</Notice>
      <PrimaryButton label="Submit tender" loading={submitting} onPress={handleSubmit} />
    </View>
  );
}
