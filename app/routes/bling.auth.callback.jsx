import { saveBlingToken, getBlingToken } from "../../db/blingToken.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Código de autorização não encontrado", { status: 400 });
  }
  console.log('code', code)

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenResponse = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${basicAuth}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.BLING_CALLBACK_URL,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("Erro ao obter token do Bling:", tokenData);
    return new Response("Erro ao obter token do Bling", { status: 500 });
  }else{
    console.log('tudo ok com o token')
  }

  // Suponha que você tenha o shop no contexto ou sessão
  const shop = "flowdigital.myshopify.com";

  await saveBlingToken({
    shop,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
  });


  return null;

}
