import { fetchBannerMedia } from '@src/utils/auth_database'
import BannerWithVideo from './BannerWithVideo'

const BannerWithVideoContainer = async () => {
  const bannerMediaList = await fetchBannerMedia()

  return bannerMediaList ? <BannerWithVideo mediaList={bannerMediaList} /> : null
}

export default BannerWithVideoContainer
