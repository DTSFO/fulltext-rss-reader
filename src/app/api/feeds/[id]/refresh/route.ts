import { requireApiUser } from "@/features/auth/server/session";
import { refreshFeed } from "@/features/feeds/server/feed-service";
import { apiData, apiError } from "@/lib/http/api-response";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return apiData(await refreshFeed(user.id, id));
  } catch (error) {
    return apiError(error);
  }
}
