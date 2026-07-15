import { createFeedInputSchema } from "@/features/feeds/schemas/feed-schema";
import { createFeed, listFeeds } from "@/features/feeds/server/feed-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

export async function GET() {
  try {
    const user = await requireApiUser();
    return apiData({ feeds: await listFeeds(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = createFeedInputSchema.parse(await request.json());
    const feed = await createFeed(user.id, input.url, input.categoryName);
    return apiData({ feed }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
