import { AddonDescriptor } from '@/types/addon'
import { LibraryItem } from '@/types/activity'
import {
  getNuvioAddons,
  getNuvioLibrary,
  NuvioAddonInput,
  NuvioLibraryItemInput,
  NuvioWatchedItemInput,
  NuvioWatchProgressInput,
  pushNuvioAddons,
  pushNuvioLibrary,
  pushNuvioWatchedItems,
  pushNuvioWatchProgress,
  signInToNuvio,
} from '@/api/nuvio'
import { getSeasonEpisode, getWatchTimestamp, isActuallyWatched } from '@/lib/activity-utils'
import { getEffectiveManifest } from '@/lib/addon-utils'
import { normalizeAddonUrl } from '@/lib/utils'

export interface NuvioSyncInput {
  email: string
  password: string
  profileId: number
  addons: AddonDescriptor[]
  libraryItems: LibraryItem[]
}

export interface NuvioSyncResult {
  addons: number
  library: number
  watchHistory: number
  watchProgress: number
}

function toEpoch(value?: string): number | undefined {
  if (!value) return undefined
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : undefined
}

function contentType(type?: string): string {
  if (type === 'movie' || type === 'series') return type
  if (type === 'anime') return 'series'
  return 'movie'
}

function sourceAddonUrl(item: LibraryItem): string | undefined {
  const value = (item as any).addon || (item as any).addonBaseUrl || (item as any).addon_base_url
  return typeof value === 'string' && value.trim() ? value : undefined
}

function toNuvioAddons(addons: AddonDescriptor[]): NuvioAddonInput[] {
  return addons
    .filter((addon) => addon.transportUrl)
    .map((addon, index) => {
      const manifest = getEffectiveManifest(addon)
      return {
        url: addon.transportUrl,
        name: manifest?.name || addon.transportName || addon.transportUrl,
        enabled: addon.flags?.enabled !== false,
        sort_order: index,
      }
    })
}

function mergeAddons(existing: NuvioAddonInput[], incoming: NuvioAddonInput[]): NuvioAddonInput[] {
  const existingByUrl = new Map(existing.map((addon) => [normalizeAddonUrl(addon.url).toLowerCase(), addon]))
  const merged = [...existing]

  for (const addon of incoming) {
    const key = normalizeAddonUrl(addon.url).toLowerCase()
    if (!existingByUrl.has(key)) {
      merged.push(addon)
    }
  }

  return merged.map((addon, index) => ({
    url: addon.url,
    name: addon.name,
    enabled: addon.enabled ?? true,
    sort_order: index,
  }))
}

function mergeLibrary(existing: NuvioLibraryItemInput[], incoming: NuvioLibraryItemInput[]): NuvioLibraryItemInput[] {
  const merged = new Map(existing.map((item) => [item.content_id, item]))
  for (const item of incoming) {
    merged.set(item.content_id, { ...merged.get(item.content_id), ...item })
  }
  return Array.from(merged.values())
}

function toNuvioLibraryItem(item: LibraryItem): NuvioLibraryItemInput | null {
  if (!item._id || item.removed) return null

  return {
    content_id: item._id,
    content_type: contentType(item.type),
    name: item.name || item._id,
    poster: item.poster || undefined,
    poster_shape: 'POSTER',
    background: item.background || undefined,
    addon_base_url: sourceAddonUrl(item),
    added_at: toEpoch(item._ctime) || toEpoch(item._mtime) || Date.now(),
  }
}

function toNuvioWatchProgress(item: LibraryItem): NuvioWatchProgressInput | null {
  if (!item._id || item.removed) return null

  const state = item.state || {}
  const position = state.timeOffset || 0
  const duration = state.duration || 0

  if (!state.video_id || position <= 0 || duration <= 0 || position >= duration * 0.95) {
    return null
  }

  const { season, episode } = getSeasonEpisode(item)
  return {
    content_id: item._id,
    content_type: contentType(item.type),
    video_id: state.video_id,
    season,
    episode,
    position,
    duration,
    last_watched: getWatchTimestamp(item).getTime(),
  }
}

function toNuvioWatchedItem(item: LibraryItem): NuvioWatchedItemInput | null {
  if (!item._id || item.removed || !isActuallyWatched(item)) return null

  const state = item.state || {}
  const duration = state.duration || 0
  const position = state.timeOffset || 0
  const watchedEnough =
    (state.timesWatched || 0) > 0 ||
    (state.flaggedWatched || 0) > 0 ||
    (duration > 0 && position >= duration * 0.9)

  if (!watchedEnough) return null

  const { season, episode } = getSeasonEpisode(item)
  return {
    content_id: item._id,
    content_type: contentType(item.type),
    title: item.name || item._id,
    season,
    episode,
    watched_at: getWatchTimestamp(item).getTime(),
  }
}

function compactByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  return Array.from(new Map(items.map((item) => [keyFn(item), item])).values())
}

export async function syncStremioToNuvio(input: NuvioSyncInput): Promise<NuvioSyncResult> {
  const session = await signInToNuvio(input.email, input.password)
  const token = session.access_token
  if (!token) throw new Error('Nuvio login did not return an access token')

  const [currentAddons, currentLibrary] = await Promise.all([
    getNuvioAddons(token, input.profileId).catch(() => []),
    getNuvioLibrary(token, input.profileId).catch(() => []),
  ])
  const addons = mergeAddons(currentAddons, toNuvioAddons(input.addons))
  const stremioLibrary = compactByKey(
    input.libraryItems.map(toNuvioLibraryItem).filter(Boolean) as NuvioLibraryItemInput[],
    (item) => item.content_id
  )
  const library = mergeLibrary(currentLibrary, stremioLibrary)
  const watchProgress = compactByKey(
    input.libraryItems.map(toNuvioWatchProgress).filter(Boolean) as NuvioWatchProgressInput[],
    (item) => `${item.content_id}:${item.video_id}`
  )
  const watchHistory = compactByKey(
    input.libraryItems.map(toNuvioWatchedItem).filter(Boolean) as NuvioWatchedItemInput[],
    (item) => `${item.content_id}:${item.season || ''}:${item.episode || ''}`
  )

  await pushNuvioAddons(token, input.profileId, addons)
  await pushNuvioLibrary(token, input.profileId, library)
  await pushNuvioWatchedItems(token, input.profileId, watchHistory)
  await pushNuvioWatchProgress(token, input.profileId, watchProgress)

  return {
    addons: addons.length,
    library: library.length,
    watchHistory: watchHistory.length,
    watchProgress: watchProgress.length,
  }
}
