const { webcrypto: crypto } = require("crypto");
const nodeCrypto = require("crypto");

async function test() {
  const algoECDH = { name: "ECDH", namedCurve: "P-256" };

  // 1. Generate Alice (WebCrypto)
  const alicePair = await crypto.subtle.generateKey(algoECDH, true, ["deriveKey", "deriveBits"]);
  const alicePrivRaw = await crypto.subtle.exportKey("pkcs8", alicePair.privateKey);
  const alicePubRaw = await crypto.subtle.exportKey("spki", alicePair.publicKey);
  const alicePrivB64 = btoa(String.fromCharCode(...new Uint8Array(alicePrivRaw)));
  const alicePubB64 = btoa(String.fromCharCode(...new Uint8Array(alicePubRaw)));
  console.log("Alice Priv B64 Length:", alicePrivB64.length);

  // 2. Generate Bob (Node crypto)
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const bobPrivB64 = privateKey.toString("base64");
  const bobPubB64 = publicKey.toString("base64");
  
  // Alice derives Shared
  const alicePeerRaw = Uint8Array.from(atob(bobPubB64), (c) => c.charCodeAt(0)).buffer;
  const alicePeerKey = await crypto.subtle.importKey("spki", alicePeerRaw, algoECDH, true, []);
  const alicePrivKeyImported = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(alicePrivB64), (c) => c.charCodeAt(0)).buffer,
    algoECDH,
    true,
    ["deriveKey", "deriveBits"]
  );
  const aliceDerivedAes = await crypto.subtle.deriveKey(
    { name: "ECDH", public: alicePeerKey },
    alicePrivKeyImported,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const aliceRaw = await crypto.subtle.exportKey("raw", aliceDerivedAes);
  const aliceDerivedAesB64 = btoa(String.fromCharCode(...new Uint8Array(aliceRaw)));

  // Bob derives Shared using WebCrypto
  const bobPeerRaw = Uint8Array.from(atob(alicePubB64), (c) => c.charCodeAt(0)).buffer;
  const bobPeerKey = await crypto.subtle.importKey("spki", bobPeerRaw, algoECDH, true, []);
  const bobPrivKeyImported = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(bobPrivB64), (c) => c.charCodeAt(0)).buffer,
    algoECDH,
    true,
    ["deriveKey", "deriveBits"]
  );
  const bobDerivedAes = await crypto.subtle.deriveKey(
    { name: "ECDH", public: bobPeerKey },
    bobPrivKeyImported,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const bobRaw = await crypto.subtle.exportKey("raw", bobDerivedAes);
  const bobDerivedAesB64 = btoa(String.fromCharCode(...new Uint8Array(bobRaw)));
  
  console.log("Alice Derived AES B64:", aliceDerivedAesB64);
  console.log("Bob Derived AES B64:", bobDerivedAesB64);
  console.log("Match:", aliceDerivedAesB64 === bobDerivedAesB64);
}

test().catch(console.error);
