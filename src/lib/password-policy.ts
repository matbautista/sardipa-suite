import { randomInt } from "node:crypto";

// Login security baseline (Section 5 of the plan) — shared by every place a
// password gets set: first-run setup, and any account created with a
// temporary password (Agency Head, and later Managers/Agents).
export const MIN_PASSWORD_LENGTH = 10;

// Avoids visually ambiguous characters (0/O, 1/l/I) since this is meant to
// be read off a screen and retyped by someone else (Section 5: "shown once
// on screen... to relay to that person directly").
const TEMP_PASSWORD_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 14;

/** Cryptographically random, comfortably past MIN_PASSWORD_LENGTH. */
export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += TEMP_PASSWORD_CHARSET[randomInt(TEMP_PASSWORD_CHARSET.length)];
  }
  return password;
}
