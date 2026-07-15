import { updateArticleStateSchema } from "@/features/articles/schemas/article-schema";
import { getArticle, updateArticleState } from "@/features/articles/server/article-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return apiData({ article: await getArticle(user.id, id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = updateArticleStateSchema.parse(await request.json());
    return apiData({ state: await updateArticleState(user.id, id, input) });
  } catch (error) {
    return apiError(error);
  }
}
