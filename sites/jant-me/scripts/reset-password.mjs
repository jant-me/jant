import { randomBytes } from "crypto";
import { execSync } from "child_process";

const isRemote = process.argv.includes("--remote");
const flag = isRemote ? "--remote" : "--local";

const token = randomBytes(32).toString("hex");
const expiry = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes
const value = `${token}:${expiry}`;
const timestamp = Math.floor(Date.now() / 1000);

const sql = `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('PASSWORD_RESET_TOKEN', '${value}', ${timestamp})`;

execSync(`npx wrangler d1 execute DB ${flag} --command "${sql}"`, {
  stdio: "inherit",
});

console.log("");
console.log("Password reset token generated (expires in 15 minutes).");
console.log(`Visit: /reset?token=${token}`);
