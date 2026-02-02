import axios from "axios";

// Get the API base URL from environment or construct from current host
const getApiBase = () => {
  // First, check if VITE_API_BASE is explicitly set and not empty
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase && envBase.trim()) {
    console.log("🔗 Using API base from .env:", envBase);
    return envBase;
  }
  
  // Otherwise, dynamically detect based on current hostname
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  
  // For localhost/127.0.0.1, use localhost:5000
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:5000`;
  }
  
  // For other IPs/domains, use the same hostname with port 5000
  // Keep the same protocol (http/https)
  return `${protocol}//${hostname}:5000`;
};

const apiBase = getApiBase();
console.log("🔗 API Base URL:", apiBase);
console.log("📍 Frontend accessed from:", window.location.hostname);
console.log("🌐 Full URL:", window.location.href);

const api = axios.create({
  baseURL: apiBase,
  timeout: 10000, // 10 second timeout
  withCredentials: false, // Don't send cookies
});

// Request interceptor - add debugging
api.interceptors.request.use(
  config => {
    const fullUrl = `${config.baseURL || ''}${config.url}`;
    console.log(`📡 API Request: ${config.method?.toUpperCase()} ${fullUrl}`);
    console.log(`   Timeout: ${config.timeout}ms`);
    return config;
  },
  error => {
    console.error("❌ Request configuration error:", error);
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors with retries
api.interceptors.response.use(
  response => {
    console.log(`✅ API Response: ${response.status} ${response.statusText}`);
    return response;
  },
  async error => {
    const config = error.config;
    
    // Log detailed error info
    console.error("❌ API Error Details:", {
      message: error.message,
      code: error.code,
      hasResponse: !!error.response,
      status: error.response?.status,
      url: config?.url,
      baseURL: config?.baseURL,
      fullURL: `${config?.baseURL}${config?.url}`,
      timeout: config?.timeout,
    });
    
    // Only retry on network errors (not response errors like 400, 401, etc.)
    if (!error.response && config && config.__retryCount === undefined) {
      config.__retryCount = 0;
    }
    
    if (!error.response && config && config.__retryCount < 3) {
      config.__retryCount++;
      const delay = 1000 * config.__retryCount;
      console.warn(`🔄 Network error, retrying (attempt ${config.__retryCount}/3) after ${delay}ms...`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
        return api.request(config);
      } catch (retryError) {
        console.error(`❌ Retry attempt ${config.__retryCount} failed`);
        return Promise.reject(retryError);
      }
    }
    
    // If response error (4xx, 5xx), don't retry
    if (error.response) {
      console.error(`API returned ${error.response.status}: ${error.response.statusText}`);
    }
    
    return Promise.reject(error);
  }
);

export function setToken(token) {
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
}

// File upload function
export async function uploadFile(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/api/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });

    return response.data;
  } catch (error) {
    console.error('File upload failed:', error);
    throw error;
  }
}

// File download function
export async function downloadFile(fileId) {
  try {
    const response = await api.get(`/api/files/${fileId}`, {
      responseType: 'blob' // Important for file downloads
    });
    return response.data;
  } catch (error) {
    console.error('File download failed:', error);
    throw error;
  }
}

// File list function
export async function listFiles() {
  try {
    const response = await api.get('/api/files/list');
    return response.data;
  } catch (error) {
    console.error('File list failed:', error);
    throw error;
  }
}

// File delete function
export async function deleteFile(filename) {
  try {
    const response = await api.delete(`/api/files/delete/${filename}`);
    return response.data;
  } catch (error) {
    console.error('File delete failed:', error);
    throw error;
  }
}

export default api;
