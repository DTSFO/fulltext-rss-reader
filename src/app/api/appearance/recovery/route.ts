import { recoveryInputSchema } from "@/features/appearance/schemas/appearance-schema";
import { safetyRecoverAppearance } from "@/features/appearance/server/appearance-mutation-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const input = recoveryInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await safetyRecoverAppearance(user.id, input));
  } catch (error) {
    return apiError(error);
  }
}
