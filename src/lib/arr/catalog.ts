// src/lib/arr/catalog.ts
// Our side of an add: is the title already in the library, and does a
// different title already live in the folder this one would get? The folder
// becomes the new title's originalTitle, which must stay unique.
import 'server-only'
import clientPromise from '@src/lib/mongodb'
import type { ArrMediaType, CatalogCheck } from './types'

const COLLECTIONS: Record<ArrMediaType, string> = { movie: 'FlatMovies', tv: 'FlatTVShows' }

export async function checkCatalog(mediaType: ArrMediaType, tmdbId: number, folder: string | null): Promise<CatalogCheck> {
  const collection = (await clientPromise).db('Media').collection(COLLECTIONS[mediaType])
  const [own, holder] = await Promise.all([
    collection.findOne({ 'metadata.id': tmdbId }, { projection: { _id: 1 } }),
    folder
      ? collection.findOne(
          { originalTitle: folder },
          // Case-insensitive, as the filesystem under a library may be.
          { projection: { title: 1, 'metadata.id': 1 }, collation: { locale: 'en', strength: 2 } }
        )
      : null,
  ])
  // The same title already in that folder (one the service doesn't manage yet)
  // is no clash: the add adopts the folder and the file in it.
  const takenByOther = holder && holder.metadata?.id !== tmdbId
  return {
    inLibrary: Boolean(own),
    folderTakenBy: takenByOther ? { title: typeof holder.title === 'string' ? holder.title : (folder as string) } : null,
  }
}
