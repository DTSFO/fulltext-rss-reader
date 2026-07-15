import { configMutationInputSchema } from "@/features/appearance/schemas/appearance-schema";
import { mutateAppearanceConfig } from "@/features/appearance/server/appearance-mutation-service";
import { getAppearanceSnapshot } from "@/features/appearance/server/appearance-query-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

export async function GET() {
  try {
    const user = await requireApiUser();
    return apiData({ snapshot: await getAppearanceSnapshot(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const input = configMutationInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await mutateAppearanceConfig(user.id, input));
  } catch (error) {
    return apiError(error);
  }
}
