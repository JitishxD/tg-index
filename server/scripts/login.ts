// Run once interactively:  docker compose run --rm server bun run login
// Use a USER account to read the full history of existing channels.
import { tg } from "../src/telegram/client";

const self = await tg.start({
  phone: () => tg.input("Phone > "),
  code: () => tg.input("Code > "),
  password: () => tg.input("2FA password > "),
});
console.log(`Logged in as ${self.displayName}. Session saved to data/session.`);
await tg.destroy();
