import { error } from "@sveltejs/kit";
import { generateReport } from "$lib/server/export-pdf";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, "Unauthorized");

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const toDate = to ? new Date(to) : new Date();

  const pdf = await generateReport(
    locals.user.id,
    locals.user.timezone,
    fromDate,
    toDate,
  );

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="medtracker-report-${fromDate.toISOString().split("T")[0]}.pdf"`,
    },
  });
};
