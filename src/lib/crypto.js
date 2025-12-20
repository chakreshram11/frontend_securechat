// frontend/src/lib/crypto.js
// All helpers for ECDH + AES-GCM (P-256 curve)

const curve = "P-256";
const algoECDH = { name: "ECDH", namedCurve: curve };

// Check if Web Crypto API is available and we're in a secure context
function checkSecureContext() {
  const isSecure = window.isSecureContext === true;
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  if (!window.crypto || !window.crypto.subtle) {
    console.error("❌ Web Crypto API not available");
    console.error("   isSecureContext:", isSecure);
    console.error("   protocol:", protocol);
    console.error("   hostname:", hostname);
    
    if (!isSecure) {
      const errorMsg = 
        "Web Crypto API requires a secure context (HTTPS with valid certificate or localhost). " +
        "Your connection shows HTTPS but is not treated as secure (likely due to invalid/self-signed certificate). " +
        "Please accept the certificate in your browser or use a valid SSL certificate.";
      console.error("   Error:", errorMsg);
      throw new Error(errorMsg);
    }
    throw new Error("Web Crypto API is not supported in this browser");
  }
  
  // Log secure context status (for debugging)
  if (!isSecure) {
    console.warn("⚠️ Warning: isSecureContext is false even though protocol is", protocol);
    console.warn("   This may cause Web Crypto API to fail. Check your SSL certificate.");
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
  checkSecureContext();
  
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
    throw err;
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
  checkSecureContext();
  
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
    console.error("   peerPubB64 length:", peerPubB64?.length);
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
  checkSecureContext();
  
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

    return btoa(String.fromCharCode(...combined));
  } catch (err) {
    console.error("❌ Encryption failed:", err);
    console.error("   error name:", err.name);
    console.error("   error message:", err.message);
    throw err;
  }
}

export async function decryptWithAesKey(aesKey, b64Ciphertext) {
  checkSecureContext();
  
  if (!aesKey || !b64Ciphertext) {
    throw new Error("Missing AES key or ciphertext for decryption");
  }
  
  try {
    const data = Uint8Array.from(atob(b64Ciphertext), (c) => c.charCodeAt(0));
    if (data.length < 12) {
      throw new Error("Ciphertext too short (missing IV)");
    }
    const iv = data.slice(0, 12);
    const ct = data.slice(12);
    
    if (ct.length === 0) {
      throw new Error("Ciphertext is empty");
    }

    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
    return new TextDecoder().decode(plain);
  } catch (err) {
    console.error("❌ Decryption failed:", err);
    console.error("   error name:", err.name);
    console.error("   error message:", err.message);
    console.error("   ciphertext length:", b64Ciphertext?.length);
    throw err;
  }
}
