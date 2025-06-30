import { shopifyApi, ApiVersion } from '@shopify/shopify-api';

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(','),
  hostName: process.env.SHOPIFY_APP_URL?.replace(/^https?:\/\//, ''),
  apiVersion: ApiVersion.January25,
});
