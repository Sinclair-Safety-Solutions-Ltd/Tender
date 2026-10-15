'use client';

import { Suspense, useEffect, useState, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Combobox } from '@/components/ui/Combobox';
import { Stepper, type WizardStep } from '@/components/ui/Stepper';
import { PageHeader } from '@/components/ui/PageHeader';
import { Label, Input, Select, Textarea, FieldGroup } from '@/components/ui/Field';
import { SERVICE_CATALOG, isSpecifiedItemService, type ServiceName } from '@/lib/categories';
import { COMMON_EWC_CODES, MATERIAL_PACKS, MEASURED_CONTRACTOR_UNITS, WASTE_CONTAINERS, specIssues, type TenderLineSpec } from '@/lib/tender-spec';
import { buildSafeAttachmentName } from '@/lib/attachment-utils';
import { ATTACHMENT_KIND_LABELS, ATTACHMENT_KINDS, type AttachmentKind } from '@/lib/attachment-kinds';
import { laneComplianceForServices } from '@/lib/lane-compliance';
import { getModerationMessage, stripDetectedContactDetails } from '@/lib/moderation';
import { buyingTendersPath } from '@/lib/workspace-paths';

function getServiceSenseCheck(service: string | undefined, quantityValue: string, quantityUnit: string): { quantityError?: string; unitError?: string; message?: string } {
  const normalisedService = String(service ?? '').trim().toLowerCase();
  const hasValue = quantityValue.trim().length > 0;
  const hasUnit = Boolean(quantityUnit && quantityUnit.trim().length > 0);

  if (!normalisedService) return {};

  if (normalisedService.includes('professional')) {
    return { message: 'Add a duration if you already know it. Contractors and professionals can still quote after a site visit.' };
  }

  if (normalisedService.includes('waste')) {
    if (!hasValue) return { quantityError: 'Enter the waste quantity in tonnes.' };
    if (!/^\d+(?:\.\d+)?$/.test(quantityValue.trim().replace(/,/g, ''))) return { quantityError: 'Quantity must be a number.' };
    if (quantityUnit !== 'tonnes') return { unitError: 'Waste must be specified in tonnes. Choose skip, grab, or roll-on as the container separately.' };
    return { message: 'Waste lines need an EWC code, hazardous flag, container, and tonnes.' };
  }

  if (normalisedService.includes('material')) {
    if (!hasValue) return { quantityError: 'Enter a quantity for this material or waste requirement.' };
    if (!/^\d+(?:\.\d+)?$/.test(quantityValue.trim().replace(/,/g, ''))) return { quantityError: 'Quantity must be a number.' };
    if (!hasUnit || quantityUnit === 'not applicable') return { unitError: 'Select a unit for this material or waste requirement.' };
    return { message: 'Materials and waste services should be specified by quantity and unit.' };
  }

  if (normalisedService.includes('ground') || normalisedService.includes('civil') || normalisedService.includes('construction') || normalisedService.includes('contractor')) {
    if (hasValue && !/^(?:m|m²|m³|nr|item|week)$/i.test(quantityUnit) && !/\b(days?|weeks?|months?)\b/i.test(quantityUnit)) {
      return { unitError: 'Select m, m², m³, nr, item, week, or a duration unit.' };
    }
    return { message: 'Add a measured quantity if you already know it. Matching contractors can quote after a site visit.' };
  }

  if (normalisedService.includes('plant')) {
    if (!hasValue) return { quantityError: 'Enter a hire duration or quantity for this plant hire requirement.' };
    if (!/\b(days?|weeks?|months?)\b/i.test(quantityUnit)) {
      return { unitError: 'Select a hire duration unit such as days or weeks.' };
    }
    return { message: 'Plant hire should include the hire duration.' };
  }

  if (quantityUnit === 'not applicable') return {};
  return {};
}

const GOODS_QUANTITY_UNITS = ['units', 'tonnes', 'bags', 'pallets', 'm³'];
const WASTE_QUANTITY_UNITS = ['tonnes'];
const QUANTITY_UNITS = ['not applicable', ...GOODS_QUANTITY_UNITS, 'days', 'weeks', 'months'];
const DURATION_UNITS = ['days', 'weeks', 'months'];
const SERVICE_MINIMUM_REQUIREMENTS = ['CSCS carded operatives required', 'SSIP membership required', 'CPCS or NPORS plant competence required', 'Trade-specific qualifications required', 'Public liability insurance evidence required', 'Employers liability insurance evidence required', 'RAMS required before works start', 'Permit to work required', 'DBS clearance required', 'Asbestos awareness required', 'Working at height competence required', 'Confined space competence required'] as const;
void SERVICE_MINIMUM_REQUIREMENTS;
const PLANT_HIRE_SUPPORT_OPTIONS = ['Driver/operator required', 'Lift plan required', 'Delivery and collection required', 'Fuel included', 'Lifting accessories required', 'Banksman or slinger/signaller required', 'Ground protection mats required', 'Operator CPCS or NPORS evidence required', 'Thorough examination certificate required', 'Out-of-hours delivery required', 'Road permits or traffic management required', 'Machine insurance evidence required'];

const STEPS: WizardStep[] = [
  { id: 1, label: 'Project' },
  { id: 2, label: 'Packages' },
  { id: 3, label: 'Issue' },
];

type FormState = {
  projectName: string;
  selectedServices: string[];
  category: ServiceName | string;
  subcategory: string;
  item: string;
  location: string;
  requirements: string[];
  quantityValue: string;
  quantityUnit: string;
  description: string;
  primaryItemDescription: string;
  primaryProfessionalServiceType: string;
  primaryProfessionalServiceOther: string;
  primaryDurationValue: string;
  primaryDurationUnit: string;
  primaryScopeSize: string;
  primaryWorkingHours: string;
  primaryAccessRestrictions: string;
  primarySiteConstraints: string;
  primaryDeliverables: string;
  primaryMinimumRequirements: string[];
  primaryPlantRequirements: string[];
  primaryDriverRequired: boolean;
  primaryLiftPlanRequired: boolean;
  primarySpec: TenderLineSpec;
  urgency: string;
  closingDate: string;
  supplyDate: string;
  items: TenderItem[];
};

type TenderItem = {
  id: string;
  category: ServiceName | string;
  subcategory: string;
  item: string;
  quantityValue: string;
  quantityUnit: string;
  description: string;
  professionalServiceType: string;
  professionalServiceOther: string;
  durationValue: string;
  durationUnit: string;
  scopeSize: string;
  workingHours: string;
  accessRestrictions: string;
  siteConstraints: string;
  deliverables: string;
  minimumRequirements: string[];
  plantRequirements: string[];
  driverRequired: boolean;
  liftPlanRequired: boolean;
  spec: TenderLineSpec;
};

const EMPTY_FORM: FormState = {
  projectName: '',
  selectedServices: [],
  category: '',
  subcategory: '',
  item: '',
  location: '',
  requirements: [],
  quantityValue: '',
  quantityUnit: '',
  description: '',
  primaryItemDescription: '',
  primaryProfessionalServiceType: '',
  primaryProfessionalServiceOther: '',
  primaryDurationValue: '',
  primaryDurationUnit: 'weeks',
  primaryScopeSize: '',
  primaryWorkingHours: '',
  primaryAccessRestrictions: '',
  primarySiteConstraints: '',
  primaryDeliverables: '',
  primaryMinimumRequirements: [],
  primaryPlantRequirements: [],
  primaryDriverRequired: false,
  primaryLiftPlanRequired: false,
  primarySpec: {},
  urgency: 'standard',
  closingDate: '',
  supplyDate: '',
  items: [],
};

const DRAFT_KEY = 'tradeTender.newTenderDraft.v1';

function closingDatePreset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function splitQuantity(quantity: string): { quantityValue: string; quantityUnit: string } {
  const unit = QUANTITY_UNITS.find((candidate) => quantity.endsWith(` ${candidate}`));
  return unit ? { quantityValue: quantity.slice(0, -unit.length).trim(), quantityUnit: unit } : { quantityValue: quantity, quantityUnit: 'units' };
}

function packageLabels(service: string): { provision: string; detail: string } {
  if (service === 'Materials') return { provision: 'Material category', detail: 'Specified material' };
  if (service === 'Waste') return { provision: 'Waste type', detail: 'Specified waste stream' };
  if (service === 'Plant Hire') return { provision: 'Plant category', detail: 'Specified plant' };
  if (service === 'Professional Services') return { provision: 'Professional discipline', detail: 'Professional service needed' };
  return { provision: 'Service provision', detail: 'Detailed provision (optional)' };
}

