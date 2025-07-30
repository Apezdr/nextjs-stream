import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@src/app/api/auth/[...nextauth]/route'

// Mock database operations - replace with your actual database implementation
const mockDatabase = {
  communityPlaylists: [],
  
  async getAllPublicPlaylists() {
    // This would query your database for all public playlists
    // For now, returning mock data
    return [
      {
        id: 'playlist1',
        name: 'Best Sci-Fi Movies',
        description: 'A curated collection of the best science fiction movies',
        itemCount: 25,
        ownerName: 'John Doe',
        dateCreated: '2024-01-15T10:00:00Z',
        privacy: 'public'
      },
      {
        id: 'playlist2',
        name: 'Classic TV Shows',
        description: 'Timeless television series that defined generations',
        itemCount: 15,
        ownerName: 'Jane Smith',
        dateCreated: '2024-02-01T14:30:00Z',
        privacy: 'public'
      }
    ]
  },
  
  async getCommunityPlaylists() {
    return this.communityPlaylists
  },
  
  async promoteToCommunity(playlistId) {
    // Find the playlist in public playlists
    const publicPlaylists = await this.getAllPublicPlaylists()
    const playlist = publicPlaylists.find(p => p.id === playlistId)
    
    if (!playlist) {
      throw new Error('Playlist not found')
    }
    
    // Add to community with additional metadata
    const communityPlaylist = {
      ...playlist,
      isFeatured: false,
      communityDateAdded: new Date().toISOString(),
      promotedBy: 'admin' // Would be actual admin user ID
    }
    
    this.communityPlaylists.push(communityPlaylist)
    return communityPlaylist
  },
  
  async removeFromCommunity(playlistId) {
    const index = this.communityPlaylists.findIndex(p => p.id === playlistId)
    if (index === -1) {
      throw new Error('Community playlist not found')
    }
    
    this.communityPlaylists.splice(index, 1)
    return true
  },
  
  async setCommunityPlaylistFeatured(playlistId, featured) {
    const playlist = this.communityPlaylists.find(p => p.id === playlistId)
    if (!playlist) {
      throw new Error('Community playlist not found')
    }
    
    playlist.isFeatured = featured
    return playlist
  }
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    switch (action) {
      case 'public-playlists':
        // Check if user is admin
        if (session.user.role !== 'Admin' && !session.user.permissions?.includes('Admin')) {
          return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
        }
        
        const publicPlaylists = await mockDatabase.getAllPublicPlaylists()
        return NextResponse.json({ playlists: publicPlaylists })

      case 'community-playlists':
        const communityPlaylists = await mockDatabase.getCommunityPlaylists()
        return NextResponse.json({ playlists: communityPlaylists })

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Community playlists API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    if (session.user.role !== 'Admin' && !session.user.permissions?.includes('Admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const body = await request.json()

    switch (action) {
      case 'promote':
        const { playlistId } = body
        if (!playlistId) {
          return NextResponse.json({ error: 'Playlist ID is required' }, { status: 400 })
        }
        
        const promotedPlaylist = await mockDatabase.promoteToCommunity(playlistId)
        return NextResponse.json({ playlist: promotedPlaylist })

      case 'set-featured':
        const { playlistId: featuredPlaylistId, featured } = body
        if (!featuredPlaylistId || typeof featured !== 'boolean') {
          return NextResponse.json({ error: 'Playlist ID and featured status are required' }, { status: 400 })
        }
        
        const updatedPlaylist = await mockDatabase.setCommunityPlaylistFeatured(featuredPlaylistId, featured)
        return NextResponse.json({ playlist: updatedPlaylist })

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Community playlists POST API error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    if (session.user.role !== 'Admin' && !session.user.permissions?.includes('Admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
