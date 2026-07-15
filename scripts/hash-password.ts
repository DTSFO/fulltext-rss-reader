import { hash } from "@node-rs/argon2";

async function main() {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const password = Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");

  if (password.length < 8) {
    throw new Error("Password input must contain at least 8 characters.");
  }

  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  process.stdout.write(`${passwordHash}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Password hashing failed."}\n`);
  process.exitCode = 1;
});
