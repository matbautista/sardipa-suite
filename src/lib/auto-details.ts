import { getScopedPrisma } from "@/lib/tenant-db";

// Auto insurance requirement checklist (Section 10 phase 11 / Section 11's
// Auto Insurance field list). Only the confirmed subset is modeled —
// Complete Name of Owner, Car Maker, Car Model, Year Released — the
// extended list after it (plate number, chassis number, etc.) is marked
// "proposed... confirm before building" in Section 11 same as Property/
// Health, so it isn't modeled here either.

type ActionResult = { ok: true } | { ok: false; error: string };

export type AutoDetailsInput = {
  completeName: string;
  carMaker: string;
  carModel: string;
  yearReleased: string;
};

async function verifyOwnedPolicy(scoped: ReturnType<typeof getScopedPrisma>, ownerId: string, policyId: string) {
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  return policy && policy.ownerId === ownerId ? policy : null;
}

export async function getAutoDetails(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) return null;

  const [autoOwner, vehicle] = await Promise.all([
    scoped.autoOwner.findUnique({ where: { policyId } }),
    scoped.vehicle.findUnique({ where: { policyId } }),
  ]);
  return { autoOwner, vehicle };
}

export async function saveAutoDetails(
  agencyId: string,
  ownerId: string,
  policyId: string,
  input: AutoDetailsInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  const completeName = input.completeName.trim();
  const carMaker = input.carMaker.trim();
  const carModel = input.carModel.trim();
  const yearReleased = Number(input.yearReleased);
  if (!completeName) {
    return { ok: false, error: "Complete name of owner is required." };
  }
  if (!carMaker || !carModel) {
    return { ok: false, error: "Car maker and model are required." };
  }
  if (!Number.isInteger(yearReleased) || yearReleased < 1900) {
    return { ok: false, error: "Enter a valid year released." };
  }

  await scoped.autoOwner.upsert({
    where: { policyId },
    update: { completeName },
    create: { policyId, completeName },
  });
  await scoped.vehicle.upsert({
    where: { policyId },
    update: { carMaker, carModel, yearReleased },
    create: { policyId, carMaker, carModel, yearReleased },
  });

  return { ok: true };
}

export async function hasMinimumAutoInfo(agencyId: string, policyId: string): Promise<boolean> {
  const scoped = getScopedPrisma(agencyId);
  const [autoOwner, vehicle] = await Promise.all([
    scoped.autoOwner.findUnique({ where: { policyId } }),
    scoped.vehicle.findUnique({ where: { policyId } }),
  ]);
  return !!autoOwner && !!vehicle;
}
