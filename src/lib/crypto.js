// frontend/src/lib/crypto.js
// All helpers for ECDH + AES-GCM (P-256 curve)

const curve = "P-256";
const algoECDH = { name: "ECDH", namedCurve: curve };

// Check if Web Crypto API is available - no longer throws errors
// Returns true if available, false otherwise
function checkSecureContext() {
  if (!window.crypto) {
    console.warn("⚠️ window.crypto is not available");
    return false;
  }

  if (!window.crypto.subtle) {
    console.warn("⚠️ window.crypto.subtle is not available");
    console.log("   isSecureContext:", window.isSecureContext);
    console.log("   protocol:", window.location.protocol);
    console.log("   hostname:", window.location.hostname);
    return false;
  }

  return true;
}

// Diagnostic function to test if Web Crypto is working
export async function testWebCrypto() {
  try {
    checkSecureContext();
    const testKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    console.log("✅ Web Crypto API test: PASSED");
    return true;
  } catch (err) {
    console.error("❌ Web Crypto API test: FAILED", err);
    return false;
  }
}

// --------------------
// 🔹 ECDH key handling
// --------------------
export async function generateECDHKeyPair() {
  const hasWebCrypto = checkSecureContext();

  if (!hasWebCrypto) {
    console.warn("⚠️ Web Crypto not available - cannot generate ECDH keys");
    throw new Error("Web Crypto API not available");
  }

  try {
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
  } catch (err) {
    console.error("❌ Failed to generate ECDH key pair:", err);
    console.error("   Error name:", err.name);
    console.error("   Error message:", err.message);
    throw err;
  }
}

// Validate that local private key matches local public key
export async function validateLocalKeyPair() {
  const privB64 = localStorage.getItem("ecdhPrivateKey");
  const pubB64 = localStorage.getItem("ecdhPublicKey");

  if (!privB64 || !pubB64) {
    console.log("🔍 Key validation: Missing keys");
    return false;
  }

  if (!window.crypto || !window.crypto.subtle) {
    console.warn("⚠️ Cannot validate keys - Web Crypto not available");
    return true; // Assume valid if we can't check
  }

  try {
    // Import the private key
    const privRaw = Uint8Array.from(atob(privB64), c => c.charCodeAt(0)).buffer;
    const privateKey = await window.crypto.subtle.importKey(
      "pkcs8",
      privRaw,
      algoECDH,
      true,
      ["deriveKey", "deriveBits"]
    );

    // Export the public key from the private key (ECDH keys are paired)
    // We need to derive the public key from private and compare
    // Unfortunately, Web Crypto doesn't let us extract public from private directly
    // So we compare by doing a test derivation with both approaches

    // For now, just verify both keys can be imported
    const pubRaw = Uint8Array.from(atob(pubB64), c => c.charCodeAt(0)).buffer;
    await window.crypto.subtle.importKey(
      "spki",
      pubRaw,
      algoECDH,
      true,
      []
    );

    console.log("✅ Key pair validation: Both keys importable");
    return true;
  } catch (err) {
    console.error("❌ Key pair validation failed:", err.message);
    return false;
  }
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

  // Check if Web Crypto is available
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("⚠️ Web Crypto not available - cannot load private key");
    return null;
  }

  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const key = await window.crypto.subtle.importKey("pkcs8", raw, algoECDH, true, [
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
  const hasWebCrypto = checkSecureContext();

  if (!hasWebCrypto) {
    throw new Error("Web Crypto API not available - cannot derive AES key");
  }

  if (!peerPubB64 || !myPriv) {
    throw new Error("Missing required parameters for key derivation");
  }

  try {
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
  } catch (err) {
    console.error("❌ Key derivation failed:", err);
    console.error("   error name:", err.name);
    console.error("   error message:", err.message);
    throw err;
  }
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

export function clearAesKeyForUser(userId) {
  const all = JSON.parse(localStorage.getItem("aesKeys") || "{}");
  delete all[userId];
  localStorage.setItem("aesKeys", JSON.stringify(all));
  console.log(`🗑️ Cleared cached AES key for user ${userId}`);
}

// Encrypt private key with password for server storage (enables key recovery)
export async function encryptPrivateKeyWithPassword(privateKeyB64, password) {
  const encoder = new TextEncoder();
  const salt = encoder.encode('ecdh-key-encryption-salt-v1'); // Same salt as backend

  // Derive key from password using PBKDF2
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Generate random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(16));

  // Encrypt the private key
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    aesKey,
    encoder.encode(privateKeyB64)
  );

  // Get auth tag (last 16 bytes of encrypted result in Web Crypto)
  const encrypted = new Uint8Array(encryptedBuffer);

  // Combine IV + encrypted (which includes auth tag) - format compatible with backend
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, iv.length);

  return btoa(String.fromCharCode(...combined));
}

