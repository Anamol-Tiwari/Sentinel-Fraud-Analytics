import { z } from "zod";
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const httpError = (status, message) => Object.assign(new Error(message), { status });
export const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) throw httpError(400, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
};
export { z };
export function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\ufeff" + csv);
}
