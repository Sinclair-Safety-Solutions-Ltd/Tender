import { z } from 'zod';
import { CATEGORIES, isSpecifiedItemService, isValidTenderQuantity, URGENCY_OPTIONS, REQUIREMENT_OPTIONS } from '@/lib/categories';
import type { CategoryCatalog } from '@/lib/catalog';
import { locationHasPostcode } from '@/lib/geography';
import { ATTACHMENT_KINDS } from '@/lib/attachment-kinds';
import { MAX_TENDER_ATTACHMENT_TOTAL_BYTES, verifyTenderAttachment } from '@/lib/attachment-utils';
import { MATERIAL_PACKS, WASTE_CONTAINERS, specIssues, type TenderLineSpec } from '@/lib/tender-spec';

const tenderAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().nonnegative(),
  dataBase64: z.string().min(1).max(Math.ceil((10 * 1024 * 1024) * 4 / 3) + 4).optional(),
  uploadId: z.string().trim().min(1).max(128).optional(),
  kind: z.enum(ATTACHMENT_KINDS).optional().default('OTHER'),
}).transform((attachment, context) => {
  if (attachment.uploadId && !attachment.dataBase64) return attachment;
  if (!attachment.dataBase64) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Attachment upload is required', path: ['uploadId'] });
    return z.NEVER;
  }
  try {
    return { ...attachment, ...verifyTenderAttachment({ ...attachment, dataBase64: attachment.dataBase64 }) };
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Attachment is invalid',
      path: ['dataBase64'],
    });
    return z.NEVER;
  }
});

export function createTenderSchemaForCatalog(catalog: CategoryCatalog = CATEGORIES) {
  const serviceSchema = z.string().trim().refine((value) => Object.keys(catalog).some((service) => service.toLowerCase() === value.toLowerCase()), 'Select a valid service');
  const lineSpecSchema = z.object({
    ewcCode: z.string().trim().max(12).optional(),
    hazardous: z.boolean().optional(),
    container: z.enum(WASTE_CONTAINERS).optional(),
    dimension: z.string().trim().max(80).optional(),
    materialClass: z.string().trim().max(80).optional(),
    standard: z.string().trim().max(120).optional(),
    pack: z.enum(MATERIAL_PACKS).optional(),
    plantClass: z.string().trim().max(80).optional(),
    capacity: z.string().trim().max(80).optional(),
    period: z.string().trim().max(80).optional(),
  }).optional();
  const tenderItemSchema = z.object({
    category: serviceSchema,
    subcategory: z.string().trim().min(1),
    item: z.string().trim().min(1).optional(),
    quantity: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).optional().default(''),
    spec: lineSpecSchema,
  });
  const hasValidSubcategory = (service: string, category: string, item?: string) => {
    const serviceName = Object.keys(catalog).find((value) => value.toLowerCase() === service.toLowerCase());
    const categories = serviceName ? catalog[serviceName] : undefined;
    if (!categories) return false;
    if (item !== undefined) return categories[category]?.includes(item) ?? false;
    return Boolean(categories[category]);
  };

  return z.object({
    projectName: z.string().trim().min(3).max(120),
    category: serviceSchema,
    subcategory: z.string().trim().min(1),
    item: z.string().trim().min(1).optional(),
    location: z.string().trim().min(2).max(120),
    quantity: z.string().trim().min(1).max(120),
    itemDescription: z.string().trim().max(4000).optional().default(''),
    spec: lineSpecSchema,
    urgency: z.enum(URGENCY_OPTIONS).optional().default('standard'),
    closingDate: z.coerce.date(),
    supplyDate: z.coerce.date().optional(),
    requirements: z.array(z.enum(REQUIREMENT_OPTIONS)).optional().default([]),
    description: z.string().trim().max(4000).optional().default(''),
    items: z.array(tenderItemSchema).max(50).optional(),
    attachments: z.array(tenderAttachmentSchema).max(10).optional().default([]),
    allowDirectContact: z.boolean().optional(),
    allowProfessionalInterest: z.boolean().optional(),
  })
    .refine((value) => value.item ? hasValidSubcategory(value.category, value.subcategory, value.item) : hasValidSubcategory(value.category, value.subcategory), {
      message: 'Subcategory does not belong to the selected category',
      path: ['subcategory'],
    })
    .refine((value) => locationHasPostcode(value.location), {
      message: 'Enter a valid UK postcode so delivery fees and matching companies can be determined',
      path: ['location'],
    })
    .refine((value) => value.closingDate.getTime() > Date.now(), {
      message: 'Closing date must be in the future',
      path: ['closingDate'],
    })
    .refine((value) => !value.supplyDate || value.supplyDate.getTime() > Date.now(), {
      message: 'Supply date must be in the future',
      path: ['supplyDate'],
    })
    .superRefine((value, context) => {
      const requireSpecifiedItem = (service: string, item: string | undefined, path: Array<string | number>) => {
        if (isSpecifiedItemService(service) && !item?.trim()) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a specified item for this package', path });
        }
      };
      const requireNumericQuantity = (service: string, quantity: string, path: Array<string | number>) => {
        if (!isValidTenderQuantity(service, quantity)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a numeric quantity and a unit from the catalogue', path });
        }
      };
      requireSpecifiedItem(value.category, value.item, ['item']);
      requireNumericQuantity(value.category, value.quantity, ['quantity']);
      specIssues(value.category, value.spec as TenderLineSpec | undefined, value.quantity).forEach((message) => {
        context.addIssue({ code: z.ZodIssueCode.custom, message, path: ['spec'] });
      });
      value.items?.forEach((item, index) => {
        if (!hasValidSubcategory(item.category, item.subcategory, item.item)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Subcategory does not belong to the selected category', path: ['items', index, 'subcategory'] });
        }
        requireSpecifiedItem(item.category, item.item, ['items', index, 'item']);
        requireNumericQuantity(item.category, item.quantity, ['items', index, 'quantity']);
        specIssues(item.category, item.spec as TenderLineSpec | undefined, item.quantity).forEach((message) => {
          context.addIssue({ code: z.ZodIssueCode.custom, message, path: ['items', index, 'spec'] });
        });
      });
      const attachmentBytes = value.attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);
      if (attachmentBytes > MAX_TENDER_ATTACHMENT_TOTAL_BYTES) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tender attachments exceed the 25 MiB total limit', path: ['attachments'] });
      }
    });
}

export const createTenderSchema = createTenderSchemaForCatalog();
export type CreateTenderInput = z.infer<typeof createTenderSchema>;

export const updateTenderSchema = z.object({
  location: z.string().trim().min(2).max(120).refine(locationHasPostcode, 'Enter a valid UK postcode so delivery fees and matching companies can be determined'),
  urgency: z.enum(URGENCY_OPTIONS),
  closingDate: z.coerce.date().refine((value) => value.getTime() > Date.now(), 'Closing date must be in the future'),
  supplyDate: z.coerce.date().optional().refine((value) => !value || value.getTime() > Date.now(), 'Supply date must be in the future'),
  requirements: z.array(z.enum(REQUIREMENT_OPTIONS)).optional().default([]),
  description: z.string().trim().max(4000),
  items: z.array(z.object({
    id: z.string().cuid(),
    quantity: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000),
  })).min(1).max(50),
});

export type UpdateTenderInput = z.infer<typeof updateTenderSchema>;
