export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function parseBody(schema, request, response) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Please check the submitted information.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }))
    });
    return null;
  }
  return parsed.data;
}
