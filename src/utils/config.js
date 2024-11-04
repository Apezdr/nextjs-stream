const organizrURL = process.env.NEXT_PUBLIC_ORGANIZR_URL || 'http://localhost:3000'
const fileServerURL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:3000'
const fileServerPrefixPath = process.env.NEXT_PUBLIC_FILE_SERVER_PREFIX_PATH || ''
const fileServerURLWithoutPrefixPath = fileServerURL.replace(
  new RegExp(`${fileServerPrefixPath}/?$`),
  ''
)
const fileServerURLWithPrefixPath = fileServerURL + fileServerPrefixPath
const adminUserEmails = process.env.NEXT_PUBLIC_ADMIN_USER_EMAILS
  ? process.env.NEXT_PUBLIC_ADMIN_USER_EMAILS.split(',').map((email) => email.trim())
  : []
const siteTitle = process.env.NEXT_PUBLIC_SITE_TITLE || 'Cinema Sanctuary'
const siteDescription =
  process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Sharing media content with friends and family.'
const syncTVURL = process.env.NEXT_PUBLIC_SYNC_TV_URL || 'http://localhost:3000/tv_list.json'
const syncMoviesURL =
  process.env.NEXT_PUBLIC_SYNC_MOVIES_URL || 'http://localhost:3000/movies_list.json'
const nodeJSURL = process.env.NEXT_PUBLIC_NODE_SERVER_URL || 'http://localhost:3000'

export {
  organizrURL,
  fileServerURL,
  fileServerPrefixPath,
  fileServerURLWithoutPrefixPath,
  fileServerURLWithPrefixPath,
  adminUserEmails,
  siteTitle,
  siteDescription,
  syncTVURL,
  syncMoviesURL,
  nodeJSURL,
}
