import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  const envCheck = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? "SET" : "MISSING",
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL ? "SET" : "MISSING",
    GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY: process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY ? "SET" : "MISSING",
    GOOGLE_SHEETS_SPREADSHEET_ID: process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? "SET" : "MISSING",
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ? "SET" : "MISSING",
  };

  return Response.json(envCheck);
};