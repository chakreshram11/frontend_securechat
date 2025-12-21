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
  const pendingLastMessageRef = useRef(null); // cache last plaintext sent (for resend fallback)


  const appendNewMessage = (m) => setHistory((prev) => [...prev, m]);

  /* ---------- Initialize ECDH key pair (only if Web Crypto available) ---------- */
  useEffect(() => {
    (async () => {
      const hasWebCrypto = window.crypto && window.crypto.subtle;
      
      if (hasWebCrypto) {
        // Generate ECDH keypair if not already present
        const existingPub = localStorage.getItem("ecdhPublicKey");
        if (!existingPub) {
          try {
            await generateECDHKeyPair();
            console.log("✅ ECDH key pair generated");
          } catch (err) {
            console.warn("⚠️ Failed to generate ECDH keys - will proceed without encryption:", err.message);
          }
        }
        // Clear cached AES keys (optional — only once)
        if (!localStorage.getItem("aesKeys")) {
          localStorage.removeItem("aesKeys");
        }
      } else {
        console.warn("⚠️ Web Crypto not available - skipping ECDH key generation");
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
              console.warn("⚠️ Encryption key issue, continuing without private key (messages may be unencrypted or not decryptable)");
              // Continue without a private key - load history and show messages accordingly
              // Do not return here; allow the code below to continue and handle missing key
              
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
            console.warn("⚠️ Failed to generate encryption keys - proceeding without encryption");
            // Continue without private key (messages will be unencrypted or show as encrypted/no-key)
            myPriv = null;
          }
        }
        
        if (!myPriv) {
          console.warn("⚠️ Missing local ECDH private key - continuing without encryption");
          // Don't return; proceed to fetch history and display messages (may be encrypted or plaintext)
        }

        // If recipient has no public key, warn but continue — allow unencrypted messages and history
        if (!otherUser.ecdhPublicKey) {
          toast.warning(
            `⚠️ ${otherUser.displayName || otherUser.username} hasn’t uploaded an encryption key. Messages will be sent unencrypted.`,
            {
              toastId: `no-key-${otherUser._id}`,
              position: "top-center",
              autoClose: 5000,
              theme: "light",
            }
          );
          setHasRecipientKey(false);
          // continue without returning — we'll fetch history and show messages as plaintext when needed
        } else {
          setHasRecipientKey(true);
        }

        // Attempt to derive AES key only if both sides have keys
        console.log("🔑 Attempting AES key derivation for user:", otherUser.username);
        console.log("   Other user's public key length:", otherUser.ecdhPublicKey?.length);
        console.log("   My public key length:", cryptoLib.getLocalPublicKey()?.length);
        
        let importedKey = null;
        if (otherUser.ecdhPublicKey && myPriv) {
          try {
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
            console.warn("⚠️ Continuing without AES key (messages will be unencrypted or not decryptable)");
            importedKey = null;
          }
        } else {
          console.log("⚠️ Skipping AES key derivation (missing recipient public key or local private key)", {
            hasRecipientPublicKey: !!otherUser.ecdhPublicKey,
            hasLocalPrivateKey: !!myPriv
          });
        }

        setAesKey(importedKey);

        // Fetch + decrypt history
        const { data } = await api.get(`/api/messages/history/${other._id}`);
        console.log(`📥 Received ${data.length} messages from history API`);
        data.forEach((msg, idx) => {
          console.log(`📨 History message ${idx}:`, {
            id: msg._id || msg.id,
            hasMeta: !!msg.meta,
            metaKeys: msg.meta ? Object.keys(msg.meta) : [],
            hasSenderPublicKey: !!msg.meta?.senderPublicKey,
            senderPublicKeyLength: msg.meta?.senderPublicKey?.length,
            ciphertextLength: msg.ciphertext?.length
          });
        });
        
        const decrypted = await Promise.all(
          data.map(async (m) => {
            if (!m.ciphertext) {
              return {
                ...m,
                plaintext: "[No ciphertext]",
                isMe: m.senderId === myUserId,
              };
            }
            
            // Check if message is marked as unencrypted
            if (m.meta?.unencrypted) {
              console.log("📥 Unencrypted message in history:", {
                id: m._id || m.id,
                plaintext: m.ciphertext.substring(0, 50)
              });
              return {
                ...m,
                plaintext: m.ciphertext,
                isMe: m.senderId === myUserId,
              };
            }
            
            // Validate encrypted ciphertext length - must be at least 29 bytes
            if (m.ciphertext.length < 29) {
              console.error("❌ Encrypted message too short - may be unencrypted:", {
                id: m._id || m.id,
                length: m.ciphertext.length,
                meta: m.meta,
              });
              // Try to use as plaintext anyway
              return {
                ...m,
                plaintext: m.ciphertext,
                isMe: m.senderId === myUserId,
              };
            }
            
            const isMe = String(m.senderId) === String(myUserId);
            let plaintext = null;
            
            // Strategy 1: Try cached AES key for this sender/receiver
            if (m.senderId) {
              const cachedKeyB64 = cryptoLib.loadAesKeyForUser(m.senderId);
              if (cachedKeyB64) {
                try {
                  const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
                  plaintext = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
                  console.log("✅ Decrypted using cached key");
                  return { ...m, plaintext, isMe };
                } catch (cachedErr) {
                  console.warn("⚠️ Cached key failed, trying other methods");
                }
              }
            }
            
            // Strategy 2: For messages from others, try sender's public key from meta (CORRECT approach)
            // The sender encrypted with: senderPrivateKey + myPublicKey
            // I decrypt with: myPrivateKey + senderPublicKey (from meta) = same shared secret
            if (!isMe && m.meta?.senderPublicKey) {
              try {
                console.log("🔑 Trying sender's public key from meta for message from:", m.senderId);
                console.log("   Sender public key (first 50):", m.meta.senderPublicKey.substring(0, 50));
                
                // Verify the public key format
                if (m.meta.senderPublicKey.length < 100) {
                  console.error("⚠️ Sender public key seems too short:", m.meta.senderPublicKey.length);
                }
                
                const { aesKey: senderKey, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  m.meta.senderPublicKey
                );
                console.log("   ✅ Key derived, attempting decryption...");
                
                plaintext = await cryptoLib.decryptWithAesKey(senderKey, m.ciphertext);
                console.log("   ✅ Decrypted successfully:", plaintext.substring(0, 50));
                
                cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                console.log("✅ Decrypted using sender's key from meta");
                return { ...m, plaintext, isMe };
              } catch (metaErr) {
                console.error("❌ Sender's key from meta failed:", metaErr.message);
                console.error("   Error name:", metaErr.name);
                console.error("   Error details:", {
                  hasPrivateKey: !!myPriv,
                  hasSenderPublicKey: !!m.meta.senderPublicKey,
                  senderPublicKeyLength: m.meta.senderPublicKey?.length,
                  ciphertextLength: m.ciphertext?.length,
                  senderPublicKeyValid: m.meta.senderPublicKey && m.meta.senderPublicKey.length > 100
                });
                if (metaErr.stack) {
                  console.error("   Stack:", metaErr.stack);
                }
              }
            }
            
            // Strategy 3: For messages I sent, try current recipient's key
            // I encrypted with: myPrivateKey + recipientPublicKey (at time of sending)
            // To decrypt, I need: myPrivateKey + recipientPublicKey (same key)
            // Note: This only works if recipient's key hasn't changed
            if (isMe) {
              try {
                plaintext = await cryptoLib.decryptWithAesKey(importedKey, m.ciphertext);
                console.log("✅ Decrypted my message using current recipient key");
                return { ...m, plaintext, isMe };
              } catch (myMsgErr) {
                console.warn("⚠️ Current recipient key failed for my message:", myMsgErr.message);
                // Try to use cached key if available
                const cachedKeyB64 = cryptoLib.loadAesKeyForUser(other._id);
                if (cachedKeyB64) {
                  try {
                    const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
                    plaintext = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
                    console.log("✅ Decrypted my message using cached recipient key");
                    return { ...m, plaintext, isMe };
                  } catch (cachedErr) {
                    console.warn("⚠️ Cached recipient key also failed");
                  }
                }
              }
            }
            
            // Strategy 4: For messages from others, try fetching their current public key
            if (!isMe && m.senderId) {
              try {
                const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
                if (senderUser?.ecdhPublicKey) {
                  const { aesKey: serverKey, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                    myPriv,
                    senderUser.ecdhPublicKey
                  );
                  plaintext = await cryptoLib.decryptWithAesKey(serverKey, m.ciphertext);
                  cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                  console.log("✅ Decrypted using sender's current key from server");
                  return { ...m, plaintext, isMe };
                }
              } catch (fetchErr) {
                console.warn("⚠️ Failed to fetch/use sender's current key");
              }
            }
            
            // Strategy 5: For messages I sent, try recipient's current key (already tried, but log it)
            if (isMe) {
              console.warn("⚠️ Could not decrypt my own message - recipient's key may have changed");
            }
            
            // All strategies failed
            console.error("❌ All decryption attempts failed for message:", {
              id: m._id || m.id,
              senderId: m.senderId,
              isMe,
              hasMeta: !!m.meta,
              hasSenderPublicKey: !!m.meta?.senderPublicKey
            });
            return { ...m, plaintext: "[Decryption Error]", isMe };
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
    if (!socket) return;

    const handler = async (m) => {
      try {
        console.log("🔔 Socket message received");
        
        if (!m.senderId || !m.ciphertext) return;
        
        // Check if message is unencrypted
        if (m.meta?.unencrypted) {
          console.log("📥 Unencrypted message received");
          appendNewMessage({
            ...m,
            plaintext: m.ciphertext,
            isMe: false,
          });
          return;
        }
        
        // Encrypted message - try to decrypt
        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          console.warn("⚠️ No private key - showing encrypted message");
          appendNewMessage({
            ...m,
            plaintext: "[Encrypted - no key]",
            isMe: false,
          });
          return;
        }
        
        let text = "[Decryption Error]";
        let decryptionSucceeded = false;
        
        // Try to decrypt with sender's public key from meta
        if (m.meta?.senderPublicKey) {
          try {
            const { aesKey: derived } = await cryptoLib.deriveSharedAESKey(myPriv, m.meta.senderPublicKey);
            text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
            decryptionSucceeded = true;
            console.log("✅ Decrypted with sender's public key from meta");
          } catch (metaErr) {
            console.warn("⚠️ Decryption with sender key failed:", metaErr.message);
            // If the message is very short, it might be plaintext
            if (m.ciphertext.length < 29) {
              console.warn("   Message is very short - treating as plaintext");
              text = m.ciphertext;
              decryptionSucceeded = true;
            }
          }
        }
        
        // Try cached key if first attempt failed
        if (!decryptionSucceeded && m.senderId) {
          const cachedKeyB64 = cryptoLib.loadAesKeyForUser(m.senderId);
          if (cachedKeyB64) {
            try {
              const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
              text = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
              decryptionSucceeded = true;
              console.log("✅ Decrypted with cached key");
            } catch (err) {
              console.warn("⚠️ Cached key decryption failed");
            }
          }
        }
        
        // Try current aesKey
        if (!decryptionSucceeded && aesKey) {
          try {
            text = await cryptoLib.decryptWithAesKey(aesKey, m.ciphertext);
            decryptionSucceeded = true;
            console.log("✅ Decrypted with current AES key");
          } catch (err) {
            console.warn("⚠️ Current AES key decryption failed");
            // If message is short, treat as plaintext
            if (m.ciphertext.length < 29) {
              console.warn("   Message is very short - treating as plaintext");
              text = m.ciphertext;
              decryptionSucceeded = true;
            }
          }
        }
        
        // If still not decrypted and message is short, treat as plaintext
        if (!decryptionSucceeded && m.ciphertext.length < 29) {
          console.warn("⚠️ Could not decrypt - treating short message as plaintext");
          text = m.ciphertext;
          decryptionSucceeded = true;
        }

        appendNewMessage({
          ...m,
          plaintext: decryptionSucceeded ? text : "[Decryption Error]",
          isMe: false,
        });
      } catch (err) {
        console.error("❌ Message handler error:", err);
        appendNewMessage({
          ...m,
          plaintext: "[Error]",
          isMe: false,
        });
      }
    };

    socket.on("message", handler);
    
    // Handle send errors from the server
    const errorHandler = (error) => {
      console.error("❌ Server rejected message:", error);
      // If server asks us to resend unencrypted because recipient has no private key, do a fallback resend
      if (error?.reason === 'recipient_no_private_key') {
        const pending = pendingLastMessageRef.current;
        if (pending && pending.receiverId && pending.plaintext) {
          // Update the previously appended pending message (matching tempId) instead of appending a duplicate
          const { tempId, plaintext } = pending;
          setHistory((prev) => prev.map((msg) => {
            if (tempId && msg.tempId === tempId) {
              return {
                ...msg,
                ciphertext: plaintext,
                meta: { ...(msg.meta || {}), unencrypted: true },
                tempId: undefined
              };
            }
            return msg;
          }));

          // Emit as unencrypted
          socket.emit('sendMessage', {
            receiverId: pending.receiverId,
            ciphertext: pending.plaintext,
            type: 'text',
            meta: { unencrypted: true }
          });

          // Clear pending
          pendingLastMessageRef.current = null;

          // Silent resend - no toast
        } else {
          // No pending message cached: let user know to retry
          toast.error('Recipient cannot decrypt encrypted messages; please resend without encryption.');
        }
        return;
      }

      toast.error(`❌ Message failed: ${error.message || error.reason}`);
    };
    
    socket.on("errorSending", errorHandler);
    
    return () => {
      socket.off("message", handler);
      socket.off("errorSending", errorHandler);
    };
  }, [socket, aesKey, myUserId, other._id]);

  /* ---------- Auto-scroll ---------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  /* ---------- Send text ---------- */
  async function send() {
    if (!text.trim()) {
      console.error("❌ Cannot send: text is empty");
      return;
    }
    
    // Check if encryption is available
    const hasWebCrypto = window.crypto && window.crypto.subtle;

    // Fetch recipient status to decide whether to encrypt
    let recipientUser = null;
    try {
      const res = await api.get(`/api/users/${other._id}`);
      recipientUser = res.data;
    } catch (err) {
      console.warn('⚠️ Could not fetch recipient info, proceeding with conservative defaults', err.message);
    }

    // Force unencrypted if recipient has no public key or message is very short
    const forceUnencrypted = !recipientUser?.ecdhPublicKey || text.length < 8;

    if (!hasWebCrypto || !aesKey || forceUnencrypted) {
      console.warn('⚠️ Sending message without encryption', { hasWebCrypto, aesKeyPresent: !!aesKey, forceUnencrypted });
      // Send message without encryption
      appendNewMessage({
        senderId: myUserId,
        receiverId: other._id,
        plaintext: text,
        ciphertext: text, // Send plaintext as "ciphertext"
        type: "text",
        createdAt: new Date(),
        isMe: true,
        read: false,
      });

      const messagePayload = {
        receiverId: other._id,
        ciphertext: text,
        type: "text",
        meta: {
          unencrypted: true, // Mark as unencrypted
        },
      };

      socket.emit("sendMessage", messagePayload);
      setText("");
      return;
    }

    try {
      const myPublicKey = cryptoLib.getLocalPublicKey();
      if (!myPublicKey) {
        console.error("❌ Cannot send: No public key found in localStorage");
        toast.error("⚠️ Missing encryption key. Please log out and log back in.");
        return;
      }
      
      console.log("📤 Sending message:", {
        textLength: text.length,
        hasAesKey: !!aesKey,
        hasPublicKey: !!myPublicKey,
        publicKeyLength: myPublicKey.length,
        receiverId: other._id
      });
      
      const c = await cryptoLib.encryptWithAesKey(aesKey, text);
      console.log("✅ Message encrypted, ciphertext length:", c.length);
      
      // Verify encryption worked by trying to decrypt it (for debugging)
      try {
        const testDecrypt = await cryptoLib.decryptWithAesKey(aesKey, c);
        if (testDecrypt !== text) {
          console.error("🚨 Encryption verification failed - decrypted text doesn't match!");
          toast.error("⚠️ Encryption verification failed. Message not sent.", {
            autoClose: 3000
          });
          return;
        } else {
          console.log("✅ Encryption verified - can decrypt own message");
        }
      } catch (verifyErr) {
        console.error("🚨 Encryption verification failed:", verifyErr);
        toast.error("⚠️ Encryption failed. Message not sent.", {
          autoClose: 3000
        });
        return;
      }
      
      // Use a temporary id so we can update (not append) if we need to resend as plaintext
      const tempId = `pending:${Date.now()}`;
      appendNewMessage({
        tempId,
        senderId: myUserId,
        receiverId: other._id,
        plaintext: text,
        ciphertext: c,
        type: "text",
        createdAt: new Date(),
        isMe: true,
        read: false,
      });

      const messagePayload = {
        receiverId: other._id,
        ciphertext: c,
        type: "text",
        meta: {
          senderPublicKey: myPublicKey,
        },
      };
      
      // Verify meta is properly formatted
      if (!messagePayload.meta || !messagePayload.meta.senderPublicKey) {
        console.error("🚨 CRITICAL: senderPublicKey is missing from message payload!");
        toast.error("⚠️ Encryption error: Missing public key in message");
        return;
      }
      
      console.log("📤 Emitting sendMessage with payload:", {
        receiverId: messagePayload.receiverId,
        ciphertextLength: messagePayload.ciphertext.length,
        hasMeta: !!messagePayload.meta,
        hasSenderPublicKey: !!messagePayload.meta.senderPublicKey,
        senderPublicKeyLength: messagePayload.meta.senderPublicKey?.length,
        senderPublicKeyPreview: messagePayload.meta.senderPublicKey?.substring(0, 50),
        tempId
      });
      
      // Save pending plaintext so we can auto-resend if server rejects due to recipient lacking private key
      pendingLastMessageRef.current = { receiverId: other._id, plaintext: text, tempId };
      // Clear pending after a short window (server should respond quickly if there's an error)
      setTimeout(() => { if (pendingLastMessageRef.current && pendingLastMessageRef.current.receiverId === other._id) pendingLastMessageRef.current = null; }, 3000);

      socket.emit("sendMessage", messagePayload);
      
      console.log("✅ Message sent with senderPublicKey in meta");

      setText("");
    } catch (err) {
      console.error("❌ Failed to send", err);
      console.error("Error details:", err.message, err.stack);
      toast.error("⚠️ Failed to send message. Check console for details.", {
        autoClose: 3000
      });
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
        {/* Regenerate keys (always visible; disabled when Web Crypto unavailable) */}
        <button
          className={`text-sm mr-3 ${window.crypto && window.crypto.subtle ? 'text-gray-600 hover:underline' : 'text-gray-400 cursor-not-allowed'}`}
          onClick={async () => {
            if (!(window.crypto && window.crypto.subtle)) {
              toast.info(
                '🔒 Web Crypto not available here. To generate keys, use a secure context (HTTPS or localhost) or regenerate on another device and upload the public key.',
                { autoClose: 6000 }
              );
              return;
            }

            try {
              const { privB64, pubB64 } = await generateECDHKeyPair();
              await api.post('/api/auth/uploadKey', { ecdhPublicKey: pubB64 });
              toast.success('🔑 Keys regenerated and uploaded', { autoClose: 3000 });
              console.log('✅ Keys regenerated and uploaded');
              // Notify server of new capability
              try {
                socket && socket.emit('capabilities', { hasPrivateKey: true, hasWebCrypto: !!(window.crypto && window.crypto.subtle) });
                console.log('⚙️ Capabilities updated (hasPrivateKey=true)');
              } catch (e) {
                console.warn('⚠️ Failed to emit capabilities after regenerate:', e.message);
              }
            } catch (err) {
              console.error('❌ Regenerate keys failed:', err);
              toast.error('⚠️ Failed to regenerate keys. See console for details.', { autoClose: 4000 });
            }
          }}
          title={window.crypto && window.crypto.subtle ? 'Regenerate encryption keys' : 'Web Crypto not available on this page'}
        >
          🔑 Regenerate
        </button>

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
      {!hasRecipientKey && (
        <div className="p-2 text-sm text-yellow-800 bg-yellow-50 border-t border-yellow-200 text-center">
          ⚠️ {other.displayName || other.username} does not have an encryption key. Messages will be sent unencrypted.
        </div>
      )}

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
    </div>
  );
}
