const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.market.findMany({
  select: { id: true, question: true, endTime: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
  take: 5
})
  .then(console.log)
  .finally(() => prisma.$disconnect());
