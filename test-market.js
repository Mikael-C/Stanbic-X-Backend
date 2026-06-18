const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.market.findFirst({ where: { id: '04788e0e-4ffb-497b-b751-03a3ca09d1df' } })
  .then(console.log)
  .finally(() => prisma.$disconnect());
