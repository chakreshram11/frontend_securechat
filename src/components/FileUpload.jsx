import React, { useState, useRef } from 'react';
import { Paperclip, Upload, File, X, Check } from 'lucide-react';
import { uploadFile, listFiles, deleteFile } from '../services/api';
import { toast } from 'react-toastify';
import * as cryptoLib from '../lib/crypto';

export default function FileUpload({ onFileUploaded, socket, myUserId, otherUserId, groupId, aesKey }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;

    setUploading(true);

    try {
      for (const file of selectedFiles) {
        const result = await uploadFile(file);

        // Show success toast with file info
        toast.success(`📁 ${file.name} uploaded successfully!`, {
          autoClose: 3000,
          position: "top-right"
        });

        // Send file notification
        if (socket && myUserId && (otherUserId || groupId)) {
          const hasWebCrypto = window.crypto && window.crypto.subtle;
          const myPublicKey = cryptoLib.getLocalPublicKey();
          const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(result.filename);

          // For groups, always send unencrypted
          if (groupId) {
            console.log('📤 Sending file to group:', groupId);
            socket.emit("sendMessage", {
              groupId: String(groupId),
              // No receiverId for group messages
              ciphertext: isImage ? `🖼️ Image: ${result.filename}` : `📎 ${result.filename}`,
              type: "file",
              meta: {
                unencrypted: true,
                url: result.url,
                name: result.filename,
                isImage: isImage,
                senderPublicKey: myPublicKey || null,
              },
            });
            console.log(`📤 File notification sent to group:${groupId}: ${result.filename}`);
          } else if (hasWebCrypto && aesKey && myPublicKey) {
            // DM with encryption
            try {
              const fileMessage = `📎 ${result.filename}`;
              const encryptedMessage = await cryptoLib.encryptWithAesKey(aesKey, fileMessage);

              socket.emit("sendMessage", {
                receiverId: otherUserId,
                ciphertext: encryptedMessage,
                type: "file",
                meta: {
                  senderPublicKey: myPublicKey,
                  fileInfo: {
                    name: result.filename,
                    url: result.url,
                    isImage: isImage
                  }
                },
              });

              console.log(`📤 File notification sent (encrypted) to ${otherUserId}: ${result.filename}`);
            } catch (encryptError) {
              console.warn('⚠️ Encryption failed, sending unencrypted:', encryptError.message);
              // Fallback: send unencrypted
              socket.emit("sendMessage", {
                receiverId: otherUserId,
                ciphertext: `📎 ${result.filename}`,
                type: "file",
                meta: {
                  unencrypted: true,
                  fileInfo: {
                    name: result.filename,
                    url: result.url,
                    isImage: isImage
                  }
                },
              });
              console.log(`📤 File notification sent (unencrypted fallback) to ${otherUserId}`);
            }
          } else {
            // DM without encryption
            console.log('⚠️ Web Crypto not available or no AES key, sending unencrypted file notification');
            socket.emit("sendMessage", {
              receiverId: otherUserId,
              ciphertext: `📎 ${result.filename}`,
              type: "file",
              meta: {
                unencrypted: true,
                fileInfo: {
                  name: result.filename,
                  url: result.url,
                  isImage: isImage
                }
              },
            });
            console.log(`📤 File notification sent (unencrypted) to ${otherUserId}: ${result.filename}`);
          }
        }

        if (onFileUploaded) {
          onFileUploaded({
            filename: result.filename,
            url: result.url,
            fileId: result.fileId
          });
        }
        // Refresh file list
        const updatedFiles = await listFiles();
        setFiles(updatedFiles);
      }
    } catch (error) {
      console.error('File upload error:', error);
      toast.error(`❌ File upload failed: ${error.message || 'Unknown error'}`, {
        autoClose: 5000,
        position: "top-right"
      });
    } finally {
      setUploading(false);
      e.target.value = ''; // Reset file input
    }
  };

  const handleDeleteFile = async (filename) => {
    try {
      await deleteFile(filename);
      const updatedFiles = await listFiles();
      setFiles(updatedFiles);
      toast.success('File deleted successfully');
    } catch (error) {
      console.error('File delete error:', error);
      toast.error('File deletion failed');
    }
  };

  const toggleFileList = async () => {
    if (!showFileList) {
      try {
        const fileList = await listFiles();
        setFiles(fileList);
      } catch (error) {
        console.error('Failed to load files:', error);
        toast.error('Failed to load files');
      }
    }
    setShowFileList(!showFileList);
  };

  return (
    <div className="mb-4">
      {/* File upload button - single button that opens file picker */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => fileInputRef.current.click()}
          disabled={uploading}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          title="Upload and manage files"
        >
          <Paperclip size={20} className="text-gray-600 dark:text-gray-300" />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="*"
        />
      </div>

      {/* File list modal */}
      {showFileList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">Shared Files</h3>
              <button
                onClick={() => setShowFileList(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {files.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Upload size={48} className="mx-auto mb-2" />
                <p>No files uploaded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded">
                        <File className="text-blue-600 dark:text-blue-300" size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 dark:text-white truncate">
                          {file.name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {formatFileSize(file.size)} • {formatDate(file.lastModified)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <a
                        href={`/api/files/download/${file.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
                        title="Download"
                      >
                        <Upload size={18} className="text-green-600 dark:text-green-300" />
                      </a>
                      <button
                        onClick={() => handleDeleteFile(file.name)}
                        className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
                        title="Delete"
                      >
                        <X size={18} className="text-red-600 dark:text-red-300" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString();
}
