// Seed script (Section 10, phase 1): 2-3 fake agencies, a few agents/leads.
// Run relative imports only (not the "@/*" alias) since this runs under tsx,
// outside Next.js's own module resolution.
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

const DEV_PASSWORD = "ChangeMe123!";

async function main() {
  // Idempotent: clear out everything this script creates before recreating
  // it, so it's safe to re-run against an existing dev.db. ActivityLog and
  // RecordLock go first since they're the only tables that reference the
  // rest (Lead/Policy/User/Agency) without anything referencing them back.
  await prisma.activityLog.deleteMany({});
  await prisma.recordLock.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.insuranceLine.deleteMany({});
  await prisma.user.deleteMany({ where: { role: { not: "super_admin" } } });
  await prisma.agency.deleteMany({});

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // Super Admin sits outside every agency (Section 2)
  await prisma.user.upsert({
    where: { email: "superadmin@saripda.dev" },
    update: {},
    create: {
      name: "Super Admin",
      email: "superadmin@saripda.dev",
      passwordHash,
      role: "super_admin",
    },
  });

  const agencySpecs = [
    {
      name: "Sunrise Insurance Agency",
      head: "Grace Villanueva",
      managers: ["Ramon Cruz"],
      agents: ["Bea Santos", "Miguel Torres", "Ella Reyes"],
      // Distinct per agency on purpose — makes it obvious in Prisma Studio
      // (or a quick eyeball test) that agencies never share records
      leads: ["Juan Dela Cruz", "Maria Clara", "Antonio Bautista", "Rosario Ibarra"],
    },
    {
      name: "Metro Life & General Insurance",
      head: "Patricia Lim",
      managers: ["Joel Ramos"],
      agents: ["Carlo Mendoza", "Diana Fajardo"],
      leads: ["Ferdinand Marquez", "Corazon Aquino-Reyes", "Benigno Santos", "Imelda Trinidad"],
    },
  ];

  for (const spec of agencySpecs) {
    const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "");

    const agency = await prisma.agency.create({
      data: { name: spec.name },
    });

    await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: spec.head,
        email: `${slugify(spec.head)}@${slug}.dev`,
        passwordHash,
        role: "head",
      },
    });

    const lifeLine = await prisma.insuranceLine.create({
      data: { agencyId: agency.id, name: "Life", category: "life" },
    });
    const autoLine = await prisma.insuranceLine.create({
      data: { agencyId: agency.id, name: "Auto", category: "auto" },
    });

    const termProduct = await prisma.product.create({
      data: {
        agencyId: agency.id,
        lineId: lifeLine.id,
        name: "Term Life",
        lifePolicyType: "term",
      },
    });
    await prisma.product.create({
      data: {
        agencyId: agency.id,
        lineId: lifeLine.id,
        name: "Whole Life Plus",
        lifePolicyType: "non_term_traditional",
      },
    });
    const autoProduct = await prisma.product.create({
      data: {
        agencyId: agency.id,
        lineId: autoLine.id,
        name: "Comprehensive Auto",
      },
    });

    const managerUsers = [];
    for (const managerName of spec.managers) {
      const manager = await prisma.user.create({
        data: {
          agencyId: agency.id,
          name: managerName,
          email: `${slugify(managerName)}@${slug}.dev`,
          passwordHash,
          role: "manager",
        },
      });
      managerUsers.push(manager);
    }

    const agentUsers = [];
    for (const [i, agentName] of spec.agents.entries()) {
      // Sub-team scoping (Section 3): each agent reports to one manager
      const manager = managerUsers[i % managerUsers.length];
      const agent = await prisma.user.create({
        data: {
          agencyId: agency.id,
          name: agentName,
          email: `${slugify(agentName)}@${slug}.dev`,
          passwordHash,
          role: "agent",
          managerId: manager?.id,
        },
      });
      agentUsers.push(agent);
    }

    // A few leads: mostly owned by an agent, one left unassigned to exercise
    // the unassigned-pool queue (Section 5)
    for (const [i, leadName] of spec.leads.entries()) {
      const isUnassigned = i === spec.leads.length - 1;
      await prisma.lead.create({
        data: {
          agencyId: agency.id,
          ownerId: isUnassigned ? null : agentUsers[i % agentUsers.length]?.id,
          name: leadName,
          phone: "0917" + String(1000000 + i * 137).padStart(7, "0"),
          email: `${slugify(leadName)}@example.com`,
          source: i % 2 === 0 ? "Referral" : "Website Inquiry",
          lineId: i % 2 === 0 ? lifeLine.id : autoLine.id,
          productId: i % 2 === 0 ? termProduct.id : autoProduct.id,
          status: ["new", "contacted", "quoted"][i % 3],
        },
      });
    }
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

main()
  .then(async () => {
    console.log("Seed complete. Dev login password for every seeded user:", DEV_PASSWORD);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
