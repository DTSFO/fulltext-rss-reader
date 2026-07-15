import { z } from "zod";

import {
  createThemeInputSchema,
  declaredSchemeSchema,
} from "@/features/appearance/schemas/appearance-schema";
import { createAppearanceTheme } from "@/features/appearance/server/appearance-mutation-service";
import { listAppearanceThemes } from "@/features/appearance/server/appearance-query-service";
import { readBoundedJson } from "@/features/appearance/server/request-body";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";
import { requireSameOriginMutation } from "@/lib/http/same-origin";

const listInputSchema = z.strictObject({
  cursor: z.string().max(APPEARANCE_TECHNICAL_LIMITS.cursorCharacters).nullable(),
  query: z.string().max(APPEARANCE_TECHNICAL_LIMITS.searchCharacters).nullable(),
  scheme: declaredSchemeSchema.nullable(),
  limit: z.coerce.number().int().min(1).max(APPEARANCE_TECHNICAL_LIMITS.listMaximum).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const input = listInputSchema.parse({
      cursor: url.searchParams.get("cursor"),
      query: url.searchParams.get("query"),
      scheme: url.searchParams.get("scheme"),
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return apiData(await listAppearanceThemes(user.id, input));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    requireSameOriginMutation(request);
    const input = createThemeInputSchema.parse(
      await readBoundedJson(request, APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes),
    );
    return apiData(await createAppearanceTheme(user.id, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
