import { HttpRequestError, InvalidUrlError, TimeoutError } from "../../core/index.js";
import { ValidationError } from "../errors.js";

export function notFoundHandler(_req, res) {
  res.status(404).json({
    error: "Not Found"
  });
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof ValidationError || error instanceof InvalidUrlError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof TimeoutError) {
    res.status(504).json({ error: error.message });
    return;
  }

  if (error instanceof HttpRequestError) {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 502;
    res.status(status).json({ error: error.message });
    return;
  }

  res.status(500).json({
    error: error?.message ?? "Internal Server Error"
  });
}

