import { PrismaClient } from '@prisma/client';

function createPrismaClient() {
  const base = new PrismaClient();
  return base.$extends({
    query: {
      tender: {
        async delete({ args, query }) {
          const rows = await base.tenderAttachment.findMany({
            where: { tender: args.where },
            select: { objectKey: true, locationId: true, storedObjectId: true, checksum: true },
          });
          const result = await query(args);
          if (rows.length > 0) {
            const { deleteStoredObjectRefs } = await import('@/server/storage/objectLifecycle');
            await deleteStoredObjectRefs(rows);
          }
          return result;
        },
        async deleteMany({ args, query }) {
          const rows = await base.tenderAttachment.findMany({
            where: { tender: args.where },
            select: { objectKey: true, locationId: true, storedObjectId: true, checksum: true },
          });
          const result = await query(args);
          if (rows.length > 0) {
            const { deleteStoredObjectRefs } = await import('@/server/storage/objectLifecycle');
            await deleteStoredObjectRefs(rows);
          }
          return result;
        },
      },
    },
  });
}

type AppPrisma = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as typeof globalThis & { __prisma?: AppPrisma };

const client = globalForPrisma.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = client;
}

// The query extension is runtime-only. Call sites keep the generated PrismaClient type.
export const prisma = client as unknown as PrismaClient;
