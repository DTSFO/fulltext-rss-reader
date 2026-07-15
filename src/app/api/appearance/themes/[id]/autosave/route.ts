import { appearanceIdSchema, autosaveThemeInputSchema } from "@/features/appearance/schemas/appearance-schema";
import { autosaveAppearanceTheme } from "@/features/appearance/server/appearance-mutation-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const id = appearanceIdSchema.parse((await context.params).id);
    const input = autosaveThemeInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await autosaveAppearanceTheme(user.id, id, input));
  } catch (error) {
    return apiError(error);
  }
}
