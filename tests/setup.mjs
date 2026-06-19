// Registra o resolve hook (tests/hooks.mjs) antes de carregar os testes.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
