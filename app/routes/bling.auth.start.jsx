import { redirect } from "@remix-run/node";
import crypto from "crypto";

export async function loader({ request }) {
  const clientId = process.env.BLING_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.BLING_CALLBACK_URL);
  const state = crypto.randomBytes(16).toString("hex");

  const authorizeUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}`;

  return redirect(authorizeUrl);
}
