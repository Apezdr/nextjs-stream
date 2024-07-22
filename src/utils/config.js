const fileServerURL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:3000'
const adminUserEmails = process.env.NEXT_PUBLIC_ADMIN_USER_EMAILS
  ? process.env.NEXT_PUBLIC_ADMIN_USER_EMAILS.split(',').map((email) => email.trim())
  : []
const siteTitle = process.env.NEXT_PUBLIC_SITE_TITLE || 'Cinema Sanctuary'
const siteDescription =
  process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Sharing media content with friends and family.'

export { fileServerURL, adminUserEmails, siteTitle, siteDescription }
