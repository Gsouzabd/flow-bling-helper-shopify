import { prisma } from "./prisma.server";

export async function saveBlingToken({ shop, accessToken, refreshToken, expiresAt }) {
  return prisma.blingToken.upsert({
    where: { shop },
    update: { accessToken, refreshToken, expiresAt },
    create: { shop, accessToken, refreshToken, expiresAt },
  });
}

export async function getBlingToken(shop) {
  return prisma.blingToken.findUnique({
    where: { shop },
  });
}

export async function refreshBlingToken(shop) {
  const tokenData = await getBlingToken(shop);
  if (!tokenData) throw new Error("Token não encontrado para a loja");

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokenData.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error("Falha ao renovar token Bling");
  }

  const newToken = await response.json();

  await prisma.blingToken.update({
    where: { shop },
    data: {
      accessToken: newToken.access_token,
      refreshToken: newToken.refresh_token,
      expiresAt: new Date(Date.now() + newToken.expires_in * 1000),
    },
  });

  return newToken.access_token;
}

export async function getValidBlingToken(shop) {
  const tokenData = await getBlingToken(shop);
  if (!tokenData) throw new Error("Token não encontrado para a loja");

  const isExpired = Date.now() > new Date(tokenData.expiresAt).getTime() - 60000; // 1 min antes de expirar

  if (isExpired) {
    return refreshBlingToken(shop);
  }

  return tokenData.accessToken;
}
