'use server'

import clientPromise from 'src/lib/mongodb'
import { auth } from '../lib/auth'
import { ObjectId } from 'mongodb'

export async function getVideosWatched() {
  const session = await auth()

  if (!session) {
    return null
  }

  const client = await clientPromise
  const db = client.db('Media')
  const data = await db
    .collection('PlaybackStatus')
    .findOne({ userId: new ObjectId(session.user.id) })

  if (data?.videosWatched) {
    return data.videosWatched
  }

  return {}
}
