import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function simulateReorg() {
  console.log('🔄 Starting Reorg Simulation...');

  try {
    // Fetch all current sync statuses
    const statuses = await prisma.syncStatus.findMany();

    if (statuses.length === 0) {
      console.log('❌ No sync statuses found. Is the indexer running?');
      return;
    }

    // Rewind each chain by 10 blocks to simulate a chain reorganization
    for (const status of statuses) {
      const blocksToRewind = 10;
      const newBlockTarget = Math.max(0, status.lastIndexedBlock - blocksToRewind);

      await prisma.syncStatus.update({
        where: { chainId: status.chainId },
        data: { lastIndexedBlock: newBlockTarget },
      });

      console.log(`✅ Chain ${status.chainId}: Rewound indexer from block ${status.lastIndexedBlock} to ${newBlockTarget}.`);
      console.log(`   -> Next time the indexer polls, it will detect existing events for block ${newBlockTarget + 1}, trigger a reorg warning, delete them, and re-index.`);
    }

    console.log('\n🎯 Simulation triggered successfully!');
    console.log('Check your backend terminal where the indexer is running to see the reorg detection in action.');

  } catch (error) {
    console.error('Error simulating reorg:', error);
  } finally {
    await prisma.$disconnect();
  }
}

simulateReorg();
