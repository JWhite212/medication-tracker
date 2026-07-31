import { error } from "@sveltejs/kit";

// Parse a JSON request body, turning malformed input into a clean 400
// instead of letting the SyntaxError escape as a 500.
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw error(400, "Invalid JSON body");
  }
}
