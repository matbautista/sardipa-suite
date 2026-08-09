"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdminSession } from "@/lib/session";
import { createAgencyWithHead } from "@/lib/agency-admin";

export type CreateAgencyFormState = {
  error: string | null;
  success: { agencyName: string; headEmail: string; temporaryPassword: string } | null;
};

export async function createAgencyFormAction(
  _prevState: CreateAgencyFormState,
  formData: FormData
): Promise<CreateAgencyFormState> {
  // Defense-in-depth — proxy.ts already keeps non-Super-Admins out of
  // /admin/*, but a server action is a real endpoint of its own and
  // shouldn't rely solely on the page that happens to render its form.
  const session = await requireSuperAdminSession();

  const agencyName = String(formData.get("agencyName") ?? "");
  const headName = String(formData.get("headName") ?? "");
  const headEmail = String(formData.get("headEmail") ?? "");

  const result = await createAgencyWithHead(session.user.id, agencyName, headName, headEmail);
  if (!result.ok) {
    return { error: result.error, success: null };
  }

  // The list of agencies below the form needs to reflect the new one
  // without a full page reload — useActionState doesn't refetch server
  // data on its own.
  revalidatePath("/admin/agencies");

  return {
    error: null,
    success: {
      agencyName: result.agencyName,
      headEmail: result.headEmail,
      temporaryPassword: result.temporaryPassword,
    },
  };
}
