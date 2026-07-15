import { prepareAppearancePackageDownload } from "@/features/appearance/server/appearance-transfer-service";
import { requireApiUser } from "@/features/auth/server/session";
import { apiError } from "@/lib/http/api-response";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const download = await prepareAppearancePackageDownload(user.id, request.signal);
    return new Response(download.body, {
      headers: {
        "content-disposition": 'attachment; filename="fulltext-rss-reader-appearance-v1.json"',
        "content-length": download.contentLength.toString(),
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
