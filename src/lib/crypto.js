// frontend/src/lib/crypto.js
// All helpers for ECDH + AES-GCM (P-256 curve)

const curve = "P-256";
const algoECDH = { name: "ECDH", namedCurve: curve };

// --------------------
// 🔹 ECDH key handling
// --------------------
export async function generateECDHKeyPair() {
  const pair = await crypto.subtle.generateKey(algoECDH, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const privRaw = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pubRaw = await crypto.subtle.exportKey("spki", pair.publicKey);

  const privB64 = btoa(String.fromCharCode(...new Uint8Array(privRaw)));
  const pubB64 = btoa(String.fromCharCode(...new Uint8Array(pubRaw)));

  localStorage.setItem("ecdhPrivateKey", privB64);
  localStorage.setItem("ecdhPublicKey", pubB64);

  return { privB64, pubB64 };
}

export function getLocalPublicKey() {
  return localStorage.getItem("ecdhPublicKey");
}

export async function loadLocalPrivateKey() {
  const b64 = localStorage.getItem("ecdhPrivateKey");
  if (!b64) {
    console.log("❌ No private key found in localStorage");
    return null;
  }
  
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const key = await crypto.subtle.importKey("pkcs8", raw, algoECDH, true, [
      "deriveKey",
      "deriveBits",
    ]);
    console.log("✅ Private key imported successfully");
    return key;
  } catch (err) {
    console.error("❌ Failed to import private key:", err);
    console.error("Error details:", err.message);
    // Don't remove the key automatically - let the user try to re-login
    return null;
  }
}

// --------------------
// 🔹 AES key derivation (ECDH shared secret)
// --------------------
export async function deriveSharedAESKey(myPriv, peerPubB64) {
  const peerRaw = Uint8Array.from(atob(peerPubB64), (c) => c.charCodeAt(0)).buffer;
  const peerKey = await crypto.subtle.importKey(
    "spki",
    peerRaw,
    algoECDH,
    true,
    []
  );

  const aesKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: peerKey },
    myPriv,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const raw = await crypto.subtle.exportKey("raw", aesKey);
  const rawKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(raw)));

  return { aesKey, rawKeyBase64 };
}

// --------------------
// 🔹 AES key caching
// --------------------
export function saveAesKeyForUser(userId, keyB64) {
  const all = JSON.parse(localStorage.getItem("aesKeys") || "{}");
  all[userId] = keyB64;
  localStorage.setItem("aesKeys", JSON.stringify(all));
}

export function loadAesKeyForUser(userId) {
  const all = JSON.parse(localStorage.getItem("aesKeys") || "{}");
  return all[userId];
}

export async function importAesKeyFromRawBase64(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

// --------------------
// 🔹 AES-GCM encrypt/decrypt
// --------------------
export async function encryptWithAesKey(aesKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc);

  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptWithAesKey(aesKey, b64Ciphertext) {
  const data = Uint8Array.from(atob(b64Ciphertext), (c) => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);

  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  return new TextDecoder().decode(plain);
}
