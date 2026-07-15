import { leaseHandleSetInputSchema } from "@/features/appearance/schemas/appearance-schema";
import { renewAppearanceLeases } from "@/features/appearance/server/appearance-db";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const input = leaseHandleSetInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData({ handles: await renewAppearanceLeases(user.id, input.holderToken, input.handles) });
  } catch (error) {
    return apiError(error);
  }
}
