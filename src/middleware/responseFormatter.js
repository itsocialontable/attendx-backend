// src/middleware/responseFormatter.js
//
// Ensures every JSON response carries a consistent `success` (boolean) and
// `message` (string) field, so the frontend can always show a toast purely
// off `response.success` + `response.message` — without us having to touch
// every single res.json(...) call across all route files.
//
// Rules:
//   - Arrays / null / non-object responses are left exactly as-is
//     (so list endpoints like GET /api/users keep returning a raw array —
//     changing that shape would break existing frontend code).
//   - For object responses:
//       - `success` is added only if not already present
//         (true when statusCode < 400, false otherwise).
//       - `message` is added only if not already present:
//           - on errors, falls back to the existing `error` text if any
//           - on success, falls back to a generic "Success." string
//   - Existing keys (token, user, error, id, etc.) are never removed or
//     renamed — this only fills in the two missing keys.

module.exports = function responseFormatter(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    const isError = res.statusCode >= 400;

    const isPlainObject =
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data);

    if (!isPlainObject) {
      return originalJson(data);
    }

    const formatted = { ...data };

    if (typeof formatted.success === 'undefined') {
      formatted.success = !isError;
    }

    if (typeof formatted.message === 'undefined') {
      if (isError) {
        formatted.message = formatted.error || 'Something went wrong.';
      } else {
        formatted.message = 'Success.';
      }
    }

    return originalJson(formatted);
  };

  next();
};
