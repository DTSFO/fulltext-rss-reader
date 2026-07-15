import { appearanceIdSchema, restoreConfirmInputSchema } from "@/features/appearance/schemas/appearance-schema";
import { confirmAppearanceRestore } from "@/features/appearance/server/appearance-transfer-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const planId = appearanceIdSchema.parse((await context.params).planId);
    const input = restoreConfirmInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await confirmAppearanceRestore(user.id, planId, input));
  } catch (error) {
    return apiError(error);
  }
}
