import { createCategoryInputSchema } from "@/features/categories/schemas/category-schema";
import { createCategory, listCategories } from "@/features/categories/server/category-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

export async function GET() {
  try {
    const user = await requireApiUser();
    return apiData({ categories: await listCategories(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = createCategoryInputSchema.parse(await request.json());
    return apiData({ category: await createCategory(user.id, input.name) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
