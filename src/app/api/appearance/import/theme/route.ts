import { importAppearanceTheme } from "@/features/appearance/server/appearance-transfer-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const input = await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes);
    return apiData(await importAppearanceTheme(user.id, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
