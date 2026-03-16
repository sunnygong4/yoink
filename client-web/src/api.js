import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_PREFIX = `${API_BASE_URL}/api/v1`;

const api = axios.create({
  baseURL: API_PREFIX,
});

export const getStoredToken = () => localStorage.getItem('token');

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const login = async (username, password) => {
  const params = new URLSearchParams();
  params.append('username', username);
  params.append('password', password);
  const response = await api.post('/auth/token', params);
  return response.data;
};

export const register = async ({ username, password, email }) => {
  const response = await api.post('/auth/register', { username, password, email: email || null });
  return response.data;
};

export const getMe = async () => {
  const response = await api.get('/auth/me');
  return response.data;
};

export const createJob = async (payload) => {
  const response = await api.post('/jobs', payload);
  return response.data;
};

export const getJobs = async () => {
  const response = await api.get('/jobs');
  return response.data;
};

export const cancelJob = async (jobId) => {
  const response = await api.post(`/jobs/${jobId}/cancel`);
  return response.data;
};

export const getLibrary = async (params = {}) => {
  const response = await api.get('/library', { params });
  return response.data;
};

export const getLibraryHome = async () => {
  const response = await api.get('/library/home');
  return response.data;
};

export const getLibraryAlbums = async () => {
  const response = await api.get('/library/albums');
  return response.data;
};

export const searchMusicCatalog = async (params = {}) => {
  const response = await api.get('/catalog/search', { params });
  return response.data;
};

export const importCatalogTrack = async (payload) => {
  const response = await api.post('/catalog/import-track', payload);
  return response.data;
};

export const importCatalogAlbum = async (payload) => {
  const response = await api.post('/catalog/import-album', payload);
  return response.data;
};

export const searchDiscoveryCatalog = async (params = {}) => {
  const response = await api.get('/search', { params });
  return response.data;
};

export const createDiscoveryStreamSession = async (payload) => {
  const response = await api.post('/search/stream-session', payload);
  return response.data;
};

export const importDiscoveryResult = async (payload) => {
  const response = await api.post('/search/import', payload);
  return response.data;
};

export const downloadMedia = async (mediaId) => {
  const response = await api.get(`/library/${mediaId}/download`, {
    responseType: 'blob',
  });
  return response;
};

export const deleteMedia = async (mediaId) => {
  await api.delete(`/library/${mediaId}`);
};

export const updateMediaMetadata = async (mediaId, payload) => {
  const response = await api.patch(`/library/${mediaId}/metadata`, payload);
  return response.data;
};

export const updateAlbumMetadata = async (payload) => {
  const response = await api.patch('/library/albums/metadata', payload);
  return response.data;
};

export const getMediaStreamUrl = (mediaId, token = getStoredToken()) => (
  `${API_PREFIX}/library/${mediaId}/stream${token ? `?access_token=${encodeURIComponent(token)}` : ''}`
);

export const getMediaArtworkUrl = (mediaId, token = getStoredToken()) => (
  `${API_PREFIX}/library/${mediaId}/artwork${token ? `?access_token=${encodeURIComponent(token)}` : ''}`
);

export const getDiscoveryStreamUrl = (sessionToken, token = getStoredToken()) => (
  `${API_PREFIX}/search/stream/${sessionToken}${token ? `?access_token=${encodeURIComponent(token)}` : ''}`
);

export const getDiscoveryArtworkUrl = (artworkUrl, token = getStoredToken()) => (
  artworkUrl
    ? `${API_PREFIX}/search/artwork?url=${encodeURIComponent(artworkUrl)}${token ? `&access_token=${encodeURIComponent(token)}` : ''}`
    : null
);

export const createPlaylist = async (payload) => {
  const response = await api.post('/playlists', payload);
  return response.data;
};

export const getPlaylists = async () => {
  const response = await api.get('/playlists');
  return response.data;
};

export const addPlaylistItem = async (playlistId, mediaFileId) => {
  const response = await api.post(`/playlists/${playlistId}/items`, { media_file_id: mediaFileId });
  return response.data;
};

export const removePlaylistItem = async (playlistId, itemId) => {
  const response = await api.delete(`/playlists/${playlistId}/items/${itemId}`);
  return response.data;
};

export const sharePlaylist = async (playlistId, payload = {}) => {
  const response = await api.post(`/playlists/${playlistId}/share`, payload);
  return response.data;
};

export const getSharedPlaylist = async (shareToken) => {
  const response = await api.get(`/shared/playlists/${shareToken}`);
  return response.data;
};

export const getSharedPlaylistItemStreamUrl = (shareToken, itemId) => (
  `${API_PREFIX}/shared/playlists/${shareToken}/items/${itemId}/stream`
);

export const getSharedPlaylistItemArtworkUrl = (shareToken, itemId) => (
  `${API_PREFIX}/shared/playlists/${shareToken}/items/${itemId}/artwork`
);

export const createRadioChannel = async (payload) => {
  const response = await api.post('/radio', payload);
  return response.data;
};

export const getRadioChannels = async () => {
  const response = await api.get('/radio');
  return response.data;
};

export const shareRadioChannel = async (radioId, payload = {}) => {
  const response = await api.post(`/radio/${radioId}/share`, payload);
  return response.data;
};

export const getRadioStreamUrl = (slug, shareToken) => (
  `${API_BASE_URL}/radio/${slug}/index.m3u8${shareToken ? `?token=${encodeURIComponent(shareToken)}` : ''}`
);

export { API_BASE_URL, API_PREFIX };

export default api;
