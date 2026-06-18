import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const wallet = "0x9998d8694E7636F93A52A8330e300a84d67C99D8".toLowerCase();
  console.log(`Resetting TOTP for wallet: ${wallet}`);
  
  const result = await prisma.user.updateMany({
    where: { walletAddress: wallet },
    data: { totpSecret: null }
  });
  
  console.log(`Deleted ${result.count} user records. TOTP has been reset.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
