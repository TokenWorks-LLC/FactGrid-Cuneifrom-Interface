import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENVELOPE_VERSION = "v1";

function encryptionKey(secret: string, purpose: string): Buffer {
  return createHash("sha256")
    .update("FactGrid Cuneiform Interface\0", "utf8")
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

export function randomOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function sealString(plaintext: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(`${ENVELOPE_VERSION}\0${purpose}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function openString(envelope: string, secret: string, purpose: string): string {
  const [version, ivValue, ciphertextValue, tagValue, extra] = envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !ivValue ||
    !ciphertextValue ||
    !tagValue ||
    extra !== undefined
  ) {
    throw new Error("Invalid encrypted value");
  }

  try {
    const iv = Buffer.from(ivValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted value");

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret, purpose), iv);
    decipher.setAAD(Buffer.from(`${ENVELOPE_VERSION}\0${purpose}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Invalid encrypted value");
  }
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
