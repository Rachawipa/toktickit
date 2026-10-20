// Production bootstrap: creates the categories and the first administrator
// without running the demo seed. Idempotent: an existing user is never modified.
// Needs ADMIN_EMAIL and ADMIN_PASSWORD (from Secret Manager in Cloud Run).
import { getPrisma } from "../src/prisma.js";
import { hashPassword } from "../src/auth.js";

async function main() {
  const prisma = getPrisma();

  for (const name of ["Account and Access", "Hardware", "Software", "Network"]) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("ADMIN_EMAIL / ADMIN_PASSWORD not set: skipping admin bootstrap.");
    return;
  }
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin already exists: leaving it unchanged.");
    return;
  }
  await prisma.user.create({
    data: {
      name: "Administrator",
      email,
      role: "Administrator",
      isActive: true,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
    },
  });
  console.log(`Created initial administrator ${email} (must change password at first login).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
