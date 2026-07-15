import {
  appearanceIdSchema,
  deleteThemeInputSchema,
  themeMutationInputSchema,
} from "@/features/appearance/schemas/appearance-schema";
import {
  deleteAppearanceTheme,
  mutateAppearanceTheme,
} from "@/features/appearance/server/appearance-mutation-service";
import { getAppearanceTheme } from "@/features/appearance/server/appearance-query-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const id = appearanceIdSchema.parse((await context.params).id);
    return apiData(await getAppearanceTheme(user.id, id));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const id = appearanceIdSchema.parse((await context.params).id);
    const input = themeMutationInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await mutateAppearanceTheme(user.id, id, input));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const id = appearanceIdSchema.parse((await context.params).id);
    const input = deleteThemeInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await deleteAppearanceTheme(user.id, id, input));
  } catch (error) {
    return apiError(error);
  }
}
