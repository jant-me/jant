import { randomBytes, scryptSync } from "crypto";
import { execSync } from "child_process";

const isRemote = process.argv.includes("--remote");
const flag = isRemote ? "--remote" : "--local";

const password =
  process.argv.find(
    (a) =>
      !a.startsWith("-") &&
      a !== process.argv[0] &&
      a !== process.argv[1] &&
      a !== "--remote"
  ) || "testtest";

// Match better-auth's scrypt parameters exactly:
// N=16384, r=16, p=1, dkLen=64 (from better-auth/crypto)
const salt = randomBytes(16).toString("hex");
const key = scryptSync(password.normalize("NFKC"), salt, 64, {
  N: 16384,
  r: 16,
  p: 1,
  maxmem: 128 * 16384 * 16 * 2,
});
const hashedPassword = `${salt}:${key.toString("hex")}`;

const sql = `UPDATE account SET password = '${hashedPassword}' WHERE provider_id = 'credential'`;

execSync(`npx wrangler d1 execute DB ${flag} --command "${sql}"`, {
  stdio: "inherit",
});

console.log("");
console.log("Dev password set successfully.");
console.log(`  Email: (the admin user in your seed data)`);
console.log(`  Password: ${password}`);
