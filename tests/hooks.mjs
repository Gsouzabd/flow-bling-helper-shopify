// Resolve hook para rodar os testes com `node --test`. O código-fonte usa
// imports relativos sem extensão (ex.: "./prisma.server"), resolvidos pelo
// Vite/Remix em runtime — mas o ESM puro do Node exige a extensão. Aqui
// tentamos anexar ".js" quando um specifier relativo não tem extensão.
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\.[mc]?jsx?$/.test(specifier) || /\.json$/.test(specifier);
  if (isRelative && !hasExt) {
    try {
      return await nextResolve(specifier + ".js", context);
    } catch {
      // cai no resolver padrão abaixo
    }
  }
  return nextResolve(specifier, context);
}
