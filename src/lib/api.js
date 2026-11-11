const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/**
 * API client with automatic JWT attachment.
 * Reads token from localStorage and sends it as Bearer token.
 */

export function getToken() {
  return localStorage.getItem('gla_token')
}

async function request(method, path, body = null) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const options = { method, headers }
  if (body) {
    options.body = JSON.stringify(body)
  }

  const res = await fetch(`${API_BASE}${path}`, options)
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`)
  }

  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
}

export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws/chess'

export default api
