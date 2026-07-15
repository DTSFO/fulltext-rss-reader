import { appearanceIdSchema } from "@/features/appearance/schemas/appearance-schema";
import { exportAppearanceTheme } from "@/features/appearance/server/appearance-transfer-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiError } from "@/lib/http/api-response";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const id = appearanceIdSchema.parse((await context.params).id);
    const file = await exportAppearanceTheme(user.id, id);
    return Response.json(file, {
      headers: { "content-disposition": 'attachment; filename="fulltext-rss-reader-theme-v1.json"' },
    });
  } catch (error) {
    return apiError(error);
  }
}
