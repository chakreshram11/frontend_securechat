// frontend/src/components/GroupChatWindow.jsx
import React, { useEffect, useState, useRef } from "react";
import api from "../services/api";
import * as cryptoLib from "../lib/crypto";
import { toast } from "react-toastify";
import { loadLocalPrivateKey } from "./ChatWindow";

export default function GroupChatWindow({ group, socket, myUserId }) {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [memberKeys, setMemberKeys] = useState({}); // userId -> AES key
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef();
  const pendingMessagesRef = useRef({}); // memberId -> { tempId, plaintext, ciphertext }

  const appendNewMessage = (m) => setHistory((prev) => [...prev, m]);

  /* ---------- Join group room and load history ---------- */
  useEffect(() => {
    if (!socket || !group) return;

    // Join the group room
    socket.emit("joinGroup", String(group._id));

    (async () => {
      try {
        setLoading(true);

        // Load group message history
        const { data } = await api.get(`/api/messages/group/${String(group._id)}`);
        
        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          console.warn("⚠️ Missing local private key - proceeding without decryption. Group will show unencrypted or placeholder messages.");
          // Non-blocking warning removed (silent fallback to ChatWindow behavior)
          // continue without returning; myPriv will be null and decryption attempts will be skipped
        }

        // Decrypt messages
        const decrypted = await Promise.all(
          data.map(async (m) => {
            if (!m.ciphertext) {
              return {
                ...m,
                plaintext: "[No ciphertext]",
                isMe: String(m.senderId?._id || m.senderId) === String(myUserId),
                senderName: m.senderId?.displayName || m.senderId?.username || "Unknown",
              };
            }

            const senderId = m.senderId?._id || m.senderId;
            const isMe = String(senderId) === String(myUserId);
            let plaintext = null;
            let senderName = m.senderId?.displayName || m.senderId?.username || "Unknown";

            // If this message is explicitly unencrypted, treat as plaintext
            if (m.meta?.unencrypted) {
              return {
                ...m,
                plaintext: m.ciphertext,
                isMe,
                senderName,
              };
            }

            // If ciphertext is very short, treat as plaintext (backwards compatibility)
            if (m.ciphertext.length < 29) {
              return {
                ...m,
                plaintext: m.ciphertext,
                isMe,
                senderName,
              };
            }

            // If we don't have a local private key, we cannot decrypt encrypted messages
            if (!myPriv) {
              console.warn('⚠️ Cannot decrypt group message (no local private key) - showing placeholder');
              return {
                ...m,
                plaintext: "[Encrypted - no key]",
                isMe,
                senderName,
              };
            }

            // Strategy 1: Try cached AES key for this sender
            if (senderId) {
              const cachedKeyB64 = cryptoLib.loadAesKeyForUser(senderId);
              if (cachedKeyB64) {
                try {
                  const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
                  plaintext = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
                  console.log("✅ Group message decrypted using cached key");
                  setMemberKeys((prev) => ({ ...prev, [senderId]: cachedKey }));
                  return {
                    ...m,
                    plaintext,
                    isMe,
                    senderName,
                  };
                } catch (cachedErr) {
                  console.warn("⚠️ Cached key failed for group message");
                }
              }
            }

            // Strategy 2: Use sender's public key from message meta
            if (m.meta?.senderPublicKey) {
              try {
                const { aesKey: derived, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  m.meta.senderPublicKey
                );
                plaintext = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                if (senderId) {
                  cryptoLib.saveAesKeyForUser(senderId, rawKeyBase64);
                  setMemberKeys((prev) => ({ ...prev, [senderId]: derived }));
                }
                console.log("✅ Group message decrypted using sender's key from meta");
                return {
                  ...m,
                  plaintext,
                  isMe,
                  senderName,
                };
              } catch (metaErr) {
                console.warn("⚠️ Sender's key from meta failed for group message");
              }
            }

            // Strategy 3: Fetch sender's current public key from server
            if (senderId && !isMe) {
              try {
                const { data: senderUser } = await api.get(`/api/users/${senderId}`);
                if (senderUser?.ecdhPublicKey) {
                  const { aesKey: derived, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                    myPriv,
                    senderUser.ecdhPublicKey
                  );
                  plaintext = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                  cryptoLib.saveAesKeyForUser(senderId, rawKeyBase64);
                  setMemberKeys((prev) => ({ ...prev, [senderId]: derived }));
                  senderName = senderUser.displayName || senderUser.username || "Unknown";
                  console.log("✅ Group message decrypted using sender's current key");
                  return {
                    ...m,
                    plaintext,
                    isMe,
                    senderName,
                  };
                }
              } catch (fetchErr) {
                console.warn("⚠️ Failed to fetch sender's key for group message");
              }
            }

            // All strategies failed
            console.error("❌ All decryption attempts failed for group message:", {
              id: m._id || m.id,
              senderId,
              isMe,
              hasMeta: !!m.meta,
              hasSenderPublicKey: !!m.meta?.senderPublicKey
            });
            return {
              ...m,
              plaintext: "[Decryption Error]",
              isMe,
              senderName,
            };
          })
        );

        // Merge pending messages (per-member) so locally-sent pending items are not lost
        const pendingEntries = Object.values(pendingMessagesRef.current || {}).map(p => ({
          tempId: p.tempId,
          senderId: myUserId,
          groupId: String(group._id),
          plaintext: p.plaintext,
          ciphertext: p.ciphertext,
          type: 'text',
          createdAt: new Date(),
          isMe: true,
          senderName: 'You'
        }));

        const merged = [...decrypted];
        pendingEntries.forEach(pe => {
          const exists = merged.some(d => d.ciphertext === pe.ciphertext || d.tempId === pe.tempId);
          if (!exists) merged.push(pe);
        });

        setHistory(merged);
      } catch (err) {
        console.error("❌ Error loading group chat:", err);
        toast.error("Failed to load group messages");
      } finally {
        setLoading(false);
      }
    })();

    // Cleanup: leave group room
    return () => {
      socket.emit("leaveGroup", String(group._id));
    };
  }, [group, socket, myUserId]);

  /* ---------- Incoming messages ---------- */
  useEffect(() => {
    if (!socket || !group) return;

    const handler = async (m) => {
      try {
        // Only process messages for this group
        if (String(m.groupId) !== String(group._id)) return;
        if (!m.ciphertext) return;

        const isMe = String(m.senderId) === String(myUserId);

        // If message is explicitly unencrypted, show plaintext immediately
        if (m.meta?.unencrypted || (m.ciphertext && m.ciphertext.length < 29)) {
          let senderName = "Unknown";
          if (m.senderId && !isMe) {
            try {
              const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
              senderName = senderUser.displayName || senderUser.username || "Unknown";
            } catch (err) {
              console.warn("Failed to fetch sender name for plaintext message:", err.message);
            }
          } else if (isMe) {
            try {
              const { data: me } = await api.get('/api/users/me');
              senderName = me.displayName || me.username || 'You';
            } catch (err) {
              senderName = 'You';
            }
          }

          appendNewMessage({
            ...m,
            plaintext: m.ciphertext,
            isMe,
            senderName,
          });
          return;
        }

        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          appendNewMessage({
            ...m,
            plaintext: "[Encrypted - no key]",
            isMe,
            senderName: "Unknown",
          });
          return;
        }

        let text = "[Decryption Error]";
        let senderName = "Unknown";


        // If this is an echoed copy of a message we just sent, and we have a pending entry, update instead of appending duplicate
        if (String(m.senderId) === String(myUserId)) {
          // check both per-member pending and group broadcast pending
          const pendingMember = pendingMessagesRef.current[String(myUserId)];
          const pendingBroadcast = pendingMessagesRef.current[`${group._id}:${myUserId}`];
          const pending = (pendingMember && pendingMember.ciphertext === m.ciphertext) ? pendingMember : (pendingBroadcast && pendingBroadcast.ciphertext === m.ciphertext) ? pendingBroadcast : null;
          if (pending) {
            // Update the pending message in-place: remove tempId and keep server ciphertext/createdAt
            setHistory((prev) => prev.map((msg) => {
              if (msg.tempId && msg.tempId === pending.tempId) {
                return {
                  ...msg,
                  ciphertext: m.ciphertext,
                  meta: { ...(msg.meta || {}), ...m.meta },
                  createdAt: m.createdAt || msg.createdAt,
                  tempId: undefined
                };
              }
              return msg;
            }));
            // Clear pending for self (both keys)
            delete pendingMessagesRef.current[String(myUserId)];
            delete pendingMessagesRef.current[`${group._id}:${myUserId}`];
            return; // don't continue to append duplicate
          }
        }

        // Try to decrypt using senderPublicKey in meta first
        let triedMeta = false;
        if (m.meta?.senderPublicKey) {
          triedMeta = true;
          try {
            const { aesKey: derived } = await cryptoLib.deriveSharedAESKey(
              myPriv,
              m.meta.senderPublicKey
            );
            text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);

            // Cache the key
            if (m.senderId) {
              const { rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                myPriv,
                m.meta.senderPublicKey
              );
              cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
              setMemberKeys((prev) => ({ ...prev, [m.senderId]: derived }));
            }

            // Fetch sender name
            if (m.senderId && !isMe) {
              try {
                const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
                senderName = senderUser.displayName || senderUser.username || "Unknown";
              } catch (err) {
                console.warn("Failed to fetch sender name:", err);
              }
            } else if (isMe) {
              try {
                const { data: me } = await api.get("/api/users/me");
                senderName = me.displayName || me.username || "You";
              } catch (err) {
                senderName = "You";
              }
            }
          } catch (err) {
            console.error("❌ Decryption with meta.senderPublicKey failed:", err);
          }
        }

        // If meta-based decryption failed (or meta missing), try fetching sender's current key
        if (!text && m.senderId && !isMe) {
          try {
            const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
            if (senderUser?.ecdhPublicKey) {
              try {
                const { aesKey: derived } = await cryptoLib.deriveSharedAESKey(myPriv, senderUser.ecdhPublicKey);
                text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                // Cache
                const { rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(myPriv, senderUser.ecdhPublicKey);
                cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                setMemberKeys((prev) => ({ ...prev, [m.senderId]: derived }));
                senderName = senderUser.displayName || senderUser.username || "Unknown";
                console.log("✅ Group incoming message decrypted using fetched sender key");
              } catch (innerErr) {
                console.warn("⚠️ Decryption using fetched sender key failed:", innerErr);
              }
            }
          } catch (fetchErr) {
            console.warn("⚠️ Failed to fetch sender's key for incoming message:", fetchErr);
          }
        }

        appendNewMessage({
          ...m,
          plaintext: text,
          isMe,
          senderName,
        });
      } catch (err) {
        console.error("❌ Failed to handle incoming message:", err);
      }
    };

    socket.on("message", handler);
    
    // Handle send errors from the server
    const errorHandler = (error) => {
      console.error("❌ Server rejected message:", error);

      // Handle recipient_no_private_key for group sends: auto-resend unencrypted to that member
      if (error?.reason === 'recipient_no_private_key' && error?.receiverId) {
        const rid = String(error.receiverId);
        const pending = pendingMessagesRef.current[rid];
        if (pending && pending.tempId) {
          // Update the pending message in-place (mark unencrypted)
          setHistory((prev) => prev.map((msg) => {
            if (msg.tempId && msg.tempId === pending.tempId) {
              return {
                ...msg,
                ciphertext: pending.plaintext,
                meta: { ...(msg.meta || {}), unencrypted: true },
                tempId: undefined
              };
            }
            return msg;
          }));

          // Emit unencrypted message for that member
          socket.emit('sendMessage', {
            receiverId: rid,
            groupId: String(group._id),
            ciphertext: pending.plaintext,
            type: 'text',
            meta: { unencrypted: true }
          });

          // Clear pending
          delete pendingMessagesRef.current[rid];

          // Silent resend - no toast (UI shows updated message)
          return;
        } else {
          // No pending entry for that receiver - inform the sender to retry manually
          toast.error('Recipient cannot decrypt encrypted messages; please resend to that member without encryption.');
          return;
        }
      }

      toast.error(`❌ Message failed: ${error.message || error.reason}`);
    };
    
    socket.on("errorSending", errorHandler);
    
    return () => {
      socket.off("message", handler);
      socket.off("errorSending", errorHandler);
    };
  }, [socket, group, myUserId]);

  /* ---------- Auto-scroll ---------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  /* ---------- Send message ---------- */
  async function send() {
    if (!text.trim()) return;

    try {
      // Create a broadcast pending entry so the message appears immediately even before per-member encryption completes
      const broadcastTempId = `pending:group:${group._id}:${Date.now()}`;
      pendingMessagesRef.current[`${group._id}:${myUserId}`] = { tempId: broadcastTempId, plaintext: text, ciphertext: null };
      appendNewMessage({
        tempId: broadcastTempId,
        senderId: myUserId,
        groupId: String(group._id),
        plaintext: text,
        ciphertext: text,
        type: 'text',
        createdAt: new Date(),
        isMe: true,
        senderName: 'You',
      });

      let myPublicKey = cryptoLib.getLocalPublicKey();
      if (!myPublicKey) {
        // Try to obtain our public key from server as a fallback
        try {
          const { data: me } = await api.get('/api/users/me');
          if (me?.ecdhPublicKey) {
            myPublicKey = me.ecdhPublicKey;
            console.warn('Using server-stored public key as fallback');
          }
        } catch (err) {
          console.warn('Failed to fetch own public key from server as fallback', err);
        }
      }

      if (!myPublicKey) {
        // Do not block send — fall back to sending a single unencrypted broadcast to the group
        console.warn('⚠️ No public key available locally; falling back to sending unencrypted group message');
        const tempId = `pending:group:${group._id}:${Date.now()}`;
        pendingMessagesRef.current[`${group._id}:${myUserId}`] = { tempId, plaintext: text, ciphertext: text };
        appendNewMessage({
          tempId,
          senderId: myUserId,
          groupId: String(group._id),
          plaintext: text,
          ciphertext: text,
          type: 'text',
          createdAt: new Date(),
          isMe: true,
          senderName: 'You',
        });

        socket.emit('sendMessage', {
          groupId: String(group._id),
          ciphertext: text,
          type: 'text',
          meta: { unencrypted: true }
        });

        setText('');
        return;
      }

      const myPriv = await loadLocalPrivateKey();
      if (!myPriv) {
        // We can't perform per-recipient encryption without the private key — fall back to unencrypted broadcast
        console.warn('⚠️ No local private key available; falling back to sending unencrypted group message');
        const tempId2 = `pending:group:${group._id}:${Date.now()}`;
        pendingMessagesRef.current[`${group._id}:${myUserId}`] = { tempId: tempId2, plaintext: text, ciphertext: text };
        appendNewMessage({
          tempId: tempId2,
          senderId: myUserId,
          groupId: String(group._id),
          plaintext: text,
          ciphertext: text,
          type: 'text',
          createdAt: new Date(),
          isMe: true,
          senderName: 'You',
        });

        socket.emit('sendMessage', {
          groupId: String(group._id),
          ciphertext: text,
          type: 'text',
          meta: { unencrypted: true }
        });

        setText('');
        return;
      }

      // For group messages we must create a ciphertext per recipient so each member
      // can decrypt using their private key + senderPublicKey. We loop members,
      // derive a per-recipient AES key and emit a separate message for each member.
      if (!group.members || group.members.length === 0) {
        toast.warning("⚠️ Group has no members to send to.");
        return;
      }

      // Fetch all members' public keys and encrypt per-member
      for (const member of group.members) {
        const memberId = typeof member === 'object' ? member._id : member;
        if (!memberId) continue;

        try {
          const { data: memberUser } = await api.get(`/api/users/${memberId}`);
          const memberPub = memberUser?.ecdhPublicKey;
          if (!memberPub) {
            console.warn(`Skipping member ${memberId} - no public key`);
            continue;
          }

          const { aesKey } = await cryptoLib.deriveSharedAESKey(myPriv, memberPub);
          const cForMember = await cryptoLib.encryptWithAesKey(aesKey, text);

          socket.emit("sendMessage", {
            receiverId: memberId,
            groupId: String(group._id),
            ciphertext: cForMember,
            type: "text",
            meta: {
              senderPublicKey: myPublicKey,
            },
          });

          // If this copy is for us, append it locally so sender sees immediate send
          const tempId = `pending:${memberId}:${Date.now()}`;
          // Save pending per-member so we can handle server-side rejects/resend
          pendingMessagesRef.current[memberId] = { tempId, plaintext: text, ciphertext: cForMember };

          if (String(memberId) === String(myUserId)) {
            // Append with tempId so we can update instead of duplicating when server echoes back
            appendNewMessage({
              tempId,
              senderId: myUserId,
              groupId: String(group._id),
              plaintext: text,
              ciphertext: cForMember,
              type: "text",
              createdAt: new Date(),
              isMe: true,
              senderName: "You",
            });
          }
        } catch (err) {
          console.warn("Failed to encrypt/send to member:", memberId, err);
        }
      }

      setText("");
    } catch (err) {
      console.error("❌ Failed to send:", err);
      toast.error("Failed to send message");
    }
  }

  /* ---------- File upload ---------- */
  async function handleFiles(files) {
    if (!files.length) return;
    
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
              groupId: String(group._id),
              plaintext: isImage ? "🖼️ Image" : `📎 ${file.name}`,
              type: "file",
              meta: { url, name: file.name, isImage },
              createdAt: new Date(),
              isMe: true,
              senderName: "You",
            });

            let myPublicKey = cryptoLib.getLocalPublicKey();
            const myPriv = await loadLocalPrivateKey();
            if (!myPublicKey) {
              try {
                const { data: me } = await api.get('/api/users/me');
                if (me?.ecdhPublicKey) myPublicKey = me.ecdhPublicKey;
              } catch (err) {
                console.warn('Failed to fetch own public key for file send fallback', err);
              }
            }

            if (myPriv && myPublicKey && group.members) {
              for (const member of group.members) {
                const memberId = typeof member === 'object' ? member._id : member;
                if (!memberId) continue;

                try {
                  const { data: memberUser } = await api.get(`/api/users/${memberId}`);
                  const memberPub = memberUser?.ecdhPublicKey;
                  if (!memberPub) continue;

                  const { aesKey } = await cryptoLib.deriveSharedAESKey(myPriv, memberPub);
                  const cForMember = await cryptoLib.encryptWithAesKey(aesKey, `File: ${file.name}`);

                  socket.emit("sendMessage", {
                    receiverId: memberId,
                    groupId: String(group._id),
                    ciphertext: cForMember,
                    type: "text",
                    meta: {
                      senderPublicKey: myPublicKey,
                    },
                  });
                } catch (err) {
                  console.warn("Failed to encrypt/send file message to member:", memberId, err);
                }
              }
            }
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
        <span>👥 {group.name}</span>
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
                  {!m.isMe && (
                    <div className="text-xs font-semibold mb-1 opacity-80">
                      {m.senderName}
                    </div>
                  )}
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
                  <div className="text-xs opacity-70 mt-1">
                    {new Date(m.createdAt).toLocaleTimeString()}
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








