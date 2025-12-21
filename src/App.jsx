import React, { useState, useEffect } from "react";
import Login from "./pages/Login";
import Chat from "./pages/Chat";
import { toast } from "react-toastify";

// ✅ Import toastify
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function App() {
  // ✅ Use sessionStorage → supports multiple users in different tabs
  const [token, setToken] = useState(sessionStorage.getItem("token"));

  // Check secure context on app load
  useEffect(() => {
    const isSecure = window.isSecureContext === true;
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    
    // Check if we're on a local/development network (RFC1918 private ranges)
    // Covers: localhost, 127.0.0.1, ::1, 10.x.x.x, 192.168.x.x, 172.16.0.0 - 172.31.255.255
    const isLocalNetwork = hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '::1' ||
                /^10\./.test(hostname) ||
                /^192\.168\./.test(hostname) ||
                /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
    
    console.log("🔐 Security Context Check:");
    console.log("   isSecureContext:", isSecure);
    console.log("   protocol:", protocol);
    console.log("   hostname:", hostname);
    console.log("   isLocalNetwork:", isLocalNetwork);
    
    if (!isSecure && protocol === 'https:') {
      console.warn("⚠️ HTTPS detected but browser reports insecure context");
      console.warn("   This usually means the SSL certificate is invalid or self-signed");
      console.warn("   Web Crypto API may not work properly. Please:");
      console.warn("   1. Accept the certificate in your browser");
      console.warn("   2. Or use a valid SSL certificate");
      
      toast.warning(
        "⚠️ Security Warning: Your connection is not fully secure. " +
        "Encryption features may not work. Please accept the SSL certificate or use a valid certificate.",
        {
          autoClose: 8000,
          position: "top-center"
        }
      );
    }
    
    // Test Web Crypto API availability
    if (!window.crypto || !window.crypto.subtle) {
      const logMethod = isLocalNetwork ? console.warn : console.error;
      logMethod("❌ Web Crypto API is not available");
      logMethod("   isSecureContext:", isSecure);
      logMethod("   protocol:", protocol);
      logMethod("   hostname:", hostname);
      logMethod("   isLocalNetwork:", isLocalNetwork);
      logMethod("   Messages will be sent unencrypted on this connection");

      // Only show warning toast, not error - the app will still work with unencrypted messages
      if (!isLocalNetwork) {
        toast.warning(
          "⚠️ Web Crypto API is not available. Messages will be sent unencrypted. " +
          "For production, please use a modern browser (Chrome, Firefox, Edge) with HTTPS.",
          {
            autoClose: 10000,
            position: "top-center"
          }
        );
      } else {
        console.warn("⚠️ Web Crypto API not available on local network HTTP connection. Using unencrypted messages.");
      }
    } else {
      console.log("✅ Web Crypto API is available and ready");
      
      // Test basic crypto functionality (optional diagnostic)
      (async () => {
        try {
          const testKey = await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
          
          const iv = window.crypto.getRandomValues(new Uint8Array(12));
          const data = new TextEncoder().encode("test");
          
          const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            testKey,
            data
          );
          
          const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            testKey,
            encrypted
          );
          
          const result = new TextDecoder().decode(decrypted);
          if (result === "test") {
            console.log("✅ Web Crypto API test: PASSED - Encryption/Decryption working");
          } else {
            console.error("❌ Web Crypto API test: FAILED - Decryption didn't match");
            console.log("   The app will still work but encryption may not function properly");
          }
        } catch (testErr) {
          console.warn("⚠️ Web Crypto API test: FAILED", testErr);
          console.log("   This may be due to self-signed HTTPS certificate or browser restrictions");
          console.log("   The app will proceed without encryption");
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (token) {
      sessionStorage.setItem("token", token);
    } else {
      sessionStorage.removeItem("token");
    }
  }, [token]);

  return (
    <>
      {/* ✅ Global Toast Notifications */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme="colored"
      />

      {/* ✅ Show Login if no token, else Chat */}
      {!token ? (
        <Login onLogin={(t) => setToken(t)} />
      ) : (
        <div className="h-screen flex flex-col">
        <Chat token={token} onLogout={() => setToken(null)} />
        </div>
      )}
    </>
  );
}