function isProfessionalService(service: string | undefined) {
  return String(service ?? '').toLowerCase().includes('professional');
}

function isContractorService(service: string | undefined) {
  return String(service ?? '').toLowerCase().includes('contractor');
}

function isPlantHire(service: string | undefined) {
  return String(service ?? '').toLowerCase().includes('plant');
}

function packageQuantity(service: string, quantityValue: string, quantityUnit: string, durationValue: string, durationUnit: string) {
  if (isContractorService(service)) {
    return quantityValue.trim() ? `${quantityValue.trim()} ${quantityUnit}` : 'not applicable';
  }
  if (isProfessionalService(service) || isPlantHire(service)) {
    return durationValue.trim() ? `${durationValue.trim()} ${durationUnit}` : 'not applicable';
  }
  return quantityUnit === 'not applicable' ? 'not applicable' : `${quantityValue} ${quantityUnit}`.trim();
}

function packageItem(service: string, item: string, professionalServiceOther: string) {
  if (!isProfessionalService(service)) return item;
  return item === 'Other' ? `Other: ${professionalServiceOther.trim()}` : item;
}

function packageSpecification(baseDescription: string, service: string, professionalServiceType: string, professionalServiceOther: string, durationValue: string, durationUnit: string, scopeSize: string, workingHours: string, accessRestrictions: string, siteConstraints: string, deliverables: string, minimumRequirements: string[], plantRequirements: string[], driverRequired: boolean, liftPlanRequired: boolean) {
  const details = [baseDescription.trim()];
  if (isProfessionalService(service) && professionalServiceType) details.push(`Service needed: ${professionalServiceType === 'Other' ? professionalServiceOther.trim() : professionalServiceType}.`);
  if ((isProfessionalService(service) || isContractorService(service) || isPlantHire(service)) && durationValue.trim()) details.push(`Required provision period: ${durationValue.trim()} ${durationUnit}.`);
  if ((isContractorService(service) || isProfessionalService(service) || isPlantHire(service)) && scopeSize.trim()) details.push(`Size, scope or output quantity: ${scopeSize.trim()}.`);
  if ((isContractorService(service) || isProfessionalService(service) || isPlantHire(service)) && workingHours.trim()) details.push(`Permitted working hours: ${workingHours.trim()}.`);
  if ((isContractorService(service) || isProfessionalService(service) || isPlantHire(service)) && accessRestrictions.trim()) details.push(`Access restrictions: ${accessRestrictions.trim()}.`);
  if ((isContractorService(service) || isProfessionalService(service) || isPlantHire(service)) && siteConstraints.trim()) details.push(`Site constraints: ${siteConstraints.trim()}.`);
  if ((isContractorService(service) || isProfessionalService(service)) && deliverables.trim()) details.push(`Required outputs/deliverables: ${deliverables.trim()}.`);
  if ((isContractorService(service) || isProfessionalService(service)) && minimumRequirements.length > 0) details.push(`Minimum requirements: ${minimumRequirements.join(', ')}.`);
  if (isPlantHire(service) && plantRequirements.length > 0) details.push(`Plant hire requirements: ${plantRequirements.join(', ')}.`);
  if (isPlantHire(service) && driverRequired) details.push('Driver/operator required.');
  if (isPlantHire(service) && liftPlanRequired) details.push('Lift plan required.');
  return details.filter(Boolean).join('\n');
}

function newTenderItem(service: string, id = `${Date.now()}-${Math.random().toString(16).slice(2)}`): TenderItem {
  return {
    id,
    category: service,
    subcategory: '',
    item: '',
    quantityValue: '',
    quantityUnit: '',
    description: '',
    professionalServiceType: '',
    professionalServiceOther: '',
    durationValue: '',
    durationUnit: 'weeks',
    scopeSize: '',
    workingHours: '',
    accessRestrictions: '',
    siteConstraints: '',
    deliverables: '',
    minimumRequirements: [],
    plantRequirements: [],
    driverRequired: false,
    liftPlanRequired: false,
    spec: {},
  };
}

function LineSpecFields({
  service,
  spec,
  onChange,
  idPrefix,
}: {
  service: string;
  spec: TenderLineSpec;
  onChange: <K extends keyof TenderLineSpec>(key: K, value: TenderLineSpec[K]) => void;
  idPrefix: string;
}) {
  if (service === 'Waste') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup>
          <Label htmlFor={`${idPrefix}-ewc`}>EWC code</Label>
          <Select id={`${idPrefix}-ewc`} value={spec.ewcCode ?? ''} onChange={(event) => onChange('ewcCode', event.target.value)}>
            <option value="" disabled>Select a List of Wastes code</option>
            {COMMON_EWC_CODES.map((entry) => (
              <option key={entry.code} value={entry.code}>{entry.code} — {entry.label}</option>
            ))}
          </Select>
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${idPrefix}-container`}>Container</Label>
          <Select id={`${idPrefix}-container`} value={spec.container ?? ''} onChange={(event) => onChange('container', event.target.value as TenderLineSpec['container'])}>
            <option value="" disabled>Select skip, grab, or roll-on</option>
            {WASTE_CONTAINERS.map((container) => <option key={container} value={container}>{container}</option>)}
          </Select>
        </FieldGroup>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold text-foundation-navy">Hazardous</legend>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="radio" name={`${idPrefix}-hazardous`} checked={spec.hazardous === true} onChange={() => onChange('hazardous', true)} className="h-4 w-4 accent-trade-blue" />Hazardous</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name={`${idPrefix}-hazardous`} checked={spec.hazardous === false} onChange={() => onChange('hazardous', false)} className="h-4 w-4 accent-trade-blue" />Non-hazardous</label>
          </div>
        </fieldset>
      </div>
    );
  }
  if (service === 'Materials') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup><Label htmlFor={`${idPrefix}-dimension`}>Dimension / size <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`${idPrefix}-dimension`} value={spec.dimension ?? ''} onChange={(event) => onChange('dimension', event.target.value)} placeholder="e.g. 215 mm or 20 mm" /></FieldGroup>
        <FieldGroup><Label htmlFor={`${idPrefix}-class`}>Class / grade <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`${idPrefix}-class`} value={spec.materialClass ?? ''} onChange={(event) => onChange('materialClass', event.target.value)} placeholder="e.g. Type 1 or facing" /></FieldGroup>
        <FieldGroup><Label htmlFor={`${idPrefix}-standard`}>Standard / specification <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`${idPrefix}-standard`} value={spec.standard ?? ''} onChange={(event) => onChange('standard', event.target.value)} placeholder="e.g. BS EN 771-1 or SHW Clause 803" /></FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${idPrefix}-pack`}>Pack <span className="font-normal text-concrete-grey">(optional)</span></Label>
          <Select id={`${idPrefix}-pack`} value={spec.pack ?? ''} onChange={(event) => onChange('pack', event.target.value as TenderLineSpec['pack'])}>
            <option value="">Select pack</option>
            {MATERIAL_PACKS.map((pack) => <option key={pack} value={pack}>{pack}</option>)}
          </Select>
        </FieldGroup>
      </div>
    );
  }
  if (service === 'Plant Hire') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup><Label htmlFor={`${idPrefix}-capacity`}>Capacity <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`${idPrefix}-capacity`} value={spec.capacity ?? ''} onChange={(event) => onChange('capacity', event.target.value)} placeholder="e.g. 3 tonnes or 22 m" /></FieldGroup>
      </div>
    );
  }
  return null;
}

export default function NewTenderPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-site-white p-6 text-sm text-concrete-grey">Loading tender builder...</main>}>
      <NewTenderForm />
    </Suspense>
  );
}

function NewTenderForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copyFrom = searchParams.get('copyFrom');
  const [step, setStep] = useState(1);
  const [furthestStep, setFurthestStep] = useState(1);
  const [activePackageIndex, setActivePackageIndex] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [files, setFiles] = useState<Array<{ id: string; file: File; kind: AttachmentKind }>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [packagesNeedReset, setPackagesNeedReset] = useState(true);
  const [catalog, setCatalog] = useState<Record<string, Record<string, string[]>>>(() => Object.fromEntries(Object.entries(SERVICE_CATALOG).map(([service, categories]) => [service, Object.fromEntries(Object.entries(categories).map(([name, items]) => [name, [...items]]))])));
  const [canRaiseTender, setCanRaiseTender] = useState<boolean | null>(null);

  const hasDetectedContactDetails = [
    getModerationMessage('description', form.description),
    ...form.items.map((item) => getModerationMessage(`item ${item.category}`, item.description)),
  ].some(Boolean);
  const activeCategory = activePackageIndex === 0
    ? form.category
    : form.items[activePackageIndex - 1]?.category ?? form.category;
  const activePackageLabels = packageLabels(activeCategory);

  useEffect(() => {
    fetch('/api/user/capabilities')
      .then((response) => response.ok ? response.json() : null)
      .then((data: { canRaiseTender?: boolean } | null) => setCanRaiseTender(data?.canRaiseTender !== false))
      .catch(() => setCanRaiseTender(true));
  }, []);

  // Restore a saved draft after mount only, so server and first client render still match.
  useEffect(() => {
    if (copyFrom) return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        setForm((prev) => ({ ...prev, ...JSON.parse(raw) }));
        setDraftRestored(true);
        setPackagesNeedReset(false);
      }
    } catch {
      // Corrupt or unavailable storage — start with a blank form.
    }
  }, [copyFrom]);

  useEffect(() => {
    if (!copyFrom) return;
    const sourceTenderId = copyFrom;
    let cancelled = false;

    async function loadTenderForRetender() {
      const response = await fetch(`/api/tenders/${encodeURIComponent(sourceTenderId)}`);
      if (!response.ok) throw new Error('Unable to load tender');
      const { tender } = await response.json() as { tender: { category: string; subcategory: string; item: string | null; location: string; quantity: string; urgency: string; closingDate: string; supplyDate: string | null; requirements: string; description: string; items: { id: string; category: string; subcategory: string; item: string | null; quantity: string; description: string }[]; attachments: { id: string; fileName: string; mimeType: string }[] } };
      const tenderItems = tender.items.length > 0 ? tender.items : [{ id: 'primary', category: tender.category, subcategory: tender.subcategory, item: tender.item, quantity: tender.quantity, description: tender.description }];
      const primaryItem = tenderItems[0]!;
      const primaryQuantity = splitQuantity(primaryItem.quantity);
      const attachments = await Promise.all(tender.attachments.map(async (attachment) => {
        const attachmentResponse = await fetch(`/api/tenders/${encodeURIComponent(sourceTenderId)}/attachments/${encodeURIComponent(attachment.id)}`);
        if (!attachmentResponse.ok) throw new Error('Unable to copy tender attachments');
        return { id: attachment.id, file: new File([await attachmentResponse.blob()], attachment.fileName, { type: attachment.mimeType }), kind: 'OTHER' as AttachmentKind };
      }));
      if (cancelled) return;
      setForm({
        ...EMPTY_FORM,
        projectName: `${primaryItem.subcategory} re-tender`,
        selectedServices: [...new Set(tenderItems.map((item) => item.category))],
        category: primaryItem.category,
        subcategory: primaryItem.subcategory,
        item: primaryItem.item ?? '',
        location: tender.location,
        quantityValue: primaryQuantity.quantityValue,
        quantityUnit: primaryQuantity.quantityUnit,
        description: tender.description,
        primaryItemDescription: primaryItem.description,
        urgency: tender.urgency,
        closingDate: '',
        supplyDate: tender.supplyDate?.slice(0, 10) ?? '',
        requirements: tender.requirements.split(',').filter(Boolean),
        items: tenderItems.slice(1).map((item) => {
          const quantity = splitQuantity(item.quantity);
          return { ...newTenderItem(item.category, item.id), subcategory: item.subcategory, item: item.item ?? '', quantityValue: quantity.quantityValue, quantityUnit: quantity.quantityUnit, description: item.description };
        }),
      });
      setFiles(attachments);
      setPackagesNeedReset(false);
    }

    loadTenderForRetender().catch(() => setError('We could not prepare this tender for re-tendering.'));
    return () => { cancelled = true; };
  }, [copyFrom]);

  useEffect(() => {
    fetch('/api/categories').then((response) => response.ok ? response.json() : null).then((data: { catalog?: Record<string, Record<string, string[]>> } | null) => {
      if (data?.catalog) setCatalog(data.catalog);
    }).catch(() => undefined);
  }, []);

  // Auto-save progress as the Client works through the form (files are never persisted here).
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      } catch {
        // Autosave is a convenience only — ignore storage failures.
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRequirement(option: string) {
    setForm((prev) => ({
      ...prev,
      requirements: prev.requirements.includes(option)
        ? prev.requirements.filter((item) => item !== option)
        : [...prev.requirements, option],
    }));
  }

  function togglePrimaryPlantRequirement(option: string) {
    setForm((prev) => ({
      ...prev,
      primaryPlantRequirements: prev.primaryPlantRequirements.includes(option)
        ? prev.primaryPlantRequirements.filter((item) => item !== option)
        : [...prev.primaryPlantRequirements, option],
    }));
  }

  function toggleItemArray(index: number, key: 'minimumRequirements' | 'plantRequirements', option: string) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const values = item[key];
        return { ...item, [key]: values.includes(option) ? values.filter((value) => value !== option) : [...values, option] };
      }),
    }));
  }

  function toggleService(service: string) {
    setPackagesNeedReset(true);
    setForm((current) => ({
      ...current,
      selectedServices: current.selectedServices.includes(service)
        ? current.selectedServices.filter((item) => item !== service)
        : [...current.selectedServices, service],
    }));
  }

  function updateItem<K extends keyof TenderItem>(index: number, key: K, value: TenderItem[K]) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    }));
  }

  function updatePrimarySpec<K extends keyof TenderLineSpec>(key: K, value: TenderLineSpec[K]) {
    setForm((current) => ({ ...current, primarySpec: { ...current.primarySpec, [key]: value } }));
  }

  function updateItemSpec<K extends keyof TenderLineSpec>(index: number, key: K, value: TenderLineSpec[K]) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => (itemIndex === index ? { ...item, spec: { ...item.spec, [key]: value } } : item)),
    }));
  }

  function addAnotherItem() {
    const category = activeCategory || form.selectedServices[0] || '';
    setActivePackageIndex(form.items.length + 1);
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          ...newTenderItem(category),
        },
      ],
    }));
  }

  function validateStep(targetStep: number): boolean {
    const next: Record<string, string> = {};
    if (targetStep === 1) {
      if (form.projectName.trim().length < 3) next.projectName = 'Enter a project name (at least 3 characters).';
      if (form.selectedServices.length === 0) next.selectedServices = 'Select at least one service group to tender.';
      if (!/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i.test(form.location)) {
        next.location = 'Enter a valid UK jobsite or delivery postcode.';
      }
      if (!form.closingDate) next.closingDate = 'Select a quote closing date.';
      else if (new Date(form.closingDate).getTime() <= Date.now()) next.closingDate = 'Closing date must be in the future.';
      const descriptionWarning = getModerationMessage('description', form.description);
      if (descriptionWarning) next.description = descriptionWarning;
    }
    if (targetStep === 2) {
      if (activePackageIndex === 0) {
        if (!form.subcategory) next.subcategory = 'Select a service category.';
        if (isSpecifiedItemService(form.category) && !form.item) next.item = 'Select a specified item.';
        if (isProfessionalService(form.category) && !form.item) next.item = 'Select the professional service needed.';
        if (isProfessionalService(form.category) && form.item === 'Other' && form.primaryProfessionalServiceOther.trim().length < 5) next.item = 'Describe the other professional service needed.';

        if (isPlantHire(form.category)) {
          if (!form.primaryDurationValue.trim()) next.quantityValue = 'Enter the hire period.';
          else if (!/^\d+(?:\.\d+)?$/.test(form.primaryDurationValue.trim())) next.quantityValue = 'Duration must be a number.';
        } else if (isContractorService(form.category)) {
          if (form.quantityValue.trim() && !(MEASURED_CONTRACTOR_UNITS as readonly string[]).includes(form.quantityUnit) && !/\b(days?|weeks?|months?)\b/i.test(form.quantityUnit)) {
            next.quantityUnit = 'Select m, m², m³, nr, item, or week.';
          }
        } else if (!isProfessionalService(form.category)) {
          const packageSenseCheck = getServiceSenseCheck(form.category, form.quantityValue, form.quantityUnit);
          if (packageSenseCheck.quantityError) next.quantityValue = packageSenseCheck.quantityError;
          if (packageSenseCheck.unitError) next.quantityUnit = packageSenseCheck.unitError;
          if (!packageSenseCheck.quantityError && !packageSenseCheck.unitError) {
            if (!form.quantityValue.trim() && form.quantityUnit !== 'not applicable') next.quantityValue = 'Enter a quantity.';
            if (!form.quantityUnit) next.quantityUnit = 'Select a unit or not applicable.';
          }
        }
        if (form.category === 'Waste' && form.quantityUnit !== 'tonnes') next.quantityUnit = 'Waste must be specified in tonnes.';
        specIssues(form.category, {
          ...form.primarySpec,
          plantClass: form.primarySpec.plantClass || form.subcategory,
          period: form.primarySpec.period || (form.primaryDurationValue.trim() ? `${form.primaryDurationValue.trim()} ${form.primaryDurationUnit}` : undefined),
        }, packageQuantity(form.category, form.quantityValue, form.quantityUnit, form.primaryDurationValue, form.primaryDurationUnit)).forEach((message, issueIndex) => {
          next[`spec-${issueIndex}`] = message;
        });
        const specWarning = getModerationMessage('package specification', form.primaryItemDescription);
        if (specWarning) next.primaryItemDescription = specWarning;
      } else {
        const item = form.items[activePackageIndex - 1];
        const prefix = `item-${activePackageIndex - 1}-`;
        if (!item?.subcategory) next[`${prefix}subcategory`] = 'Select a service category.';
        if (item && isSpecifiedItemService(item.category) && !item.item) next[`${prefix}item`] = 'Select a specified item.';
        if (item && isProfessionalService(item.category) && !item.item) next[`${prefix}item`] = 'Select the professional service needed.';
        if (item && isProfessionalService(item.category) && item.item === 'Other' && item.professionalServiceOther.trim().length < 5) next[`${prefix}item`] = 'Describe the other professional service needed.';

        if (item && isPlantHire(item.category)) {
          if (!item.durationValue.trim()) next[`${prefix}quantity`] = 'Enter the hire period.';
          else if (!/^\d+(?:\.\d+)?$/.test(item.durationValue.trim())) next[`${prefix}quantity`] = 'Duration must be a number.';
        } else if (item && isContractorService(item.category)) {
          if (item.quantityValue.trim() && !(MEASURED_CONTRACTOR_UNITS as readonly string[]).includes(item.quantityUnit) && !/\b(days?|weeks?|months?)\b/i.test(item.quantityUnit)) {
            next[`${prefix}unit`] = 'Select m, m², m³, nr, item, or week.';
          }
        } else if (item && !isProfessionalService(item.category)) {
          const itemSenseCheck = getServiceSenseCheck(item.category, item.quantityValue, item.quantityUnit);
          if (itemSenseCheck.quantityError) next[`${prefix}quantity`] = itemSenseCheck.quantityError;
          if (itemSenseCheck.unitError) next[`${prefix}unit`] = itemSenseCheck.unitError;
          if (!itemSenseCheck.quantityError && !itemSenseCheck.unitError) {
            if (!item.quantityValue.trim() && item.quantityUnit !== 'not applicable') next[`${prefix}quantity`] = 'Enter a quantity.';
            if (!item.quantityUnit) next[`${prefix}unit`] = 'Select a unit or not applicable.';
          }
        }
        if (item && item.category === 'Waste' && item.quantityUnit !== 'tonnes') next[`${prefix}unit`] = 'Waste must be specified in tonnes.';
        if (item) {
          specIssues(item.category, {
            ...item.spec,
            plantClass: item.spec.plantClass || item.subcategory,
            period: item.spec.period || (item.durationValue.trim() ? `${item.durationValue.trim()} ${item.durationUnit}` : undefined),
          }, packageQuantity(item.category, item.quantityValue, item.quantityUnit, item.durationValue, item.durationUnit)).forEach((message, issueIndex) => {
            next[`${prefix}spec-${issueIndex}`] = message;
          });
          const specWarning = getModerationMessage(`item ${item.category}`, item.description);
          if (specWarning) next[`${prefix}description`] = specWarning;
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function currentPackageLabel(): string {
    return activePackageIndex === 0 ? 'Package 1' : `Package ${activePackageIndex + 1}`;
  }

  function goNext() {
    if (!validateStep(step)) {
      setError(`${currentPackageLabel()} cannot continue yet. Please fix the highlighted details listed at the top of this package.`);
      return;
    }
    setError(null);
    if (step === 1 && packagesNeedReset) {
      const [primaryService, ...additionalServices] = form.selectedServices;
      setForm((current) => ({
        ...current,
        category: primaryService,
        subcategory: '',
        item: '',
        quantityValue: '',
        quantityUnit: '',
        primarySpec: {},
        items: additionalServices.map((service, index) => newTenderItem(service, `${Date.now()}-${index}`)),
      }));
      setPackagesNeedReset(false);
    }
    if (step === 2 && activePackageIndex < form.items.length) {
      setActivePackageIndex((current) => current + 1);
      return;
    }
    const nextStep = Math.min(step + 1, STEPS.length);
    setStep(nextStep);
    setFurthestStep((current) => Math.max(current, nextStep));
  }

  function fastTravel(targetStep: number) {
    setErrors({});
    setStep(targetStep);
  }

  function goBack() {
    setErrors({});
    if (step === 2 && activePackageIndex > 0) {
      setActivePackageIndex((current) => current - 1);
      return;
    }
    setStep((current) => Math.max(current - 1, 1));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    setFiles((prev) => [...prev, ...selected.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file, kind: 'OTHER' as AttachmentKind }))]);
    event.target.value = '';
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((entry) => entry.file.name !== name));
  }

  function removeDetectedContactDetails() {
    setForm((prev) => ({
      ...prev,
      description: stripDetectedContactDetails(prev.description),
      items: prev.items.map((item) => ({
        ...item,
        description: stripDetectedContactDetails(item.description),
      })),
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.description;
      return next;
    });
  }

  async function prepareAttachments() {
    return Promise.all(
      files.map(async (entry) => {
        const name = buildSafeAttachmentName(entry.file.name);
        const mimeType = entry.file.type || 'application/octet-stream';
        const response = await fetch('/api/uploads', {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'x-file-name': name,
            'x-file-mime': mimeType,
            'x-upload-purpose': 'tender-attachment',
          },
          body: entry.file,
        });
        const body = await response.json().catch(() => null) as { uploadId?: string; error?: string } | null;
        if (!response.ok || !body?.uploadId) throw new Error(body?.error ?? 'Unable to upload an attachment.');
        return {
          name,
          mimeType,
          sizeBytes: entry.file.size,
          uploadId: body.uploadId,
          kind: entry.kind,
        };
      })
    );
  }

  async function handleSubmit() {
    const requiredStepsValid = [1, 2].every((targetStep) => validateStep(targetStep));
    if (!requiredStepsValid) {
      setError('Some required details are missing — please check the earlier steps.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: form.projectName,
          category: form.category,
          subcategory: form.subcategory,
          item: packageItem(form.category, form.item, form.primaryProfessionalServiceOther),
          location: form.location,
          quantity: packageQuantity(form.category, form.quantityValue, form.quantityUnit, form.primaryDurationValue, form.primaryDurationUnit),
          itemDescription: packageSpecification(form.primaryItemDescription, form.category, form.item, form.primaryProfessionalServiceOther, form.primaryDurationValue, form.primaryDurationUnit, form.primaryScopeSize, form.primaryWorkingHours, form.primaryAccessRestrictions, form.primarySiteConstraints, form.primaryDeliverables, form.primaryMinimumRequirements, form.primaryPlantRequirements, form.primaryDriverRequired, form.primaryLiftPlanRequired),
          spec: {
            ...form.primarySpec,
            plantClass: form.primarySpec.plantClass || form.subcategory,
            period: form.primarySpec.period || (form.primaryDurationValue.trim() ? `${form.primaryDurationValue.trim()} ${form.primaryDurationUnit}` : undefined),
          },
          urgency: form.urgency || 'standard',
          closingDate: form.closingDate,
          supplyDate: form.supplyDate || undefined,
          requirements: form.requirements,
          description: form.description,
          items: form.items.map((item) => ({
            category: item.category,
            subcategory: item.subcategory,
            item: packageItem(item.category, item.item, item.professionalServiceOther),
            quantity: packageQuantity(item.category, item.quantityValue, item.quantityUnit, item.durationValue, item.durationUnit),
            description: packageSpecification(item.description, item.category, item.item, item.professionalServiceOther, item.durationValue, item.durationUnit, item.scopeSize, item.workingHours, item.accessRestrictions, item.siteConstraints, item.deliverables, item.minimumRequirements, item.plantRequirements, item.driverRequired, item.liftPlanRequired),
            spec: {
              ...item.spec,
              plantClass: item.spec.plantClass || item.subcategory,
              period: item.spec.period || (item.durationValue.trim() ? `${item.durationValue.trim()} ${item.durationUnit}` : undefined),
            },
          })),
          attachments: await prepareAttachments(),
        }),
      });

      const responseBody = await response.json().catch(() => null) as {
        error?: string;
        issues?: { fieldErrors?: Record<string, string[]> };
        reasons?: string[];
      } | null;

      if (!response.ok) {
        const fieldErrors = responseBody?.issues?.fieldErrors ?? {};
        const firstFieldError = Object.values(fieldErrors).flat()[0];
        setError(firstFieldError ?? responseBody?.reasons?.join(' ') ?? responseBody?.error ?? `Unable to save this tender (HTTP ${response.status}).`);
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to clean up if storage was never available.
      }
      router.push(buyingTendersPath());
      router.refresh();
    } catch {
      setSubmitting(false);
      setError('We could not reach Trade Tender. Check your connection and try again.');
    }
  }

  if (canRaiseTender === null) {
    return (
      <AppShell role="client" title="Create tender">
        <div className="mx-auto max-w-4xl">
          <Card>
            <p role="status" className="text-sm text-foundation-navy">Checking organisation role…</p>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (canRaiseTender === false) {
    return (
      <AppShell role="client" title="Create tender">
        <div className="mx-auto max-w-4xl">
          <PageHeader description="Raising a tender is limited to the Buyer and QS / estimator roles on this organisation." />
          <Card>
            <p className="text-sm text-foundation-navy">Your organisation role is read-only for buying. Ask a workspace owner to assign Buyer or QS / estimator if you need to issue packages.</p>
            <Link href={buyingTendersPath()} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-trade-blue hover:text-foundation-navy">Back to my tenders</Link>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell role="client" title="Create tender">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          description={copyFrom ? 'Review the copied tender details, set a new quote deadline, and issue it as a new package.' : 'Compile a project, specify each package, then issue the frozen tender. Only fields needed for matching and a quote are required. Contractors and professionals pay a fixed fee to receive your contact details for a site visit.'}
        />

        <Stepper steps={STEPS} currentStep={step} furthestStep={furthestStep} onStepClick={fastTravel} />

        {draftRestored && (
          <Card className="mb-6 flex items-center justify-between gap-4 border-l-4 border-l-steel-blue">
            <p className="text-sm text-concrete-grey">We restored your saved progress from last time.</p>
            <button
              type="button"
              onClick={() => setDraftRestored(false)}
              className="text-sm font-semibold text-steel-blue hover:text-foundation-navy"
            >
              Dismiss
            </button>
          </Card>
        )}

        {step === 1 && (
          <Card className="flex flex-col gap-6">
            <h2 className="text-base font-semibold tracking-tight text-foundation-navy">Project</h2>
            <FieldGroup>
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                required
                placeholder="e.g. Side extension and external works"
                value={form.projectName}
                onChange={(event) => update('projectName', event.target.value)}
              />
              {errors.projectName && <p className="text-sm font-semibold text-attention">{errors.projectName}</p>}
            </FieldGroup>
            <FieldGroup>
              <Label htmlFor="location">Jobsite or delivery postcode</Label>
              <Input id="location" required placeholder="e.g. LS10 2AB" value={form.location} onChange={(event) => update('location', event.target.value)} />
              <p className="text-xs text-concrete-grey">Used to notify only Providers that cover this area.</p>
              {errors.location && <p className="text-sm font-semibold text-attention">{errors.location}</p>}
            </FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldGroup>
                <Label htmlFor="urgency">Project urgency <span className="font-normal text-concrete-grey">(optional)</span></Label>
                <Select id="urgency" value={form.urgency} onChange={(event) => update('urgency', event.target.value)}>
                  <option value="standard">Standard</option>
                  <option value="urgent">Urgent</option>
                  <option value="flexible">Flexible</option>
                </Select>
                {errors.urgency && <p className="text-sm font-semibold text-attention">{errors.urgency}</p>}
              </FieldGroup>
              <FieldGroup>
                <Label htmlFor="supply-date">Planned works start date (optional)</Label>
                <Input id="supply-date" type="date" value={form.supplyDate} onChange={(event) => update('supplyDate', event.target.value)} />
                {errors.supplyDate && <p className="text-sm font-semibold text-attention">{errors.supplyDate}</p>}
              </FieldGroup>
            </div>
            <FieldGroup>
              <Label htmlFor="closing-date">Quote deadline</Label>
              <div className="flex flex-wrap gap-2">
                {[7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => update('closingDate', closingDatePreset(days))}
                    className="rounded-md border border-steel-blue/40 px-3 py-1.5 text-xs font-semibold text-steel-blue hover:bg-steel-blue/5"
                  >
                    In {days} days
                  </button>
                ))}
              </div>
              <Input
                id="closing-date"
                type="date"
                required
                value={form.closingDate}
                onChange={(event) => update('closingDate', event.target.value)}
              />
              {errors.closingDate && <p className="text-sm font-semibold text-attention">{errors.closingDate}</p>}
            </FieldGroup>
            <FieldGroup>
              <Label>Services to tender</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.keys(catalog).map((service) => (
                  <label key={service} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-foundation-navy">
                    <input type="checkbox" checked={form.selectedServices.includes(service)} onChange={() => toggleService(service)} className="h-4 w-4 accent-trade-blue" />
                    {service}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-concrete-grey">Each selected service becomes a tender package. Only matching Providers and contractors in this area receive the relevant opportunity.</p>
              {errors.selectedServices && <p className="text-sm font-semibold text-attention">{errors.selectedServices}</p>}
            </FieldGroup>
            <FieldGroup>
              <Label htmlFor="description">Additional information (optional)</Label>
              <Textarea
                id="description"
                rows={4}
                placeholder="Add a project overview, site constraints, or information relevant to every tender package. Do not include phone numbers, email addresses, company names, or direct contact instructions."
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
              />
              <p className="text-xs text-concrete-grey">Keep project details in-platform. Do not include any phone numbers, email addresses, business names, or instructions to contact outside Trade Tender.</p>
              {errors.description && <p className="text-sm font-semibold text-attention">{errors.description}</p>}
            </FieldGroup>
          </Card>
        )}

        {step === 2 && (
          <>
          <Card className="flex flex-col gap-6">
            <h2 className="text-base font-semibold tracking-tight text-foundation-navy">{activeCategory}</h2>
            <p className="text-sm text-concrete-grey">Complete {currentPackageLabel()} of {form.items.length + 1} packages. If more than one service was selected, Continue opens the next package before Issue.</p>
            {Object.keys(errors).length > 0 && (
              <div role="alert" className="rounded-lg border border-attention/40 bg-attention/5 px-4 py-3 text-sm text-attention">
                <p className="font-semibold">{currentPackageLabel()} cannot continue yet.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {Object.values(errors).map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            )}
            {activePackageIndex !== 0 && activeCategory === form.category && (
              <button
                type="button"
                onClick={() => { setActivePackageIndex(0); setErrors({}); }}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm hover:border-steel-blue"
              >
                <span><span className="font-semibold text-foundation-navy">Package 1: {form.item || form.subcategory || 'Untitled package'}</span><span className="block text-xs text-concrete-grey">{form.category} {form.quantityValue && `${form.quantityValue} ${form.quantityUnit}`}</span></span>
                <span className="text-xs font-semibold text-steel-blue">Edit</span>
              </button>
            )}
            {activePackageIndex === 0 && <><FieldGroup>
              <Label htmlFor="subcategory">{activePackageLabels.provision}</Label>
              <Combobox
                id="subcategory"
                name="subcategory"
                value={form.subcategory}
                onChange={(value) => update('subcategory', value)}
                disabled={!form.category}
                placeholder={form.category ? 'Search categories…' : 'Choose a service first'}
                groups={form.category ? [{ label: form.category, options: Object.keys(catalog[form.category] ?? {}) }] : []}
              />
              {errors.subcategory && <p className="text-sm font-semibold text-attention">{errors.subcategory}</p>}
            </FieldGroup>
            <FieldGroup>
              <Label htmlFor="item">{activePackageLabels.detail}</Label>
              <Combobox id="item" name="item" value={form.item} onChange={(value) => update('item', value)} disabled={!form.subcategory} placeholder={form.subcategory ? 'Search detailed provisions…' : 'Choose a service provision first'} groups={form.category ? [{ label: form.subcategory, options: catalog[form.category]?.[form.subcategory] ?? [] }] : []} />
              {errors.item && <p className="text-sm font-semibold text-attention">{errors.item}</p>}
            </FieldGroup>
            {isProfessionalService(form.category) && form.item === 'Other' && <FieldGroup><Label htmlFor="professional-service-other">Other service details</Label><Input id="professional-service-other" value={form.primaryProfessionalServiceOther} onChange={(event) => update('primaryProfessionalServiceOther', event.target.value)} placeholder="Describe the service required" /></FieldGroup>}
            <LineSpecFields service={form.category} spec={form.primarySpec} onChange={updatePrimarySpec} idPrefix="primary-spec" />
            {isContractorService(form.category) && <div className="grid gap-4 sm:grid-cols-2"><FieldGroup><Label htmlFor="quantity-value">Measured quantity <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id="quantity-value" placeholder="e.g. 120" inputMode="decimal" value={form.quantityValue} onChange={(event) => update('quantityValue', event.target.value)} />{errors.quantityValue && <p className="text-sm font-semibold text-attention">{errors.quantityValue}</p>}</FieldGroup><FieldGroup><Label htmlFor="quantity-unit">Measured unit <span className="font-normal text-concrete-grey">(optional)</span></Label><Select id="quantity-unit" value={form.quantityUnit} onChange={(event) => update('quantityUnit', event.target.value)}><option value="">Select a unit</option>{MEASURED_CONTRACTOR_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select>{errors.quantityUnit && <p className="text-sm font-semibold text-attention">{errors.quantityUnit}</p>}</FieldGroup></div>}
            {(isContractorService(form.category) || isProfessionalService(form.category) || isPlantHire(form.category)) ? <div className="grid gap-4 sm:grid-cols-2"><FieldGroup><Label htmlFor="duration-value">{isPlantHire(form.category) ? 'Required hire period' : <>Required service period <span className="font-normal text-concrete-grey">(optional)</span></>}</Label><Input id="duration-value" placeholder="e.g. 3" inputMode="decimal" value={form.primaryDurationValue} onChange={(event) => update('primaryDurationValue', event.target.value)} />{(isContractorService(form.category) ? errors.durationValue : errors.quantityValue) && <p className="text-sm font-semibold text-attention">{isContractorService(form.category) ? errors.durationValue : errors.quantityValue}</p>}</FieldGroup><FieldGroup><Label htmlFor="duration-unit">{isPlantHire(form.category) ? 'Duration unit' : <>Duration unit <span className="font-normal text-concrete-grey">(optional)</span></>}</Label><Select id="duration-unit" value={form.primaryDurationUnit} onChange={(event) => update('primaryDurationUnit', event.target.value)}>{DURATION_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select>{(isContractorService(form.category) ? errors.durationUnit : errors.quantityUnit) && <p className="text-sm font-semibold text-attention">{isContractorService(form.category) ? errors.durationUnit : errors.quantityUnit}</p>}</FieldGroup></div> : !isContractorService(form.category) ? <div className="grid gap-4 sm:grid-cols-2"><FieldGroup><Label htmlFor="quantity-value">Quantity</Label><Input id="quantity-value" required placeholder="e.g. 4,000" inputMode="decimal" value={form.quantityValue} onChange={(event) => update('quantityValue', event.target.value)} />{errors.quantityValue && <p className="text-sm font-semibold text-attention">{errors.quantityValue}</p>}</FieldGroup><FieldGroup><Label htmlFor="quantity-unit">Unit</Label><Select id="quantity-unit" required value={form.quantityUnit} onChange={(event) => update('quantityUnit', event.target.value)}><option value="" disabled>Select a unit</option>{(form.category === 'Waste' ? WASTE_QUANTITY_UNITS : GOODS_QUANTITY_UNITS).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select>{errors.quantityUnit && <p className="text-sm font-semibold text-attention">{errors.quantityUnit}</p>}</FieldGroup></div> : null}
            {(isContractorService(form.category) || isProfessionalService(form.category) || isPlantHire(form.category)) && <div className="grid gap-4 sm:grid-cols-2"><FieldGroup><Label htmlFor="scope-size">Size, scope or output quantity <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id="scope-size" value={form.primaryScopeSize} onChange={(event) => update('primaryScopeSize', event.target.value)} placeholder="e.g. 120 m drainage run, 3 site visits, weekly retained support" />{errors.scopeSize && <p className="text-sm font-semibold text-attention">{errors.scopeSize}</p>}</FieldGroup><FieldGroup><Label htmlFor="working-hours">Permitted working hours <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id="working-hours" value={form.primaryWorkingHours} onChange={(event) => update('primaryWorkingHours', event.target.value)} placeholder="e.g. Mon-Fri 08:00-17:00, no weekend work" />{errors.workingHours && <p className="text-sm font-semibold text-attention">{errors.workingHours}</p>}</FieldGroup><FieldGroup><Label htmlFor="access-restrictions">Access restrictions <span className="font-normal text-concrete-grey">(optional)</span></Label><Textarea id="access-restrictions" rows={3} value={form.primaryAccessRestrictions} onChange={(event) => update('primaryAccessRestrictions', event.target.value)} placeholder="Gate widths, parking, loading area, permits, occupied premises, or not applicable." />{errors.accessRestrictions && <p className="text-sm font-semibold text-attention">{errors.accessRestrictions}</p>}</FieldGroup><FieldGroup><Label htmlFor="site-constraints">Site constraints <span className="font-normal text-concrete-grey">(optional)</span></Label><Textarea id="site-constraints" rows={3} value={form.primarySiteConstraints} onChange={(event) => update('primarySiteConstraints', event.target.value)} placeholder="Live site, residents nearby, services, asbestos, fragile surfaces, traffic, noise limits, or not applicable." />{errors.siteConstraints && <p className="text-sm font-semibold text-attention">{errors.siteConstraints}</p>}</FieldGroup>{(isContractorService(form.category) || isProfessionalService(form.category)) && <FieldGroup wide><Label htmlFor="deliverables">Works, outputs or deliverables <span className="font-normal text-concrete-grey">(optional)</span></Label><Textarea id="deliverables" rows={3} value={form.primaryDeliverables} onChange={(event) => update('primaryDeliverables', event.target.value)} placeholder="State what must be priced: works scope, drawings/reports, inspection frequency, attendance, exclusions, handover evidence." />{errors.deliverables && <p className="text-sm font-semibold text-attention">{errors.deliverables}</p>}</FieldGroup>}</div>}
            {isPlantHire(form.category) && <fieldset className="rounded-md border border-slate-200 bg-slate-50 p-4"><legend className="px-1 text-sm font-semibold text-foundation-navy">Plant hire support</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{PLANT_HIRE_SUPPORT_OPTIONS.map((option) => <label key={option} className="flex items-center gap-3 text-sm text-concrete-grey"><input type="checkbox" checked={form.primaryPlantRequirements.includes(option) || (option === 'Driver/operator required' && form.primaryDriverRequired) || (option === 'Lift plan required' && form.primaryLiftPlanRequired)} onChange={() => { if (option === 'Driver/operator required') update('primaryDriverRequired', !form.primaryDriverRequired); else if (option === 'Lift plan required') update('primaryLiftPlanRequired', !form.primaryLiftPlanRequired); else togglePrimaryPlantRequirement(option); }} className="h-4 w-4 accent-trade-blue" />{option}</label>)}</div></fieldset>}
            <FieldGroup>
              <Label htmlFor="primary-item-description">Detailed job specification <span className="font-normal text-concrete-grey">(optional)</span></Label>
              <Textarea id="primary-item-description" rows={5} value={form.primaryItemDescription} placeholder="Set out the scope, standards, drawings/spec references, access constraints, expected outputs, exclusions, and quote assumptions needed for a Provider to price accurately." onChange={(event) => update('primaryItemDescription', event.target.value)} />
              {errors.primaryItemDescription && <p className="text-xs font-semibold text-attention">{errors.primaryItemDescription}</p>}
            </FieldGroup>
            </>}
            <div className="border-t border-slate-200 pt-5 sm:col-span-2">
              <p className="text-xs text-concrete-grey">Package {activePackageIndex + 1} of {form.selectedServices.length}</p>
              {form.items.length > 0 && (
                <div className="mt-5 flex flex-col gap-4">
                  {form.items.map((item, index) => {
                    const isActive = index === activePackageIndex - 1;
                    if (!isActive && item.category === activeCategory) {
                      return (
                        <button key={item.id} type="button" onClick={() => { setActivePackageIndex(index + 1); setErrors({}); }} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm hover:border-steel-blue">
                          <span><span className="font-semibold text-foundation-navy">Package {index + 2}: {item.item || item.subcategory || 'Untitled package'}</span><span className="block text-xs text-concrete-grey">{item.category} {item.quantityValue && `${item.quantityValue} ${item.quantityUnit}`}</span></span>
                          <span className="text-xs font-semibold text-steel-blue">Edit</span>
                        </button>
                      );
                    }
                    if (isActive) return (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foundation-navy">{item.category}</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FieldGroup>
                          <Label htmlFor={`item-${index}-subcategory`}>{packageLabels(item.category).provision}</Label>
                          <Combobox
                            id={`item-${index}-subcategory`}
                            name={`item-${index}-subcategory-input`}
                            value={item.subcategory}
                            onChange={(value) => updateItem(index, 'subcategory', value)}
                            disabled={!item.category}
                            placeholder={item.category ? 'Search categories…' : 'Choose a service first'}
                            groups={item.category ? [{ label: item.category, options: Object.keys(catalog[item.category] ?? {}) }] : []}
                          />
                          {errors[`item-${index}-subcategory`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-subcategory`]}</p>}
                        </FieldGroup>
                        <FieldGroup>
                          <Label htmlFor={`item-${index}-item`}>{packageLabels(item.category).detail}</Label>
                          <Combobox
                            id={`item-${index}-item`}
                            name={`item-${index}-item-input`}
                            value={item.item}
                            onChange={(value) => updateItem(index, 'item', value)}
                            disabled={!item.subcategory}
                            placeholder={item.subcategory ? 'Search detailed provisions…' : 'Choose a service provision first'}
                            groups={item.category ? [{ label: item.subcategory, options: catalog[item.category]?.[item.subcategory] ?? [] }] : []}
                          />
                          {errors[`item-${index}-item`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-item`]}</p>}
                        </FieldGroup>
                        {isProfessionalService(item.category) && item.item === 'Other' && <FieldGroup><Label htmlFor={`item-${index}-professional-service-other`}>Other service details</Label><Input id={`item-${index}-professional-service-other`} value={item.professionalServiceOther} onChange={(event) => updateItem(index, 'professionalServiceOther', event.target.value)} placeholder="Describe the service required" /></FieldGroup>}
                        <div className="sm:col-span-2"><LineSpecFields service={item.category} spec={item.spec} onChange={(key, value) => updateItemSpec(index, key, value)} idPrefix={`item-${index}-spec`} /></div>
                        {isContractorService(item.category) && <><FieldGroup><Label htmlFor={`item-${index}-quantity`}>Measured quantity <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`item-${index}-quantity`} value={item.quantityValue} placeholder="e.g. 120" inputMode="decimal" onChange={(event) => updateItem(index, 'quantityValue', event.target.value)} />{errors[`item-${index}-quantity`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-quantity`]}</p>}</FieldGroup><FieldGroup><Label htmlFor={`item-${index}-unit`}>Measured unit <span className="font-normal text-concrete-grey">(optional)</span></Label><Select id={`item-${index}-unit`} value={item.quantityUnit} onChange={(event) => updateItem(index, 'quantityUnit', event.target.value)}><option value="">Select a unit</option>{MEASURED_CONTRACTOR_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select>{errors[`item-${index}-unit`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-unit`]}</p>}</FieldGroup></>}
                        {(isContractorService(item.category) || isProfessionalService(item.category) || isPlantHire(item.category)) ? <><FieldGroup><Label htmlFor={`item-${index}-duration`}>{isPlantHire(item.category) ? 'Required hire period' : <>Required service period <span className="font-normal text-concrete-grey">(optional)</span></>}</Label><Input id={`item-${index}-duration`} value={item.durationValue} placeholder="e.g. 3" inputMode="decimal" onChange={(event) => updateItem(index, 'durationValue', event.target.value)} />{errors[`item-${index}-${isContractorService(item.category) ? 'duration' : 'quantity'}`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-${isContractorService(item.category) ? 'duration' : 'quantity'}`]}</p>}</FieldGroup><FieldGroup><Label htmlFor={`item-${index}-duration-unit`}>{isPlantHire(item.category) ? 'Duration unit' : <>Duration unit <span className="font-normal text-concrete-grey">(optional)</span></>}</Label><Select id={`item-${index}-duration-unit`} value={item.durationUnit} onChange={(event) => updateItem(index, 'durationUnit', event.target.value)}>{DURATION_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select>{errors[`item-${index}-${isContractorService(item.category) ? 'durationUnit' : 'unit'}`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-${isContractorService(item.category) ? 'durationUnit' : 'unit'}`]}</p>}</FieldGroup></> : !isContractorService(item.category) ? <><FieldGroup>
                          <Label htmlFor={`item-${index}-quantity`}>Quantity</Label>
                          <Input id={`item-${index}-quantity`} value={item.quantityValue} placeholder="e.g. 20" inputMode="decimal" onChange={(event) => updateItem(index, 'quantityValue', event.target.value)} />
                          {errors[`item-${index}-quantity`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-quantity`]}</p>}
                        </FieldGroup>
                        <FieldGroup>
                          <Label htmlFor={`item-${index}-unit`}>Unit</Label>
                          <Select id={`item-${index}-unit`} value={item.quantityUnit} onChange={(event) => updateItem(index, 'quantityUnit', event.target.value)}>
                            <option value="" disabled>Select a unit</option>
                            {(item.category === 'Waste' ? WASTE_QUANTITY_UNITS : GOODS_QUANTITY_UNITS).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                          </Select>
                          {errors[`item-${index}-unit`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-unit`]}</p>}
                        </FieldGroup></> : null}
                      </div>
                      {(isContractorService(item.category) || isProfessionalService(item.category) || isPlantHire(item.category)) && <div className="mt-4 grid gap-4 sm:grid-cols-2"><FieldGroup><Label htmlFor={`item-${index}-scope-size`}>Size, scope or output quantity <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`item-${index}-scope-size`} value={item.scopeSize} onChange={(event) => updateItem(index, 'scopeSize', event.target.value)} placeholder="e.g. 120 m drainage run, 3 site visits, weekly retained support" />{errors[`item-${index}-scopeSize`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-scopeSize`]}</p>}</FieldGroup><FieldGroup><Label htmlFor={`item-${index}-working-hours`}>Permitted working hours <span className="font-normal text-concrete-grey">(optional)</span></Label><Input id={`item-${index}-working-hours`} value={item.workingHours} onChange={(event) => updateItem(index, 'workingHours', event.target.value)} placeholder="e.g. Mon-Fri 08:00-17:00, no weekend work" />{errors[`item-${index}-workingHours`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-workingHours`]}</p>}</FieldGroup><FieldGroup><Label htmlFor={`item-${index}-access-restrictions`}>Access restrictions <span className="font-normal text-concrete-grey">(optional)</span></Label><Textarea id={`item-${index}-access-restrictions`} rows={3} value={item.accessRestrictions} onChange={(event) => updateItem(index, 'accessRestrictions', event.target.value)} placeholder="Gate widths, parking, loading area, permits, occupied premises, or not applicable." />{errors[`item-${index}-accessRestrictions`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-accessRestrictions`]}</p>}</FieldGroup><FieldGroup><Label htmlFor={`item-${index}-site-constraints`}>Site constraints <span className="font-normal text-concrete-grey">(optional)</span></Label><Textarea id={`item-${index}-site-constraints`} rows={3} value={item.siteConstraints} onChange={(event) => updateItem(index, 'siteConstraints', event.target.value)} placeholder="Live site, residents nearby, services, asbestos, fragile surfaces, traffic, noise limits, or not applicable." />{errors[`item-${index}-siteConstraints`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-siteConstraints`]}</p>}</FieldGroup>{(isContractorService(item.category) || isProfessionalService(item.category)) && <FieldGroup wide><Label htmlFor={`item-${index}-deliverables`}>Works, outputs or deliverables <span className="font-normal text-concrete-grey">(optional)</span></Label><Textarea id={`item-${index}-deliverables`} rows={3} value={item.deliverables} onChange={(event) => updateItem(index, 'deliverables', event.target.value)} placeholder="State what must be priced: works scope, drawings/reports, inspection frequency, attendance, exclusions, handover evidence." />{errors[`item-${index}-deliverables`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-deliverables`]}</p>}</FieldGroup>}</div>}
                      {isPlantHire(item.category) && <fieldset className="mt-4 rounded-md border border-slate-200 bg-white p-4"><legend className="px-1 text-sm font-semibold text-foundation-navy">Plant hire support</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{PLANT_HIRE_SUPPORT_OPTIONS.map((option) => <label key={option} className="flex items-center gap-3 text-sm text-concrete-grey"><input type="checkbox" checked={item.plantRequirements.includes(option) || (option === 'Driver/operator required' && item.driverRequired) || (option === 'Lift plan required' && item.liftPlanRequired)} onChange={() => { if (option === 'Driver/operator required') updateItem(index, 'driverRequired', !item.driverRequired); else if (option === 'Lift plan required') updateItem(index, 'liftPlanRequired', !item.liftPlanRequired); else toggleItemArray(index, 'plantRequirements', option); }} className="h-4 w-4 accent-trade-blue" />{option}</label>)}</div></fieldset>}
                      <FieldGroup>
                        <Label htmlFor={`item-${index}-description`}>Detailed job specification <span className="font-normal text-concrete-grey">(optional)</span></Label>
                        <Textarea id={`item-${index}-description`} rows={5} value={item.description} placeholder="Set out the scope, standards, drawings/spec references, access constraints, expected outputs, exclusions, and quote assumptions needed for a Provider to price accurately." onChange={(event) => updateItem(index, 'description', event.target.value)} />
                        {errors[`item-${index}-description`] && <p className="text-xs font-semibold text-attention">{errors[`item-${index}-description`]}</p>}
                      </FieldGroup>
                    </div>
                    );
                    return null;
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={addAnotherItem}
                className="mt-5 inline-flex items-center justify-center self-start rounded-md border border-steel-blue/40 bg-steel-blue/5 px-3 py-2 text-xs font-semibold text-steel-blue hover:bg-steel-blue/10"
              >
                Add another item
              </button>
            </div>
          </Card>
          <Card className="flex flex-col gap-6">
            <h2 className="text-base font-semibold tracking-tight text-foundation-navy">Lane compliance</h2>
            <p className="text-sm text-concrete-grey">Only requirements that apply to the selected supply lanes are shown.</p>
            <fieldset>
              <legend className="text-sm font-semibold text-foundation-navy">Site, delivery and supporting requirements</legend>
              <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {laneComplianceForServices([form.category, ...form.items.map((item) => item.category), ...form.selectedServices]).map((option) => (
                  <label key={option} className="flex items-center gap-3 text-sm text-concrete-grey">
                    <input
                      type="checkbox"
                      checked={form.requirements.includes(option)}
                      onChange={() => toggleRequirement(option)}
                      className="h-4 w-4 accent-trade-blue"
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>
          <Card className="flex flex-col gap-4">
            <h2 className="text-base font-semibold tracking-tight text-foundation-navy">Classed documents</h2>
            <p className="text-sm text-concrete-grey">
              Classify each file as a drawing, specification, RAMS, method statement, insurance, or other. Suppliers cannot download these until they unlock.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center hover:border-steel-blue">
              <span className="text-sm font-semibold text-steel-blue">Choose files or drag them here</span>
              <span className="text-xs text-concrete-grey">PDF, Word, or image files</span>
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
            {files.length > 0 && (
              <ul className="flex flex-col gap-2">
                {files.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-2 rounded-md bg-slate-50 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="truncate text-foundation-navy">{entry.file.name}</span>
                    <div className="flex items-center gap-3">
                      <select
                        value={entry.kind}
                        onChange={(event) => setFiles((current) => current.map((file) => file.id === entry.id ? { ...file, kind: event.target.value as AttachmentKind } : file))}
                        className="min-h-11 rounded-md border border-slate-300 px-2 text-sm"
                      >
                        {ATTACHMENT_KINDS.map((kind) => (
                          <option key={kind} value={kind}>{ATTACHMENT_KIND_LABELS[kind]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeFile(entry.file.name)}
                        className="text-xs font-semibold text-attention hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
        )}

        {step === 3 && (
          <Card className="flex flex-col gap-5">
            <h2 className="text-base font-semibold tracking-tight text-foundation-navy">Issue package</h2>
            <ReviewSection title="Project" onEdit={() => setStep(1)}>
              <dl className="grid gap-4 sm:grid-cols-2">
                <ReviewItem label="Project name" value={form.projectName} />
                <ReviewItem label="Selected services" value={form.selectedServices.join(', ')} />
                <ReviewItem label="Jobsite or delivery postcode" value={form.location} />
                <ReviewItem label="Urgency" value={form.urgency} />
                <ReviewItem label="Closing date" value={form.closingDate} />
                <ReviewItem label="Planned works start date" value={form.supplyDate || 'Not specified'} />
              </dl>
              <div className="mt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-concrete-grey">Project information</p>
                <p className="whitespace-pre-line text-sm text-foundation-navy">{form.description || 'None'}</p>
              </div>
            </ReviewSection>
            <ReviewSection title="Packages" onEdit={() => { setActivePackageIndex(0); setStep(2); }}>
              <dl className="grid gap-4 sm:grid-cols-2">
                <ReviewItem label="Tender packages" value={`${form.items.length + 1} package(s)`} />
                <ReviewItem label="Primary quantity" value={`${form.quantityValue} ${form.quantityUnit}`.trim()} />
                <ReviewItem label="Primary specification" value={form.primaryItemDescription || 'None'} />
              </dl>
              {form.items.length > 0 && (
                <ul className="mt-4 flex flex-col gap-2 text-sm text-foundation-navy">
                  {form.items.map((item, index) => <li key={item.id}>{index + 2}. {item.category} / {item.subcategory} &middot; {item.quantityValue} {item.quantityUnit}</li>)}
                </ul>
              )}
            </ReviewSection>
            <ReviewSection title="Lane compliance" onEdit={() => setStep(2)}>
              <ReviewItem label="Requirements" value={form.requirements.join(', ') || 'None'} />
            </ReviewSection>
            <ReviewSection title="Classed documents" onEdit={() => setStep(2)}>
              <ReviewItem label="Files" value={files.length > 0 ? files.map((entry) => `${entry.file.name} (${ATTACHMENT_KIND_LABELS[entry.kind]})`).join(', ') : 'None'} />
            </ReviewSection>
            {hasDetectedContactDetails && (
              <div className="rounded-lg border border-attention/40 bg-attention/5 p-4">
                <p className="text-sm font-semibold text-attention">Contact details were found in the tender notes.</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setStep(1)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-foundation-navy hover:bg-slate-50">
                    Edit details
                  </button>
                  <button type="button" onClick={removeDetectedContactDetails} className="rounded-md border border-attention bg-attention/10 px-3 py-2 text-xs font-semibold text-attention hover:bg-attention/15">
                    Remove contact details
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-attention">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href={buyingTendersPath()} className="text-center text-sm font-semibold text-concrete-grey hover:text-foundation-navy">
            Cancel
          </Link>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            {step > 1 && (
              <Button variant="secondary" size="lg" onClick={goBack}>
                Back
              </Button>
            )}
            {step < STEPS.length ? (
              <Button size="lg" onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button size="lg" loading={submitting} success={success} onClick={handleSubmit}>
                Issue package
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-heading text-base font-bold text-foundation-navy">{title}</h3>
        <button type="button" onClick={onEdit} className="text-xs font-semibold text-steel-blue hover:text-foundation-navy">Edit</button>
      </div>
      {children}
    </section>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-concrete-grey">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foundation-navy">{value || '—'}</p>
    </div>
  );
}
