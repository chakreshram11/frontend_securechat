import React, { useState, useEffect } from 'react';
import { Moon, Sun, Settings as SettingsIcon, X } from 'lucide-react';

export default function Settings({ onClose, onThemeChange }) {
  const [theme, setTheme] = useState('light');
  const [fileSharingEnabled, setFileSharingEnabled] = useState(true);

  useEffect(() => {
    // Load saved theme from localStorage
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    if (onThemeChange) onThemeChange(newTheme);
  };

  const toggleFileSharing = () => {
    const newState = !fileSharingEnabled;
    setFileSharingEnabled(newState);
    localStorage.setItem('fileSharingEnabled', newState);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900">
                {theme === 'light' ? (
                  <Sun className="text-blue-600 dark:text-blue-300" size={18} />
                ) : (
                  <Moon className="text-blue-600 dark:text-blue-300" size={18} />
                )}
              </div>
              <span className="text-gray-700 dark:text-gray-200 font-medium">
                {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode
            </button>
          </div>

          {/* File Sharing Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                <SettingsIcon className="text-green-600 dark:text-green-300" size={18} />
              </div>
              <span className="text-gray-700 dark:text-gray-200 font-medium">
                File Sharing
              </span>
            </div>
            <button
              onClick={toggleFileSharing}
              className={`px-4 py-2 rounded-lg transition-colors ${
                fileSharingEnabled
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-300 hover:bg-gray-400 text-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200'
              }`}
            >
              {fileSharingEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Settings are saved automatically
          </p>
        </div>
      </div>
    </div>
  );
}
