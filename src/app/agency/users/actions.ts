"use server";

import { revalidatePath } from "next/cache";
import { requireHeadSession } from "@/lib/session";
import {
  createAgencyManager,
  createAgencyAgent,
  resetAgencyUserPassword,
  setAgencyUserActive,
  reassignAgentManager,
} from "@/lib/agency-users";

export type CreateUserFormState = {
  error: string | null;
  success: { email: string; temporaryPassword: string } | null;
};

export async function createManagerFormAction(
  _prevState: CreateUserFormState,
  formData: FormData
): Promise<CreateUserFormState> {
  const session = await requireHeadSession();
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");

  const result = await createAgencyManager(session.user.agencyId, name, email);
  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath("/agency/users");
  return { error: null, success: { email: result.email, temporaryPassword: result.temporaryPassword } };
}

export async function createAgentFormAction(
  _prevState: CreateUserFormState,
  formData: FormData
): Promise<CreateUserFormState> {
  const session = await requireHeadSession();
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const managerId = String(formData.get("managerId") ?? "") || null;

  const result = await createAgencyAgent(session.user.agencyId, name, email, managerId);
  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath("/agency/users");
  return { error: null, success: { email: result.email, temporaryPassword: result.temporaryPassword } };
}

export type ResetPasswordFormState = {
  error: string | null;
  success: { temporaryPassword: string } | null;
};

export async function resetPasswordFormAction(
  _prevState: ResetPasswordFormState,
  formData: FormData
): Promise<ResetPasswordFormState> {
  const session = await requireHeadSession();
  const targetUserId = String(formData.get("targetUserId") ?? "");

  const result = await resetAgencyUserPassword(session.user.agencyId, targetUserId);
  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath("/agency/users");
  return { error: null, success: { temporaryPassword: result.temporaryPassword } };
}

export async function toggleActiveAction(formData: FormData) {
  const session = await requireHeadSession();
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const nextActive = String(formData.get("nextActive") ?? "") === "true";

  await setAgencyUserActive(session.user.agencyId, targetUserId, nextActive);
  revalidatePath("/agency/users");
}

export async function reassignManagerAction(formData: FormData) {
  const session = await requireHeadSession();
  const agentUserId = String(formData.get("agentUserId") ?? "");
  const managerId = String(formData.get("managerId") ?? "") || null;

  await reassignAgentManager(session.user.agencyId, agentUserId, managerId);
  revalidatePath("/agency/users");
}