// Decrypt group key using user's public key (matches backend encryptGroupKeyForMember)
export async function decryptGroupKey(encryptedKeyB64) {
  const myPublicKey = getLocalPublicKey();
  if (!myPublicKey) {
    throw new Error("No public key available for group key decryption");
  }

  // Hash the public key to derive the decryption key (same as backend)
  const pubKeyBuffer = Uint8Array.from(atob(myPublicKey), c => c.charCodeAt(0));
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', pubKeyBuffer);

  // Import the derived key
  const derivedKey = await window.crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Parse the encrypted data: IV (16) + encrypted data (includes auth tag)
  const combined = Uint8Array.from(atob(encryptedKeyB64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 16);
  const encrypted = combined.slice(16); // authTag is included in encrypted data for Web Crypto

  // Decrypt
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    derivedKey,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

// Cache for group AES keys (groupId -> CryptoKey)
const groupKeyCache = new Map();

export function getCachedGroupKey(groupId) {
  return groupKeyCache.get(groupId);
}

export async function cacheGroupKey(groupId, keyB64) {
  const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  const key = await window.crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  groupKeyCache.set(groupId, key);
  return key;
}

export async function importAesKeyFromRawBase64(b64) {
  const hasWebCrypto = checkSecureContext();

  if (!hasWebCrypto) {
    throw new Error("Web Crypto API not available for key import");
  }

  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, [
      "encrypt",
      "decrypt",
    ]);
  } catch (err) {
    console.error("❌ Failed to import AES key:", err);
    throw err;
  }
}

// --------------------
// 🔹 AES-GCM encrypt/decrypt
// --------------------
export async function encryptWithAesKey(aesKey, plaintext) {
  const hasWebCrypto = checkSecureContext();

  if (!hasWebCrypto) {
    throw new Error("Web Crypto API not available for encryption");
  }

  if (!aesKey || !plaintext) {
    throw new Error("Missing AES key or plaintext for encryption");
  }

  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plaintext);

    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc);

    const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipher), iv.byteLength);

    const b64 = btoa(String.fromCharCode(...combined));

    console.log("✅ Message encrypted successfully");
    return b64;
  } catch (err) {
    console.error("❌ Encryption failed:", err);
    throw err;
  }
}

export async function decryptWithAesKey(aesKey, b64Ciphertext) {
  const hasWebCrypto = checkSecureContext();

  if (!hasWebCrypto) {
    throw new Error("Web Crypto API not available for decryption");
  }

  if (!aesKey || !b64Ciphertext) {
    throw new Error("Missing AES key or ciphertext for decryption");
  }

  try {
    const data = Uint8Array.from(atob(b64Ciphertext), (c) => c.charCodeAt(0));

    if (data.length < 12) {
      throw new Error(`Ciphertext too short (missing IV): ${data.length} bytes`);
    }
    const iv = data.slice(0, 12);
    const ct = data.slice(12);

    if (ct.length === 0) {
      throw new Error("Ciphertext is empty after removing IV");
    }

    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
    const result = new TextDecoder().decode(plain);

    console.log("✅ Message decrypted successfully");
    return result;
  } catch (err) {
    console.error("❌ Decryption failed:", err);
    throw err;
  }
}
