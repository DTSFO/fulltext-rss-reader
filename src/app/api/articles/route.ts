import { articleFilterSchema } from "@/features/articles/schemas/article-schema";
import { listArticles } from "@/features/articles/server/article-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const filter = articleFilterSchema.parse(Object.fromEntries(url.searchParams));
    return apiData(await listArticles(user.id, filter));
  } catch (error) {
    return apiError(error);
  }
}
