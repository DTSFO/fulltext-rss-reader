import { z } from "zod";

import { listAppearanceLeaseStatus } from "@/features/appearance/server/appearance-db";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

const querySchema = z.strictObject({
  requesterToken: z.string().min(32).max(256).nullable(),
  cursor: z.string().min(1).max(APPEARANCE_TECHNICAL_LIMITS.cursorCharacters).nullable(),
  limit: z.coerce.number().int().min(1).max(APPEARANCE_TECHNICAL_LIMITS.listMaximum).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const input = querySchema.parse({
      // The edit-session token must never appear in a URL or browser history.
      requesterToken: request.headers.get("x-appearance-holder-token"),
      cursor: url.searchParams.get("cursor"),
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return apiData(await listAppearanceLeaseStatus(user.id, input.requesterToken, {
      cursor: input.cursor,
      limit: input.limit,
    }));
  } catch (error) {
    return apiError(error);
  }
}
