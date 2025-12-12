const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearPlayers() {
  try {
    const result = await prisma.player.deleteMany();
    console.log(`✅ Deleted ${result.count} players from the database`);
  } catch (error) {
    console.error('❌ Error deleting players:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

clearPlayers();
