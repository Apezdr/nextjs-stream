export function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function convertToPlainObjects(documents) {
  return documents.map((doc) => {
    const returnObject = {
      _id: doc._id.toString(), // Convert ObjectId to string
      title: doc.title,
      videoURL: doc.videoURL,
      metadata: doc.metadata,
    }

    if (doc.captionURLs) {
      returnObject.captionURLs = doc.captionURLs
    }

    return returnObject
  })
}

export function convertToDate(str) {
  const date = new Date(str)
  return date
}

// Function to format time in milliseconds to hh:mm:ss
export function formatTime(milliseconds) {
  let seconds = Math.floor(milliseconds / 1000)
  let minutes = Math.floor(seconds / 60)
  let hours = Math.floor(minutes / 60)

  seconds = seconds % 60
  minutes = minutes % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`
}

export function getFullImageUrl(imagePath, size = 'w780') {
  // Adjust the size as needed (e.g., 'w780', 'original')
  const baseUrl = 'https://image.tmdb.org/t/p/'
  return `${baseUrl}${size}${imagePath}`
}

export function buildURL(url) {
  return `${
    process.env.NODE_ENV === 'development'
      ? process.env.NEXT_PUBLIC_BASE_URL
        ? process.env.NEXT_PUBLIC_BASE_URL
        : `http://localhost:${process.env.PORT || 3000}`
      : process.env.NEXT_PUBLIC_BASE_URL
  }${url}`
}

export function generateColors(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  let bgColor = 'rgba('
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff
    bgColor += value + ', '
  }
  bgColor += '0.7)' // Set the opacity

  // Calculate the brightness of the background color
  const brightness = Math.round(
    (parseInt(bgColor.slice(5, 8), 10) * 299 +
      parseInt(bgColor.slice(10, 13), 10) * 587 +
      parseInt(bgColor.slice(15, 18), 10) * 114) /
      1000
  )

  // Determine the font color based on the brightness
  const fontColor = brightness > 125 ? '#000000' : '#FFFFFF'

  return {
    backgroundColor: bgColor,
    fontColor: fontColor,
  }
}
