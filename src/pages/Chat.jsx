// frontend/src/pages/Chat.jsx
import React, { useEffect, useState, useRef } from "react";
import api, { setToken } from "../services/api";
import io from "socket.io-client";
import ChatWindow from "../components/ChatWindow";
import GroupChatWindow from "../components/GroupChatWindow";
import AdminPanel from "../pages/AdminPanel";
import { Menu } from "lucide-react";
import { toast } from "react-toastify";

export default function Chat({ token, onLogout }) {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [currentUser, setCurrentUser] = useState(null); // ✅ logged-in user
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [systemMessages, setSystemMessages] = useState([]); // ✅ For optional welcome messages
  const socketRef = useRef();

 useEffect(() => {
  setToken(token);

  let mounted = true;
  const currentUserRef = { current: null }; // will be updated below

  async function init() {
    try {
      const { data: me } = await api.get("/api/users/me");
      if (!mounted) return;
      setCurrentUser(me);
      currentUserRef.current = me;

      const { data: allUsers } = await api.get("/api/users");
      if (!mounted) return;
      setUsers(allUsers);

      // Load groups the user is a member of
      const { data: userGroups } = await api.get("/api/users/groups/mine");
      if (!mounted) return;
      setGroups(userGroups);
    } catch (err) {
      console.error("Failed to load users/groups", err);
      
      // Check if it's a network error vs auth error
      if (!err.response) {
        // Network error
        toast.error("❌ Cannot reach backend server. Please check your connection and try again.", {
          autoClose: false,
          closeButton: true
        });
      } else if (err.response.status === 401) {
        // Unauthorized - token expired
        console.log("🔑 Token expired, logging out");
        onLogout();
      }
    }
  }
  init();

  // Determine socket server URL (same logic as API client)
  const getSocketUrl = () => {
    const envBase = import.meta.env.VITE_API_BASE;
    if (envBase && envBase.trim()) {
      return envBase;
    }
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:5000";
    }
    return `${protocol}//${hostname}:5000`;
  };

  const socket = io(getSocketUrl(), {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });
  socketRef.current = socket;

  // Report client capabilities (hasPrivateKey, hasWebCrypto) once connected
  (async () => {
    try {
      const hasWebCrypto = !!(window.crypto && window.crypto.subtle);
      let hasPrivateKey = false;
      if (hasWebCrypto && localStorage.getItem('ecdhPrivateKey')) {
        try {
          const raw = Uint8Array.from(atob(localStorage.getItem('ecdhPrivateKey')), c => c.charCodeAt(0)).buffer;
          await window.crypto.subtle.importKey('pkcs8', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
          hasPrivateKey = true;
        } catch (e) {
          console.warn('⚠️ Found stored private key but import failed:', e.message);
          hasPrivateKey = false;
        }
      }
      socket.emit('capabilities', { hasPrivateKey, hasWebCrypto });
      console.log('⚙️ Capabilities reported to server:', { hasPrivateKey, hasWebCrypto });
    } catch (err) {
      console.warn('⚠️ Failed to report capabilities:', err.message);
    }
  })();

  // Handlers (named so cleanup works reliably)
  const onUserNew = (newUser) => {
    console.log("👤 New user joined:", newUser);
    setUsers((prev) => {
      if (prev.some((u) => u._id === newUser._id)) return prev;
      return [...prev, newUser];
    });
  };

  const onUserAdded = onUserNew; // support multiple event names
  const onUserUpdated = (updated) => {
    console.log("🔁 user updated:", updated);
    setUsers((prev) => prev.map((u) => (u._id === updated._id ? { ...u, ...updated } : u)));
    // If the updated user is the current user, refresh currentUser
    if (currentUserRef.current && String(currentUserRef.current._id) === String(updated._id)) {
      setCurrentUser((prev) => ({ ...prev, ...updated }));
      currentUserRef.current = { ...currentUserRef.current, ...updated };
    }
  };

  const onUserDeleted = (deleted) => {
    console.log("🗑️ User deleted:", deleted);
    if (currentUserRef.current && String(currentUserRef.current._id) === String(deleted._id)) {
      // If our own account was removed -> force logout
      // Keep this simple and non-modal — you can change to toast/redirect
      alert("⚠️ Your account has been removed by an admin.");
      handleLogout();
    } else {
      setUsers((prev) => prev.filter((u) => u._id !== deleted._id));
      // if currently selected user was deleted, clear selection
      setSelectedUser((sel) => (sel && sel._id === deleted._id ? null : sel));
    }
  };

  const onOnlineUsers = ({ online, lastSeen }) => {
    setOnlineUsers(online || []);
    setLastSeen(lastSeen || {});
  };

  const onMessage = (msg) => {
    // handle only system messages here; ChatWindow will handle normal user messages
    if (msg?.type === "system") {
      console.log("💬 System message:", msg.ciphertext);
      toast.info(`💬 ${msg.ciphertext}`, {
        toastId: msg._id || `system-${(msg.createdAt || Date.now())}`,
        position: "top-right",
        autoClose: 5000,
      });
    }
  };

  const onGroupAdded = async () => {
    console.log("👥 Group added, refreshing groups...");
    try {
      const { data: userGroups } = await api.get("/api/users/groups/mine");
      if (mounted) {
        setGroups(userGroups);
      }
    } catch (err) {
      console.error("Failed to refresh groups", err);
    }
  };

  const onGroupUpdated = async () => {
    console.log("👥 Group updated, refreshing groups...");
    try {
      const { data: userGroups } = await api.get("/api/users/groups/mine");
      if (mounted) {
        setGroups(userGroups);
        // If the updated group is currently selected, refresh it
        if (selectedGroup) {
          const updatedGroup = userGroups.find(g => g._id === selectedGroup._id);
          if (updatedGroup) {
            setSelectedGroup(updatedGroup);
          }
        }
      }
    } catch (err) {
      console.error("Failed to refresh groups", err);
    }
  };

  const onGroupDeleted = (deleted) => {
    console.log("🗑️ Group deleted:", deleted);
    setGroups((prev) => prev.filter((g) => g._id !== deleted.id));
    // If the deleted group was selected, clear selection
    if (selectedGroup && selectedGroup._id === deleted.id) {
      setSelectedGroup(null);
      setSelectedUser(null);
    }
  };

  // reconnect handler: re-fetch users and groups to avoid missing state
  const onReconnect = async () => {
    console.log("🔄 Socket reconnected, refreshing user list and groups...");
    try {
      const { data: allUsers } = await api.get("/api/users");
      setUsers(allUsers);
      const { data: userGroups } = await api.get("/api/users/groups/mine");
      setGroups(userGroups);
    } catch (err) {
      console.error("Failed to refresh users/groups after reconnect", err);
    }
  };

  // Register listeners (support several event names so server/both sides are fine)
  socket.on("user:new", onUserNew);
  socket.on("userAdded", onUserAdded);
  socket.on("user:added", onUserAdded);

  socket.on("user:updated", onUserUpdated);
  socket.on("userUpdated", onUserUpdated);

  socket.on("user:deleted", onUserDeleted);
  socket.on("userDeleted", onUserDeleted);

  socket.on("onlineUsers", onOnlineUsers);
  socket.on("message", onMessage);
  socket.on("groupAdded", onGroupAdded);
  socket.on("groupUpdated", onGroupUpdated);
  socket.on("groupDeleted", onGroupDeleted);

  socket.io.on("reconnect", onReconnect);

  // keep currentUserRef in sync whenever state changes
  const unsubscribeCurrentUser = () => {};
  // Note: easier to update ref inside any setCurrentUser call site in this file:
  // after you call setCurrentUser(me) earlier we set the ref. But also add this effect:
  // (we'll update the ref via a small helper below)

  // Cleanup
  return () => {
    mounted = false;
    socket.off("user:new", onUserNew);
    socket.off("userAdded", onUserAdded);
    socket.off("user:added", onUserAdded);
    socket.off("user:updated", onUserUpdated);
    socket.off("userUpdated", onUserUpdated);
    socket.off("user:deleted", onUserDeleted);
    socket.off("userDeleted", onUserDeleted);
    socket.off("onlineUsers", onOnlineUsers);
    socket.off("message", onMessage);
    socket.off("groupAdded", onGroupAdded);
    socket.off("groupUpdated", onGroupUpdated);
    socket.off("groupDeleted", onGroupDeleted);
    socket.io.off("reconnect", onReconnect);
    socket.disconnect();
    // ensure ref cleared
    currentUserRef.current = null;
    unsubscribeCurrentUser();
  };
}, [token]); // keep dependency on token only



  function handleLogout() {
    localStorage.removeItem("token");
    onLogout();
  }

  function formatLastSeen(ts) {
    if (!ts) return "offline";
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (diff < 60) return "last seen just now";
    if (diff < 3600) return `last seen ${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `last seen ${Math.floor(diff / 3600)}h ago`;
    return `last seen ${Math.floor(diff / 86400)}d ago`;
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 bg-white w-72 border-r p-4 z-40 transform transition-transform lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <h3 className="font-bold mb-3">Users</h3>
        <div className="space-y-2 flex-1 overflow-y-auto mb-4">
          {users.map((u) => {
  const isOnline = onlineUsers.includes(u._id);
  const isMe = currentUser?._id === u._id;

  return (
    <div
      key={u._id}
      className={`p-2 border rounded cursor-pointer transition-all ${
        isMe
          ? "bg-blue-50 border-blue-300" // 👤 highlight current user
          : selectedUser?._id === u._id
          ? "bg-gray-100"
          : "hover:bg-gray-50"
      }`}
      onClick={() => {
        if (!isMe) {
          setSelectedUser(u);
          setSelectedGroup(null);
          setShowAdminPanel(false);
          setSidebarOpen(false);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-1">
          {u.displayName || u.username}
          {isMe && (
            <span className="text-xs text-blue-600 font-medium">(You)</span>
          )}
        </div>
        <span
          className={`h-3 w-3 rounded-full ${
            isOnline ? "bg-green-500" : "bg-gray-400"
          }`}
          title={isOnline ? "Online" : formatLastSeen(lastSeen[u._id])}
        ></span>
      </div>
      <div
        className={`text-xs ${
          isOnline ? "text-green-600" : "text-gray-500"
        } mt-0.5`}
      >
        {isOnline ? "🟢 Online" : formatLastSeen(lastSeen[u._id])}
      </div>
    </div>
  );
})}

        </div>

        {/* Groups Section */}
        <h3 className="font-bold mb-3 mt-4">Groups</h3>
        <div className="space-y-2 flex-1 overflow-y-auto mb-4">
          {groups.length === 0 ? (
            <div className="text-sm text-gray-500 p-2">No groups yet</div>
          ) : (
            groups.map((g) => (
              <div
                key={g._id}
                className={`p-2 border rounded cursor-pointer transition-all ${
                  selectedGroup?._id === g._id
                    ? "bg-blue-100 border-blue-300"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => {
                  setSelectedGroup(g);
                  setSelectedUser(null);
                  setShowAdminPanel(false);
                  setSidebarOpen(false);
                }}
              >
                <div className="font-semibold">👥 {g.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {g.members?.length || 0} members
                </div>
              </div>
            ))
          )}
        </div>

        {/* ✅ Admin-only panel access */}
        {currentUser?.role === "admin" && (
          <div className="mt-4">
            <button
              className="bg-green-600 text-white px-3 py-2 rounded w-full"
              onClick={() => {
                setShowAdminPanel(true);
                setSelectedUser(null);
                setSelectedGroup(null);
                setSidebarOpen(false);
              }}
            >
              Open Admin Panel
            </button>
          </div>
        )}

        {/* Logout */}
        <div className="mt-4">
          <button
            className="bg-red-500 text-white px-3 py-2 rounded w-full"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 w-full bg-white border-b flex items-center justify-between p-3 z-50">
        <button
          className="p-2 rounded hover:bg-gray-100"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={24} />
        </button>
        <h2 className="font-bold">Secure Chat</h2>
      </div>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 overflow-y-auto mt-12 lg:mt-0">
        {/* Optional: show global system messages (like welcome) */}
        {systemMessages.length > 0 && (
          <div className="mb-4 bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-gray-700">
            {systemMessages.map((m, i) => (
              <div key={i}>💬 {m.ciphertext}</div>
            ))}
          </div>
        )}

        {showAdminPanel ? (
          <AdminPanel />
        ) : selectedGroup ? (
          <GroupChatWindow
            group={selectedGroup}
            socket={socketRef.current}
            myUserId={currentUser?._id}
          />
        ) : selectedUser ? (
          <ChatWindow
            other={selectedUser}
            socket={socketRef.current}
            myUserId={currentUser?._id}
          />
        ) : (
          <div className="text-gray-500">Select a user or group to chat</div>
        )}
      </main>
    </div>
  );
}
