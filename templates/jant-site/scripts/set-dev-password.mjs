import { execSync } from "child_process";
import { hashPassword } from "better-auth/crypto";

const isRemote = process.argv.includes("--remote");
const flag = isRemote ? "--remote" : "--local";

const password = process.argv.find(
  (a) =>
    !a.startsWith("-") &&
    a !== process.argv[0] &&
    a !== process.argv[1] &&
    a !== "--remote"
);

if (!password) {
  console.error(
    "Usage: node scripts/set-dev-password.mjs <password> [--remote]"
  );
  process.exit(1);
}

const hashedPassword = await hashPassword(password);

const sql = [
  `UPDATE user SET email = 'demo@jant.me' WHERE role = 'admin'`,
  `UPDATE account SET password = '${hashedPassword}' WHERE provider_id = 'credential'`,
].join("; ");

execSync(`npx wrangler d1 execute DB ${flag} --command "${sql}"`, {
  stdio: "inherit",
});

console.log("");
console.log("Dev credentials set successfully.");
console.log("  Email:    demo@jant.me");
console.log(`  Password: ${password}`);
