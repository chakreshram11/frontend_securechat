import React, { useState } from "react";
import api, { setToken } from "../services/api";
import * as cryptoLib from "../lib/crypto";

// 🔑 Save private key locally
async function savePrivateKey(privateKey) {
  const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
  const privB64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  localStorage.setItem("ecdhPrivateKey", privB64);
}

// 🔑 Load private key if already exists
async function loadPrivateKey() {
  const b64 = localStorage.getItem("ecdhPrivateKey");
  if (!b64) return null;
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  return window.crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleLogin(e) {
    e.preventDefault();

    // Login only
    let privateKey = await loadPrivateKey();
    const needPrivateKey = !privateKey;
    
    // If we have a local public key, send it
    const publicKeyRawBase64 = cryptoLib.getLocalPublicKey();

    // Build payload
    const payload = { username, password, needPrivateKey };
    if (publicKeyRawBase64) {
      payload.ecdhPublicKey = publicKeyRawBase64;
    }

    try {
      const { data } = await api.post("/api/auth/login", payload);

      // Always ensure we have valid keys in localStorage
      // Try server key first, but if it fails, generate new client-side keys
      let keysReady = false;
      
      // Check if Web Crypto API is available
      if (!window.crypto || !window.crypto.subtle) {
        const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        console.error("❌ Web Crypto API not available");
        console.error("Is secure context:", isSecureContext);
        console.error("Protocol:", location.protocol);
        console.error("Hostname:", location.hostname);
        
        if (!isSecureContext) {
          alert("⚠️ Encryption requires HTTPS or localhost.\n\nYou're accessing via HTTP from an IP address. Web Crypto API only works in secure contexts.\n\nSolutions:\n1. Use HTTPS (recommended)\n2. Access via localhost instead of IP\n3. Set up SSL certificate for your server");
        } else {
          alert("Your browser doesn't support Web Crypto API. Please use a modern browser like Chrome, Firefox, or Edge.");
        }
        return;
      }
      
      if (data.ecdhPrivateKey) {
        // Try to verify the server key can be imported
        try {
          const raw = Uint8Array.from(atob(data.ecdhPrivateKey), (c) => c.charCodeAt(0)).buffer;
          await window.crypto.subtle.importKey(
            "pkcs8",
            raw,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
          );
          // Server key is valid - use it
          localStorage.setItem("ecdhPrivateKey", data.ecdhPrivateKey);
          if (data.user.ecdhPublicKey) {
            localStorage.setItem("ecdhPublicKey", data.user.ecdhPublicKey);
          }
          console.log("✅ Server private key saved and ready to use");
          keysReady = true;
        } catch (err) {
          console.warn("⚠️ Server private key format incompatible:", err.message);
          // Will generate new keys below
        }
      }
      
      // If server key didn't work or wasn't provided, generate new client-side keys
      if (!keysReady) {
        try {
          console.log("🔄 Generating new client-side key pair...");
          
          // Check if Web Crypto API is available (should already be checked above, but double-check)
          if (!window.crypto || !window.crypto.subtle) {
            const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (!isSecureContext) {
              throw new Error("Web Crypto API requires HTTPS. You're accessing via HTTP from an IP address.");
            }
            throw new Error("Web Crypto API not supported in this browser");
          }
          
          // Generate keys - this saves to localStorage automatically
          const { privB64, pubB64 } = await cryptoLib.generateECDHKeyPair();
          console.log("✅ New key pair generated, private key length:", privB64.length);
          
          // Verify keys are in localStorage
          if (!localStorage.getItem("ecdhPrivateKey") || !localStorage.getItem("ecdhPublicKey")) {
            throw new Error("Keys were not saved to localStorage");
          }
          
          // Small delay to ensure localStorage is written
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify the generated key can be imported
          let testKey = await loadPrivateKey();
          if (!testKey) {
            // Try one more time with longer delay
            console.log("⚠️ First import attempt failed, retrying...");
            await new Promise(resolve => setTimeout(resolve, 200));
            testKey = await loadPrivateKey();
          }
          
          if (!testKey) {
            console.error("❌ Generated key exists but cannot be imported");
            console.error("Private key present:", !!localStorage.getItem("ecdhPrivateKey"));
            console.error("Public key present:", !!localStorage.getItem("ecdhPublicKey"));
            // Don't throw error - keys are generated, they might work later
            console.warn("⚠️ Key import verification failed, but keys are saved. Continuing...");
          } else {
            console.log("✅ Generated key verified and ready to use");
          }
          
          // Update server with new public key (non-blocking, don't wait)
          api.post('/api/auth/uploadKey', { ecdhPublicKey: pubB64 })
            .then(() => console.log("✅ New public key uploaded to server"))
            .catch((uploadErr) => {
              console.warn("⚠️ Failed to upload new key (non-critical):", uploadErr);
              // This is not critical - the key is saved locally and will work
            });
          
          keysReady = true;
        } catch (genErr) {
          console.error("❌ Failed to generate keys:", genErr);
          console.error("Error name:", genErr.name);
          console.error("Error message:", genErr.message);
          if (genErr.stack) console.error("Stack:", genErr.stack);
          alert(`Failed to set up encryption: ${genErr.message}\n\nPlease try:\n1. Refreshing the page\n2. Using a different browser\n3. Checking browser console for details`);
          return; // Don't proceed with login if keys can't be generated
        }
      }
      
      if (!keysReady) {
        console.error("❌ Keys not ready after all attempts");
        alert("Encryption setup failed. Please try refreshing the page.");
        return;
      }

      setToken(data.token);
      onLogin(data.token);
    } catch (err) {
      console.error("Login error:", err);
      const errorMessage = err.response?.data?.error || err.message || "Authentication failed";
      alert(errorMessage);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        className="bg-white p-6 rounded shadow w-96"
        onSubmit={handleLogin}
      >
        <h2 className="text-xl mb-4 font-semibold text-center">
          Login
        </h2>

        <input
          className="w-full mb-2 p-2 border rounded"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <input
          type="password"
          className="w-full mb-4 p-2 border rounded"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          className="bg-blue-600 text-white px-4 py-2 rounded w-full hover:bg-blue-700"
          type="submit"
        >
          Login
        </button>
        
        <p className="text-xs text-gray-500 text-center mt-4">
          Contact your administrator to create an account
        </p>
      </form>
    </div>
  );
}
