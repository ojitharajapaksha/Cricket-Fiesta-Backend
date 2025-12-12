import { PrismaClient, UserRole, ApprovalStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create Super Admin
  const superAdminPassword = await bcrypt.hash('SuperAdmin@123', 10);
  
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@cricketfiesta.com' },
    update: {},
    create: {
      email: 'superadmin@cricketfiesta.com',
      password: superAdminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      traineeId: 'SA001',
      role: UserRole.SUPER_ADMIN,
      approvalStatus: ApprovalStatus.APPROVED,
      approvedAt: new Date(),
    },
  });

  console.log('✅ Super Admin created:');
  console.log('   Email: superadmin@cricketfiesta.com');
  console.log('   Password: SuperAdmin@123');
  console.log('   Role: SUPER_ADMIN');
  console.log('\n🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
