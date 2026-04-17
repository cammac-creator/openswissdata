import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/claude-alainmartin/openswissdata/.env", "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);

const client = new S3Client({
  region: "auto",
  endpoint: env.R2_PUBLIC_URL,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const bucket = env.R2_BUCKET;
const key = "_health-check.txt";
const body = `openswissdata R2 connectivity check — ${new Date().toISOString()}`;

try {
  console.log(`→ HEAD bucket "${bucket}" at ${env.R2_PUBLIC_URL}`);
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log("✓ Bucket reachable");

  console.log(`→ PUT ${key}`);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }));
  console.log("✓ Upload OK");

  console.log(`→ GET ${key}`);
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await got.Body.transformToString();
  if (text !== body) throw new Error(`Content mismatch: got "${text}"`);
  console.log("✓ Download OK, content matches");

  console.log(`→ DELETE ${key}`);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log("✓ Delete OK");

  console.log("\n✅ R2 OK");
} catch (e) {
  console.error("\n❌ R2 test failed:", e.name, "-", e.message);
  process.exit(1);
}
