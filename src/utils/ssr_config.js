// ex. SABNZBD url:
// http://192.168.1.2:8080/sabnzbd
const sabnzbdURL = process.env.SABNZBD_URL || false
const sabnzbdAPIKey = process.env.SABNZBD_API_KEY || false
const radarrURL = process.env.RADARR_URL || false
const radarrAPIKey = process.env.RADARR_API_KEY || false
const sonarrURL = process.env.SONARR_URL || false
const sonarrAPIKey = process.env.SONARR_API_KEY || false
const tdarrURL = process.env.TDARR_URL || false
const tdarrAPIKey = process.env.TDARR_API_KEY || false

export {
  sabnzbdURL,
  sabnzbdAPIKey,
  radarrURL,
  radarrAPIKey,
  sonarrURL,
  sonarrAPIKey,
  tdarrURL,
  tdarrAPIKey,
}
