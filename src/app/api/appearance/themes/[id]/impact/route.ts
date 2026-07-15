import { z } from "zod";

import {
  appearanceIdSchema,
  declaredSchemeSchema,
  opaqueCanvasSchema,
} from "@/features/appearance/schemas/appearance-schema";
import {
  previewChangeAppearanceThemeScheme,
  previewDeleteAppearanceTheme,
} from "@/features/appearance/server/appearance-mutation-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

const impactQuerySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("delete") }),
  z.strictObject({
    action: z.literal("change-scheme"),
    scheme: declaredSchemeSchema,
    resolvedSystemScheme: declaredSchemeSchema,
    canvas: opaqueCanvasSchema,
  }),
]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const id = appearanceIdSchema.parse((await context.params).id);
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const input = impactQuerySchema.parse(
      action === "change-scheme"
        ? {
            action,
            scheme: url.searchParams.get("scheme"),
            resolvedSystemScheme: url.searchParams.get("resolvedSystemScheme"),
            canvas: url.searchParams.get("canvas"),
          }
        : { action },
    );
    return apiData(
      input.action === "delete"
        ? await previewDeleteAppearanceTheme(user.id, id)
        : await previewChangeAppearanceThemeScheme(
            user.id,
            id,
            input.scheme,
            input.resolvedSystemScheme,
            input.canvas,
          ),
    );
  } catch (error) {
    return apiError(error);
  }
}
