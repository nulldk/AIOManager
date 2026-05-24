const NUVIO_BASE_URL = 'https://dpyhjjcoabcglfmgecug.supabase.co'
const NUVIO_PUBLISHABLE_KEY = 'sb_publishable_zcNkgqGJjBtj8GoRlMvl9A_zkdmXhf5'

export interface NuvioAuthSession {
  access_token: string
  refresh_token?: string
  user?: {
    id: string
    email?: string
  }
}

export interface NuvioProfile {
  id: string
  profile_index: number
  name: string
  avatar_color_hex?: string
  uses_primary_addons?: boolean
  uses_primary_plugins?: boolean
}

export interface NuvioAddonInput {
  url: string
  name?: string
  enabled?: boolean
  sort_order?: number
}

export interface NuvioLibraryItemInput {
  content_id: string
  content_type: string
  name?: string
  poster?: string
  poster_shape?: string
  background?: string
  description?: string
  release_info?: string
  imdb_rating?: number
  genres?: string[]
  addon_base_url?: string
  added_at?: number
}

export interface NuvioWatchProgressInput {
  content_id: string
  content_type: string
  video_id: string
  season?: number
  episode?: number
  position: number
  duration: number
  last_watched: number
}

export interface NuvioWatchedItemInput {
  content_id: string
  content_type: string
  title?: string
  season?: number
  episode?: number
  watched_at: number
}

function nuvioHeaders(accessToken?: string) {
  return {
    apikey: NUVIO_PUBLISHABLE_KEY,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    'Content-Type': 'application/json',
  }
}

async function parseResponse(response: Response) {
  if (response.status === 204) return null
  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || response.statusText
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
  }

  return data
}

async function rpc<T>(accessToken: string, functionName: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${NUVIO_BASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: nuvioHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined,
  })

  return parseResponse(response) as Promise<T>
}

export async function signInToNuvio(email: string, password: string): Promise<NuvioAuthSession> {
  const response = await fetch(`${NUVIO_BASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: nuvioHeaders(),
    body: JSON.stringify({ email, password }),
  })

  return parseResponse(response) as Promise<NuvioAuthSession>
}

export async function getNuvioProfiles(accessToken: string): Promise<NuvioProfile[]> {
  return rpc<NuvioProfile[]>(accessToken, 'sync_pull_profiles')
}

export async function getNuvioAddons(accessToken: string, profileId: number): Promise<NuvioAddonInput[]> {
  const response = await fetch(
    `${NUVIO_BASE_URL}/rest/v1/addons?select=*&profile_id=eq.${profileId}&order=sort_order`,
    {
      method: 'GET',
      headers: nuvioHeaders(accessToken),
    }
  )

  return parseResponse(response) as Promise<NuvioAddonInput[]>
}

export async function getNuvioLibrary(accessToken: string, profileId: number): Promise<NuvioLibraryItemInput[]> {
  return rpc<NuvioLibraryItemInput[]>(accessToken, 'sync_pull_library', {
    p_profile_id: profileId,
    p_limit: 100000,
    p_offset: 0,
  })
}

export async function pushNuvioAddons(
  accessToken: string,
  profileId: number,
  addons: NuvioAddonInput[]
): Promise<void> {
  await rpc(accessToken, 'sync_push_addons', { p_profile_id: profileId, p_addons: addons })
}

export async function pushNuvioLibrary(
  accessToken: string,
  profileId: number,
  items: NuvioLibraryItemInput[]
): Promise<void> {
  await rpc(accessToken, 'sync_push_library', { p_profile_id: profileId, p_items: items })
}

export async function pushNuvioWatchProgress(
  accessToken: string,
  profileId: number,
  entries: NuvioWatchProgressInput[]
): Promise<void> {
  await rpc(accessToken, 'sync_push_watch_progress', { p_profile_id: profileId, p_entries: entries })
}

export async function pushNuvioWatchedItems(
  accessToken: string,
  profileId: number,
  items: NuvioWatchedItemInput[]
): Promise<void> {
  await rpc(accessToken, 'sync_push_watched_items', { p_profile_id: profileId, p_items: items })
}
