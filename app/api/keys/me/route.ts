import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireApiKey, API_KEY_HEADER } from "@/lib/api-key";

/**
 * GET /api/keys/me  —  describe the key you just presented.
 *
 * Every integration needs a "is my key still good?" probe, and the honest
 * answer has to say WHICH key it is and WHAT it may do — a 200 here is the
 * difference between "authenticated" and "authenticated, but scoped to one
 * application", and finding that out from a 403 later is a bad debugging
 * experience.
 *
 * Returns no secret material: the id, the name, the scope and the pinned
 * application id are enough to debug a wiring problem and nothing more.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const key = await requireApiKey(request);
    return apiSuccess({
      key: {
        id: key.id,
        name: key.name,
        scope: key.scope,
        // null for a platform key. The PUBLIC `fa_...` id is deliberately not
        // echoed: the response is often logged, and the ObjectId is the value
        // every path parameter on this API actually takes.
        applicationId: key.applicationId,
        header: API_KEY_HEADER,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
