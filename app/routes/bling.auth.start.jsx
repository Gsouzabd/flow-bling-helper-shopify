import { redirect } from "@remix-run/node";

export async function loader({ request }) {
  const clientId = process.env.BLING_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.BLING_CALLBACK_URL);

  const authorizeUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`;

  return redirect(authorizeUrl);
}
