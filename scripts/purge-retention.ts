import { prisma } from '../src/server/data/prisma';
import { purgeExpiredUnpurchasedQuotes } from '../src/server/domain/retentionService';

const deleted = await purgeExpiredUnpurchasedQuotes();
console.log(`Retention purge deleted ${deleted.quotesDeleted} quote(s), ${deleted.documentsDeleted} document(s), ${deleted.temporaryObjectsDeleted} abandoned upload(s), ${deleted.emailVerificationTokensDeleted} expired verification token(s), ${deleted.passwordResetTokensDeleted} expired reset token(s), and ${deleted.pageViewsDeleted} page view(s).`);
await prisma.$disconnect();
