// Creates (or resets the password of) a platform-admin account — the login
// for the /admin console. Run once on the server:
//
//   STOCKILY_ADMIN_EMAIL=you@ordi-tech.dz STOCKILY_ADMIN_PASSWORD='…' \
//   STOCKILY_ADMIN_NAME='Votre Nom' node scripts/create-admin.mjs
//
// Uses DATABASE_URL (the superuser role). The admin tables are RLS-denied to
// the normal app role, so this must run with the migration/superuser creds.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const email = process.env.STOCKILY_ADMIN_EMAIL;
const password = process.env.STOCKILY_ADMIN_PASSWORD;
const name = process.env.STOCKILY_ADMIN_NAME ?? null;
const username = process.env.STOCKILY_ADMIN_USERNAME ?? null;

if (!email || !password) {
  console.error('Set STOCKILY_ADMIN_EMAIL and STOCKILY_ADMIN_PASSWORD.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Choose a password of at least 10 characters for a platform admin.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await prisma.adminUser.update({ where: { email }, data: { passwordHash, isActive: true, ...(name ? { name } : {}), ...(username ? { username } : {}) } });
    console.log(`Reset password for existing admin ${email}.`);
  } else {
    await prisma.adminUser.create({ data: { email, username, name, passwordHash } });
    console.log(`Created platform admin ${email}.`);
  }
} catch (err) {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
