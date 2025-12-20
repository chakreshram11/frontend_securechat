// frontend/src/components/ChatWindow.jsx
import React, { useEffect, useState, useRef } from "react";
import api from "../services/api";
import * as cryptoLib from "../lib/crypto";
import { toast } from "react-toastify";
import { generateECDHKeyPair } from "../lib/crypto";

// 🔑 load private ECDH key from localStorage
export async function loadLocalPrivateKey() {
  const b64 = localStorage.getItem("ecdhPrivateKey");
  if (!b64) {
    console.log("❌ No private key found in localStorage");
    console.log("Available localStorage keys:", Object.keys(localStorage));
    return null;
  }
  
  console.log("🔍 Attempting to import private key, length:", b64.length);
  
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    console.log("🔍 Raw key buffer length:", raw.byteLength);
    
    const key = await window.crypto.subtle.importKey(
      "pkcs8",
      raw,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    console.log("✅ Private key imported successfully");
    return key;
  } catch (err) {
    console.error("❌ Failed to import private key:", err);
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Key length:", b64.length);
    console.error("First 50 chars of key:", b64.substring(0, 50));
    
    // Don't remove the key automatically - let user try to re-login
    // The key might be valid but in a different format
    return null;
  }
}

export default function ChatWindow({ other, socket, myUserId }) {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState("");
  const [aesKey, setAesKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [hasRecipientKey, setHasRecipientKey] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef();

  const appendNewMessage = (m) => setHistory((prev) => [...prev, m]);

  /* ---------- Initialize ECDH key pair (once per user) ---------- */
  useEffect(() => {
    (async () => {
      // Generate ECDH keypair if not already present
      const existingPub = localStorage.getItem("ecdhPublicKey");
      if (!existingPub) {
        await generateECDHKeyPair();
        console.log("✅ ECDH key pair generated");
      }
      // Clear cached AES keys (optional — only once)
      if (!localStorage.getItem("aesKeys")) {
        localStorage.removeItem("aesKeys");
      }
    })();
  }, []);

  /* ---------- Load AES key + history ---------- */
  useEffect(() => {
    (async () => {
      try {
        const { data: otherUser } = await api.get(`/api/users/${other._id}`);
        let myPriv = await loadLocalPrivateKey();
        
        // If no private key, try to generate a new one and update server
        if (!myPriv) {
          console.log("⚠️ No private key found in localStorage");
          console.log("Available keys:", {
            hasPrivate: !!localStorage.getItem("ecdhPrivateKey"),
            hasPublic: !!localStorage.getItem("ecdhPublicKey"),
            token: !!localStorage.getItem("token")
          });
          
          try {
            // Generate new keys - this will automatically save to localStorage
            console.log("🔄 Generating new key pair...");
            const { privB64, pubB64 } = await generateECDHKeyPair();
            console.log("✅ New key pair generated, private key length:", privB64.length);
            
            // Small delay to ensure localStorage is written
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Load the newly generated key from localStorage
            myPriv = await loadLocalPrivateKey();
            
            if (!myPriv) {
              console.error("❌ Failed to load newly generated key");
              // One more retry
              await new Promise(resolve => setTimeout(resolve, 100));
              myPriv = await loadLocalPrivateKey();
            }
            
            if (!myPriv) {
              console.error("❌ Still failed to load key after retries");
              toast.error("⚠️ Encryption key issue. Please log out and log back in.", {
                autoClose: 5000
              });
              setLoading(false);
              return;
            }
            
            console.log("✅ Successfully loaded newly generated private key");
            
            // Try to update the server with the new public key (non-blocking, don't wait)
            api.post('/api/auth/uploadKey', { ecdhPublicKey: pubB64 })
              .then(() => console.log("✅ New public key uploaded to server"))
              .catch((uploadErr) => {
                console.warn("⚠️ Failed to upload new key to server (non-critical):", uploadErr);
                // This is not critical - the key is saved locally and will work
              });
          } catch (genErr) {
            console.error("❌ Failed to generate new key:", genErr);
            console.error("Error name:", genErr.name);
            console.error("Error message:", genErr.message);
            toast.error("⚠️ Failed to generate encryption keys. Please log out and log back in.", {
              autoClose: 5000
            });
            setLoading(false);
            return;
          }
        }
        
        if (!myPriv) {
          toast.error("⚠️ Missing local ECDH private key. Please re-login.");
          setLoading(false);
          return;
        }

        // 🚨 Handle case: recipient has no ECDH public key yet
        if (!otherUser.ecdhPublicKey) {
          toast.warning(
            `⚠️ ${otherUser.displayName || otherUser.username} hasn’t logged in yet. You can message them once they’re online.`,
            {
              toastId: `no-key-${otherUser._id}`,
              position: "top-center",
              autoClose: 5000,
              theme: "light",
            }
          );
          setHasRecipientKey(false);
          setLoading(false);
          return;
        } else {
          setHasRecipientKey(true);
        }

        // Derive AES key - always re-derive to ensure we use the latest public key
        console.log("🔑 Deriving AES key for user:", otherUser.username);
        console.log("   Other user's public key length:", otherUser.ecdhPublicKey?.length);
        console.log("   My public key length:", cryptoLib.getLocalPublicKey()?.length);
        
        let importedKey;
        try {
          // Verify we have the recipient's public key
          if (!otherUser.ecdhPublicKey) {
            throw new Error("Recipient has no public key");
          }
          
          const derived = await cryptoLib.deriveSharedAESKey(
            myPriv,
            otherUser.ecdhPublicKey
          );
          importedKey = await cryptoLib.importAesKeyFromRawBase64(
            derived.rawKeyBase64
          );
          // Always update cached key to ensure it's current
          cryptoLib.saveAesKeyForUser(other._id, derived.rawKeyBase64);
          console.log("✅ AES key derived and cached successfully");
        } catch (deriveErr) {
          console.error("❌ Failed to derive AES key:", deriveErr);
          console.error("   Error details:", deriveErr.message);
          throw new Error("Could not derive AES key for encryption");
        }

        setAesKey(importedKey);

        // Fetch + decrypt history
        const { data } = await api.get(`/api/messages/history/${other._id}`);
        const decrypted = await Promise.all(
          data.map(async (m) => {
            if (!m.ciphertext) {
              return {
                ...m,
                plaintext: "[No ciphertext]",
                isMe: m.senderId === myUserId,
              };
            }
            
            // For messages I sent, use the current AES key (I encrypted with recipient's current key)
            // For messages from others, try sender's public key from meta first (they encrypted with their key)
            let decryptionKey = importedKey;
            let decryptionAttempted = false;
            
            // If message is from another user and we have their public key in meta, use it
            if (String(m.senderId) !== String(myUserId) && m.meta?.senderPublicKey) {
              try {
                console.log("🔑 Using sender's public key from message meta for decryption");
                const { aesKey: senderKey } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  m.meta.senderPublicKey
                );
                decryptionKey = senderKey;
                decryptionAttempted = true;
              } catch (keyErr) {
                console.warn("⚠️ Failed to derive key from sender's public key in meta:", keyErr);
              }
            }
            
            // Try decrypting
            try {
              const plaintext = await cryptoLib.decryptWithAesKey(decryptionKey, m.ciphertext);
              // If we used sender's key and it worked, cache it
              if (decryptionAttempted && m.meta?.senderPublicKey) {
                const { rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  m.meta.senderPublicKey
                );
                cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
              }
              return { ...m, plaintext, isMe: m.senderId === myUserId };
            } catch (decryptErr) {
              console.warn("⚠️ Decryption failed:", {
                messageId: m.id,
                senderId: m.senderId,
                isMe: m.senderId === myUserId,
                usedSenderKey: decryptionAttempted,
                error: decryptErr.message
              });
              
              // If we haven't tried sender's key yet, try it now
              if (!decryptionAttempted && m.meta?.senderPublicKey) {
                try {
                  console.log("🔄 Retrying with sender's public key from message meta");
                  const { aesKey: retryKey, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                    myPriv,
                    m.meta.senderPublicKey
                  );
                  const plaintext = await cryptoLib.decryptWithAesKey(retryKey, m.ciphertext);
                  cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                  return { ...m, plaintext, isMe: m.senderId === myUserId };
                } catch (retryErr) {
                  console.error("❌ Retry with sender's key failed:", retryErr);
                }
              }
              
              // Last resort: fetch sender's current public key from server
              if (m.senderId && String(m.senderId) !== String(myUserId)) {
                try {
                  console.log("🔄 Fetching sender's current public key from server");
                  const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
                  if (senderUser.ecdhPublicKey) {
                    const { aesKey: serverKey, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                      myPriv,
                      senderUser.ecdhPublicKey
                    );
                    const plaintext = await cryptoLib.decryptWithAesKey(serverKey, m.ciphertext);
                    cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                    return { ...m, plaintext, isMe: m.senderId === myUserId };
                  }
                } catch (fetchErr) {
                  console.error("❌ Failed to fetch/use sender's key:", fetchErr);
                }
              }
              
              console.error("❌ All decryption attempts failed for message:", m.id);
              return { ...m, plaintext: "[Decryption Error]", isMe: m.senderId === myUserId };
            }
          })
        );
        setHistory(decrypted);
      } catch (err) {
        console.error("❌ Error loading chat:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [other, myUserId]);

  /* ---------- Incoming messages ---------- */
  useEffect(() => {
    if (!socket || !aesKey) return;

    const handler = async (m) => {
      try {
        if (!m.senderId || !m.ciphertext) return;
        let text;
        try {
          text = await cryptoLib.decryptWithAesKey(aesKey, m.ciphertext);
        } catch (err) {
          console.warn("⚠️ Failed to decrypt incoming message with current AES key");
          console.warn("   Error:", err.message);
          console.warn("   Sender ID:", m.senderId);
          console.warn("   Has senderPublicKey in meta:", !!m.meta?.senderPublicKey);
          
          // Try using sender's public key from message meta
          if (m.meta?.senderPublicKey) {
            try {
              console.log("🔄 Retrying with sender's public key from message meta");
              const myPriv = await loadLocalPrivateKey();
              if (!myPriv) {
                console.error("❌ No private key available for decryption");
                text = "[Decryption Error - No Key]";
              } else {
                const { aesKey: derived, rawKeyBase64 } =
                  await cryptoLib.deriveSharedAESKey(myPriv, m.meta.senderPublicKey);

                text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                setAesKey(derived);
                console.log("✅ Successfully decrypted using sender's public key from meta");
              }
            } catch (retryErr) {
              console.error("❌ Retry decryption failed:", retryErr);
              text = "[Decryption Error]";
            }
          } else {
            // Try fetching sender's public key from server
            try {
              console.log("🔄 Fetching sender's public key from server");
              const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
              if (senderUser.ecdhPublicKey) {
                const myPriv = await loadLocalPrivateKey();
                if (myPriv) {
                  const { aesKey: derived, rawKeyBase64 } =
                    await cryptoLib.deriveSharedAESKey(myPriv, senderUser.ecdhPublicKey);
                  text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                  cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                  setAesKey(derived);
                  console.log("✅ Successfully decrypted using sender's current public key");
                } else {
                  text = "[Decryption Error - No Key]";
                }
              } else {
                text = "[Decryption Error - No Sender Key]";
              }
            } catch (fetchErr) {
              console.error("❌ Failed to fetch sender's key:", fetchErr);
              text = "[Decryption Error]";
            }
          }
        }

        appendNewMessage({
          ...m,
          plaintext: text,
          isMe: String(m.senderId) === String(myUserId),
        });
      } catch (err) {
        console.error("❌ Decrypt failed:", err);
        appendNewMessage({
          ...m,
          plaintext: "[Decryption Error]",
          isMe: String(m.senderId) === String(myUserId),
        });
      }
    };

    socket.on("message", handler);
    return () => socket.off("message", handler);
  }, [socket, aesKey, myUserId]);

  /* ---------- Auto-scroll ---------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  /* ---------- Send text ---------- */
  async function send() {
    if (!text.trim() || !aesKey) {
      console.error("❌ Cannot send: missing text or AES key");
      return;
    }
    try {
      const myPublicKey = await cryptoLib.getLocalPublicKey();
      console.log("📤 Sending message:", {
        textLength: text.length,
        hasAesKey: !!aesKey,
        hasPublicKey: !!myPublicKey,
        publicKeyLength: myPublicKey?.length
      });
      
      const c = await cryptoLib.encryptWithAesKey(aesKey, text);
      console.log("✅ Message encrypted, ciphertext length:", c.length);
      
      appendNewMessage({
        senderId: myUserId,
        receiverId: other._id,
        plaintext: text,
        ciphertext: c,
        type: "text",
        createdAt: new Date(),
        isMe: true,
        read: false,
      });

      socket.emit("sendMessage", {
        receiverId: other._id,
        ciphertext: c,
        type: "text",
        meta: {
          senderPublicKey: myPublicKey,
        },
      });
      
      console.log("✅ Message sent with senderPublicKey in meta");

      setText("");
    } catch (err) {
      console.error("❌ Failed to send", err);
      console.error("Error details:", err.message, err.stack);
    }
  }

  /* ---------- File upload ---------- */
  async function handleFiles(files) {
    if (!files.length || !aesKey) return;
    for (let file of files) {
      const id = Date.now() + file.name;
      const uploadEntry = { id, name: file.name, progress: 0 };
      setUploadingFiles((prev) => [...prev, uploadEntry]);

      try {
        const form = new FormData();
        form.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/messages/upload");
        xhr.setRequestHeader(
          "Authorization",
          "Bearer " + localStorage.getItem("token")
        );

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, progress: percent } : f))
            );
          }
        };

        xhr.onload = async () => {
          if (xhr.status === 200) {
            const { url } = JSON.parse(xhr.responseText);
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);

            appendNewMessage({
              senderId: myUserId,
              receiverId: other._id,
              plaintext: isImage ? "🖼️ Image" : `📎 ${file.name}`,
              type: "file",
              meta: { url, name: file.name, isImage },
              createdAt: new Date(),
              isMe: true,
              read: false,
            });

            const c = await cryptoLib.encryptWithAesKey(
              aesKey,
              `File: ${file.name}`
            );

            socket.emit("sendMessage", {
              receiverId: other._id,
              ciphertext: c,
              type: "text",
              meta: {
                senderPublicKey: await cryptoLib.getLocalPublicKey(),
              },
            });
          }
          setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
        };

        xhr.onerror = () => {
          console.error("❌ Upload failed");
          setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
        };

        xhr.send(form);
      } catch (err) {
        console.error("❌ File upload failed", err);
      }
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Header */}
      <div className="border-b p-3 font-semibold bg-gray-100 flex justify-between items-center">
        <span>{other.displayName || other.username}</span>
        <button
          className="text-blue-600 hover:underline"
          onClick={() => fileInputRef.current.click()}
        >
          📎
        </button>
        <input
          type="file"
          multiple
          hidden
          ref={fileInputRef}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 flex flex-col-reverse space-y-reverse space-y-3"
        style={{ minHeight: 0 }}
        ref={messagesEndRef}
      >
        {loading ? (
          <div className="text-center text-gray-500">⏳ Loading...</div>
        ) : (
          history
            .slice()
            .reverse()
            .map((m, i) => (
              <div
                key={i}
                className={`flex ${m.isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-xs sm:max-w-md p-2 rounded-lg shadow text-sm ${
                    m.isMe
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-800"
                  }`}
                >
                  {m.type === "file" && m.meta?.url ? (
                    m.meta.isImage ? (
                      <img
                        src={m.meta.url}
                        alt={m.meta.name}
                        className="rounded max-h-60 object-contain"
                      />
                    ) : (
                      <a
                        href={m.meta.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {m.plaintext}
                      </a>
                    )
                  ) : (
                    <div>{m.plaintext}</div>
                  )}
                  <div className="text-xs opacity-70 mt-1 flex justify-between">
                    <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                    {m.isMe && <span>{m.read ? "✅" : "✔️"}</span>}
                  </div>
                </div>
              </div>
            ))
        )}

        {/* Upload progress */}
        {uploadingFiles.map((f) => (
          <div key={f.id} className="text-sm text-gray-600">
            {f.name} - {f.progress}%
          </div>
        ))}
      </div>

      {/* Input */}
      {!hasRecipientKey ? (
        <div className="p-4 text-center text-yellow-700 bg-yellow-50 border-t border-yellow-300">
          ⚠️ {other.displayName || other.username} hasn’t logged in yet.
          <br />
          You’ll be able to message them once they log in.
        </div>
      ) : (
        <div className="p-3 border-t flex gap-2 bg-gray-50 sticky bottom-0">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={send}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
