const { webcrypto: crypto } = require("crypto");
const nodeCrypto = require("crypto");

async function run() {
  const algoECDH = { name: "ECDH", namedCurve: "P-256" };

  // 1. Generate Alice (WebCrypto)
  const alicePair = await crypto.subtle.generateKey(algoECDH, true, ["deriveKey", "deriveBits"]);
  const alicePrivRaw = await crypto.subtle.exportKey("pkcs8", alicePair.privateKey);
  const alicePubRaw = await crypto.subtle.exportKey("spki", alicePair.publicKey);
  const alicePrivB64 = btoa(String.fromCharCode(...new Uint8Array(alicePrivRaw)));
  const alicePubB64 = btoa(String.fromCharCode(...new Uint8Array(alicePubRaw)));

  // 2. Generate Bob (Node crypto)
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const bobPrivB64 = privateKey.toString("base64");
  const bobPubB64 = publicKey.toString("base64");

  // --- ALICE DERIVES KEY ---
  const bobPeerRaw = Uint8Array.from(atob(bobPubB64), (c) => c.charCodeAt(0)).buffer;
  const bobPeerKey_AliceSide = await crypto.subtle.importKey("spki", bobPeerRaw, algoECDH, true, []);
  
  const alicePrivKeyImported = await crypto.subtle.importKey(
    "pkcs8", Uint8Array.from(atob(alicePrivB64), (c) => c.charCodeAt(0)).buffer,
    algoECDH, true, ["deriveKey", "deriveBits"]
  );

  const aliceDerivedAes = await crypto.subtle.deriveKey(
    { name: "ECDH", public: bobPeerKey_AliceSide },
    alicePrivKeyImported,
    { name: "AES-GCM", length: 256 },
    true, ["encrypt", "decrypt"]
  );

  // Export and Re-import Alice's AES key (like ChatWindow.jsx does)
  const aliceRawAesBytes = await crypto.subtle.exportKey("raw", aliceDerivedAes);
  const aliceRawB64 = btoa(String.fromCharCode(...new Uint8Array(aliceRawAesBytes)));
  
  const aesGcmRawBuf = Uint8Array.from(atob(aliceRawB64), (c) => c.charCodeAt(0)).buffer;
  const aliceImportedAesKey = await crypto.subtle.importKey("raw", aesGcmRawBuf, "AES-GCM", true, ["encrypt", "decrypt"]);


  // --- BOB DERIVES KEY (using WebCrypto too, since Bob logs in browser) ---
  const alicePeerRaw = Uint8Array.from(atob(alicePubB64), (c) => c.charCodeAt(0)).buffer;
  const alicePeerKey_BobSide = await crypto.subtle.importKey("spki", alicePeerRaw, algoECDH, true, []);
  
  const bobPrivKeyImported = await crypto.subtle.importKey(
    "pkcs8", Uint8Array.from(atob(bobPrivB64), (c) => c.charCodeAt(0)).buffer,
    algoECDH, true, ["deriveKey", "deriveBits"]
  );

  const bobDerivedAes = await crypto.subtle.deriveKey(
    { name: "ECDH", public: alicePeerKey_BobSide },
    bobPrivKeyImported,
    { name: "AES-GCM", length: 256 },
    true, ["encrypt", "decrypt"]
  );


  // --- ALICE ENCRYPTS MESSAGE ---
  // Using imported key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode("hi"); // length 2
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aliceImportedAesKey, enc);
  
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);
  const m_ciphertext = btoa(String.fromCharCode(...combined));
  
  console.log("Alice Ciphertext length:", m_ciphertext.length, m_ciphertext);


  // --- BOB DECRYPTS MESSAGE ---
  // Using direct derived key
  try {
    const data = Uint8Array.from(atob(m_ciphertext), (c) => c.charCodeAt(0));
    const decryptIv = data.slice(0, 12);
    const ct = data.slice(12);

    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decryptIv }, bobDerivedAes, ct);
    const result = new TextDecoder().decode(plain);
    console.log("Bob decrypted successfully:", result);
  } catch (err) {
    console.error("Bob decryption failed:", err);
  }
}

run().catch(console.error);
