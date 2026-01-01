import { getFullImageUrl } from '@src/utils'
import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { fetchFlatRandomBannerMedia } from '@src/utils/flatDatabaseUtils'
import { httpGet } from '@src/lib/httpHelper'
import sharp from 'sharp'

/**
 * Given an original backdrop luminance (0–1), an overlay color (#FFF or #000)
 * and opacity, returns the *new* approximate luminance after compositing.
 */
function applyOverlayLuminance(backdropLum, overlayColor, opacity) {
  const targetLum = overlayColor === '#FFFFFF' ? 1.0 : 0.0;
  return backdropLum * (1 - opacity) + targetLum * opacity;
}

/**
 * Analyzes image contrast between logo and backdrop to determine if visual adjustments are needed
 * 
 * @param {string} logoUrl - URL of the logo image
 * @param {string} backdropUrl - URL of the backdrop image
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeImageContrast(logoUrl, backdropUrl) {
  try {
    if (!logoUrl || !backdropUrl) {
      return {
        needsAdjustment: false,
        error: "Missing logo or backdrop URL"
      }
    }
    
    // Fetch both images using httpGet
    const [logoResponse, backdropResponse] = await Promise.all([
      httpGet(logoUrl, {
        responseType: 'buffer',
        headers: {
          Accept: 'image/*',
        },
        timeout: 5000,
        retry: {
          retries: 6,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 3000
        }
      }, true),
      httpGet(backdropUrl, {
        responseType: 'buffer',
        headers: {
          Accept: 'image/*',
        },
        timeout: 5000,
        retry: {
          retries: 6,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 3000
        }
      }, true)
    ])
    
    // Normalize the response data structure to handle both cached and fresh responses
    const logoData = logoResponse.data?.data || logoResponse.data;
    const backdropData = backdropResponse.data?.data || backdropResponse.data;
    
    // Check if we successfully fetched both images
    if (!logoData || !backdropData) {
      return {
        needsAdjustment: false,
        error: "Failed to fetch one or both images"
      }
    }
    
    
    // Process images to extract relevant information
    const logoInfo = await processLogoImage(logoData)
    const backdropInfo = await processBackdropImage(backdropData)
    
    if (!logoInfo || !backdropInfo) {
      return {
        needsAdjustment: false,
        error: "Failed to process image data"
      }
    }
    
    const { luminance: logoLuminance, hasTransparency, transparencyRatio } = logoInfo
    const { 
      luminance: backdropLuminance, 
      dominantArea, 
      regionLuminances, 
      hasContrastingRegions 
    } = backdropInfo
    
    // Calculate contrast ratio based on overall backdrop luminance
    let contrastRatio = calculateContrastRatio(logoLuminance, backdropLuminance)
    
    // If the backdrop has contrasting regions, also check contrast with the top region
    // where logos are typically placed
    if (hasContrastingRegions && regionLuminances && regionLuminances.length > 0) {
      const topRegionContrastRatio = calculateContrastRatio(logoLuminance, regionLuminances[0])
      // Use the worse contrast ratio to ensure good visibility
      contrastRatio = Math.min(contrastRatio, topRegionContrastRatio)
    }
    
    // Determine if adjustment is needed based on contrast and transparency
    // Use a stricter contrast requirement for transparent logos
    const contrastThreshold = hasTransparency ? 5.0 : 4.5
    const needsAdjustment = contrastRatio < contrastThreshold
    
    // Calculate recommended overlay parameters if needed
    let recommendedOverlay = null
    if (needsAdjustment) {
      const targetLuminance = hasContrastingRegions && regionLuminances
        ? regionLuminances[0]
        : backdropLuminance;

      // opposite‐color overlay
      const overlayColor = targetLuminance > 0.5 ? '#000000' : '#FFFFFF';

      // base opacity & bump for transparency/regions
      let baseOpacity = 0.3;
      if (hasTransparency)   baseOpacity = Math.max(baseOpacity, transparencyRatio * 0.5);
      if (hasContrastingRegions) baseOpacity = Math.max(baseOpacity, 0.4);

      const contrastDeficit = contrastThreshold - contrastRatio;
      const maxAdditionalOpacity = 0.4;
      const opacity = Math.min(
        baseOpacity + (contrastDeficit / contrastThreshold) * maxAdditionalOpacity,
        0.7
      );

      // simulate new luminance & check if it *actually* meets threshold
      const simulatedLum     = applyOverlayLuminance(targetLuminance, overlayColor, opacity);
      const improvedContrast = calculateContrastRatio(logoLuminance, simulatedLum);

      if (improvedContrast >= contrastThreshold) {
        recommendedOverlay = {
          color: overlayColor,
          opacity: parseFloat(opacity.toFixed(2))
        };
      }
      // else leaves recommendedOverlay = null
    }
    
    // Prepare result with detailed information
    return {
      needsAdjustment,
      recommendedOverlay,
      logoLuminance: parseFloat(logoLuminance.toFixed(2)),
      backdropLuminance: parseFloat(backdropLuminance.toFixed(2)),
      contrastRatio: parseFloat(contrastRatio.toFixed(2)),
      logoHasTransparency: hasTransparency,
      logoTransparencyRatio: transparencyRatio,
      backdropDominantArea: dominantArea,
      backdropHasContrastingRegions: hasContrastingRegions,
      regionLuminances: regionLuminances,
      contrastThreshold,
      // Add metadata about the image sources
      imageSources: {
        logo: logoResponse.meta?.source || 'unknown',
        backdrop: backdropResponse.meta?.source || 'unknown'
      }
    }
  } catch (error) {
    console.error('Error analyzing image contrast:', error)
    return {
      needsAdjustment: false,
      error: `Analysis failed: ${error.message}`
    }
  }
}

/**
 * Processes a logo image to extract luminance information, accounting for transparency
 * @param {Buffer} imageBuffer - Buffer containing the image data
 * @returns {Promise<Object>} - Object containing luminance and transparency information
 */
async function processLogoImage(imageBuffer) {
  try {
    // Additional validation
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      console.error('Invalid or empty logo image buffer provided to processLogoImage')
      return {
        luminance: 0.5,
        hasTransparency: false,
        transparencyRatio: 0
      }
    }
    
    // Extract metadata to check image properties
    const metadata = await sharp(imageBuffer).metadata()
    const hasAlpha = metadata.channels === 4 // Check if image has alpha channel
    
    // For debugging
    if (Boolean(process.env.DEBUG) == true) {
      console.debug('Logo image metadata:', {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      space: metadata.space,
      depth: metadata.depth
      })
    }
    
    // Create a base Sharp instance with common transformations
    const baseImage = sharp(imageBuffer)
      .resize({ width: 100 }) // Resize for faster processing
      .toColorspace('srgb'); // Ensure image is in RGB color space
    
    // Get stats for the image (more efficient reuse of the Sharp pipeline)
    const stats = await baseImage.stats()
    
    // Debug log
    if (Boolean(process.env.DEBUG) == true) {
      console.debug('Logo stats channels:', {
      channelCount: stats.channels?.length,
      hasChannels: !!stats.channels
      })
    }
    
    // Handle grayscale images (1 channel) by duplicating to RGB
    if (stats.channels && stats.channels.length === 1) {
      if (Boolean(process.env.DEBUG) == true) {
        console.debug('Processing grayscale logo image')
      }
      const grayValue = stats.channels[0].mean
      return {
        luminance: grayValue / 255, // Convert to 0-1 range
        hasTransparency: false, // Grayscale has no transparency
        transparencyRatio: 0
      }
    }
    
    // Check if we have enough channels for RGB calculation
    if (!stats.channels || stats.channels.length < 3 || 
        !stats.channels[0] || !stats.channels[1] || !stats.channels[2]) {
      console.warn('Image does not have expected RGB channels, using fallback luminance')
      // Try to extract average brightness as fallback
      if (stats.channels && stats.channels.length > 0) {
        // Use the first available channel as approximation
        const brightness = stats.channels[0].mean / 255;
        return {
          luminance: brightness,
          hasTransparency: false,
          transparencyRatio: 0
        }
      }
      
      // Last resort fallback
      return {
        luminance: 0.5,
        hasTransparency: false,
        transparencyRatio: 0
      }
    }
    
    // Calculate luminance from RGB channels
    const luminance = calculateLuminance(
      stats.channels[0].mean, 
      stats.channels[1].mean, 
      stats.channels[2].mean
    )
    
    // If there's an alpha channel, determine how much transparency the logo has
    let hasTransparency = false
    let transparencyRatio = 0
    
    if (hasAlpha && stats.channels.length > 3) {
      // Alpha channel is at index 3
      const alphaChannel = stats.channels[3]
      // Mean alpha below 200 (out of 255) indicates significant transparency
      hasTransparency = alphaChannel.mean < 200
      // Calculate ratio of transparent to opaque pixels
      transparencyRatio = 1 - (alphaChannel.mean / 255)
    }
    
    return {
      luminance,
      hasTransparency,
      transparencyRatio: parseFloat(transparencyRatio.toFixed(2))
    }
  } catch (error) {
    console.error('Error processing logo image:', error)
    return null
  }
}

/**
 * Processes a backdrop image to extract luminance information
 * @param {Buffer} imageBuffer - Buffer containing the image data
 * @returns {Promise<Object>} - Object containing luminance and area information
 */
async function processBackdropImage(imageBuffer) {
  try {
    // Additional validation
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      console.error('Invalid or empty backdrop image buffer provided to processBackdropImage')
      return {
        luminance: 0.5,
        dominantArea: 'mixed',
        regionLuminances: [0.5, 0.5, 0.5],
        hasContrastingRegions: false
      }
    }
    
    // Extract metadata to check image properties
    const metadata = await sharp(imageBuffer).metadata()
    
    // For debugging
    if (Boolean(process.env.DEBUG) == true) {
      console.debug('Backdrop image metadata:', {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
        space: metadata.space,
        depth: metadata.depth
      })
    }
    
    // Create a base Sharp instance with common transformations
    const baseImage = sharp(imageBuffer)
      .resize({ width: 300 })
      .toColorspace('srgb'); // Ensure image is in RGB color space
    
    // Get stats for the entire image (more efficient reuse of the Sharp pipeline)
    const stats = await baseImage.stats()
    
    // Debug log
    if (Boolean(process.env.DEBUG) == true) {
      console.debug('Backdrop stats channels:', {
        channelCount: stats.channels?.length,
        hasChannels: !!stats.channels
      })
    }
    
    // Handle grayscale images (1 channel)
    if (stats.channels && stats.channels.length === 1) {
      if (Boolean(process.env.DEBUG) == true) {
        console.debug('Processing grayscale backdrop image')
      }
      const grayValue = stats.channels[0].mean / 255 // Convert to 0-1 range
      return {
        luminance: grayValue,
        dominantArea: grayValue > 0.5 ? 'light' : 'dark',
        regionLuminances: [grayValue, grayValue, grayValue],
        hasContrastingRegions: false
      }
    }
    
    // Check if we have enough channels for RGB calculation
    if (!stats.channels || stats.channels.length < 3 || 
        !stats.channels[0] || !stats.channels[1] || !stats.channels[2]) {
      console.warn('Backdrop image does not have expected RGB channels, using fallback luminance')
      
      // Try to extract average brightness as fallback
      if (stats.channels && stats.channels.length > 0) {
        // Use the first available channel as approximation
        const brightness = stats.channels[0].mean / 255;
        return {
          luminance: brightness,
          dominantArea: brightness > 0.5 ? 'light' : 'dark',
          regionLuminances: [brightness, brightness, brightness],
          hasContrastingRegions: false
        }
      }
      
      // Last resort fallback
      return {
        luminance: 0.5,
        dominantArea: 'mixed',
        regionLuminances: [0.5, 0.5, 0.5],
        hasContrastingRegions: false
      }
    }
    
    // Calculate overall luminance
    const luminance = calculateLuminance(
      stats.channels[0].mean, 
      stats.channels[1].mean, 
      stats.channels[2].mean
    )
    
    // Analyze regions - typically logos appear in the top or center regions
    // Extract top third of the image for region analysis
    let regionLuminances = []
    let hasContrastingRegions = false
    
    try {
      // Create a base Sharp instance that we can clone for different operations
      // This reduces the number of libvips threads created
      const baseImage = sharp(imageBuffer)
        .resize({ width: 300 })
        .toColorspace('srgb');
      
      // Process all regions in parallel for better performance
      // Also analyze sub-regions for detailed brightness distribution
      const [topRegion, centerRegion, bottomRegion, topLeftRegion, topRightRegion] = await Promise.all([
        baseImage.clone().extract({ left: 0, top: 0, width: 300, height: 100 }).stats(),
        baseImage.clone().extract({ left: 75, top: 75, width: 150, height: 150 }).stats(),
        baseImage.clone().extract({ left: 0, top: 200, width: 300, height: 100 }).stats(),
        // Additional sub-regions for detailed analysis
        baseImage.clone().extract({ left: 0, top: 0, width: 150, height: 100 }).stats(),
        baseImage.clone().extract({ left: 150, top: 0, width: 150, height: 100 }).stats()
      ]);
      
      // Check if top region has valid channels
      let topLuminance = 0.5; // Default fallback
      if (topRegion.channels && topRegion.channels.length >= 3 &&
          topRegion.channels[0] && topRegion.channels[1] && topRegion.channels[2]) {
        // Calculate luminance for top region
        topLuminance = calculateLuminance(
          topRegion.channels[0].mean,
          topRegion.channels[1].mean,
          topRegion.channels[2].mean
        )
      } else {
        console.warn('Top region of backdrop does not have expected RGB channels')
      }
      
      // Check if center region has valid channels
      let centerLuminance = 0.5; // Default fallback
      if (centerRegion.channels && centerRegion.channels.length >= 3 &&
          centerRegion.channels[0] && centerRegion.channels[1] && centerRegion.channels[2]) {
        // Calculate luminance for center region
        centerLuminance = calculateLuminance(
          centerRegion.channels[0].mean,
          centerRegion.channels[1].mean,
          centerRegion.channels[2].mean
        )
      } else {
        console.warn('Center region of backdrop does not have expected RGB channels')
      }
      
      let bottomLuminance = 0.5; // Default fallback
      if (bottomRegion.channels && bottomRegion.channels.length >= 3 &&
          bottomRegion.channels[0] && bottomRegion.channels[1] && bottomRegion.channels[2]) {
        // Calculate luminance for bottom region
        bottomLuminance = calculateLuminance(
          bottomRegion.channels[0].mean,
          bottomRegion.channels[1].mean,
          bottomRegion.channels[2].mean
        )
      } else {
        console.warn('Bottom region of backdrop does not have expected RGB channels')
      }
      
      // Calculate luminance for top-left and top-right regions for detailed analysis
      let topLeftLuminance = 0.5; // Default fallback
      let topRightLuminance = 0.5; // Default fallback
      
      if (topLeftRegion.channels && topLeftRegion.channels.length >= 3) {
        topLeftLuminance = calculateLuminance(
          topLeftRegion.channels[0].mean,
          topLeftRegion.channels[1].mean,
          topLeftRegion.channels[2].mean
        );
      }
      
      if (topRightRegion.channels && topRightRegion.channels.length >= 3) {
        topRightLuminance = calculateLuminance(
          topRightRegion.channels[0].mean,
          topRightRegion.channels[1].mean,
          topRightRegion.channels[2].mean
        );
      }
      
      // Store all region luminances for analysis
      regionLuminances = [
        parseFloat(topLuminance.toFixed(2)),
        parseFloat(centerLuminance.toFixed(2)),
        parseFloat(bottomLuminance.toFixed(2)),
        parseFloat(topLeftLuminance.toFixed(2)),
        parseFloat(topRightLuminance.toFixed(2))
      ];
      
      // Check if regions have different characteristics (mixed backdrop)
      // Consider vertical contrasts between top and center/bottom
      const verticalContrast = Math.abs(topLuminance - centerLuminance) > 0.3 || 
                               Math.abs(topLuminance - bottomLuminance) > 0.3;
      
      // Check for horizontal contrast in the top region (important for logo placement)
      const horizontalTopContrast = Math.abs(topLeftLuminance - topRightLuminance) > 0.3;
      
      // Consider an image contrasting if either vertical or horizontal contrasts exist
      hasContrastingRegions = verticalContrast || horizontalTopContrast;
    } catch (regionError) {
      console.error('Error analyzing backdrop regions:', regionError)
      // If region analysis fails, continue with overall analysis
      regionLuminances = [luminance]
      hasContrastingRegions = false
    }
    
    // Determine if backdrop is mostly dark or light based on overall luminance
    const dominantArea = luminance > 0.5 ? 'light' : 'dark'
    
    return {
      luminance,
      dominantArea,
      regionLuminances,
      hasContrastingRegions
    }
  } catch (error) {
    console.error('Error processing backdrop image:', error)
    return null
  }
}

/**
 * Calculates relative luminance from RGB values
 * @param {number} r - Red channel value (0-255)
 * @param {number} g - Green channel value (0-255)
 * @param {number} b - Blue channel value (0-255)
 * @returns {number} - Luminance value between 0-1
 */
function calculateLuminance(r, g, b) {
  // Convert RGB values to the range 0-1
  const rSRGB = r / 255
  const gSRGB = g / 255
  const bSRGB = b / 255
  
  // Apply the standard relative luminance formula
  return 0.2126 * rSRGB + 0.7152 * gSRGB + 0.0722 * bSRGB
}

/**
 * Calculates contrast ratio between two luminance values
 * @param {number} luminance1 - First luminance value (0-1)
 * @param {number} luminance2 - Second luminance value (0-1)
 * @returns {number} - Contrast ratio
 */
function calculateContrastRatio(luminance1, luminance2) {
  const lighter = Math.max(luminance1, luminance2)
  const darker = Math.min(luminance1, luminance2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Analyzes the optimal logo placement and animation path for a screensaver
 * @param {number} logoLuminance - Luminance of the logo (0-1)
 * @param {Array<number>} regionLuminances - [top, center, bottom, topLeft, topRight]
 * @param {boolean} hasTransparency - Whether the logo has transparency
 * @param {string} preferPosition - Optional preferred position ('top', 'center', 'bottom')
 * @returns {Object} Recommendation with positions, path, and reasoning
 */
function analyzeOptimalLogoPlacement(logoLuminance, regionLuminances, hasTransparency, preferPosition) {
  if (!regionLuminances || regionLuminances.length < 3) {
    return {
      verticalPosition:   'center',
      horizontalPosition: 'center',
      startSide:          'left',
      animationPath:      'linear',
      reason:             'Insufficient region data, defaulting to center/linear'
    }
  }

  const [
    topLuminance,
    centerLuminance,
    bottomLuminance,
    topLeftLuminance,
    topRightLuminance
  ] = regionLuminances

  const topContrastRatio     = calculateContrastRatio(logoLuminance, topLuminance)
  const centerContrastRatio  = calculateContrastRatio(logoLuminance, centerLuminance)
  const bottomContrastRatio  = calculateContrastRatio(logoLuminance, bottomLuminance)
  const topLeftContrastRatio = calculateContrastRatio(logoLuminance, topLeftLuminance)
  const topRightContrastRatio= calculateContrastRatio(logoLuminance, topRightLuminance)

  // weighted vertical choice
  const weighted = [
    { position: 'top',    ratio: topContrastRatio },
    { position: 'center', ratio: centerContrastRatio * 1.2 },
    { position: 'bottom', ratio: bottomContrastRatio * 1.15 }
  ].sort((a, b) => b.ratio - a.ratio)

  let verticalPosition = weighted[0].position
  if (preferPosition) {
    const pref = weighted.find(w => w.position === preferPosition)
    if (pref && pref.ratio > weighted[0].ratio * 0.7) {
      verticalPosition = preferPosition
    }
  }

  // horizontal based on top-region halves
  const horizontalContrast = Math.abs(topLeftLuminance - topRightLuminance) > 0.3
  let horizontalPosition = 'center'
  if (horizontalContrast) {
    const similarLeft  = Math.abs(logoLuminance - topLeftLuminance) < 0.3
    const similarRight = Math.abs(logoLuminance - topRightLuminance) < 0.3

    if (similarLeft && !similarRight)       horizontalPosition = 'right'
    else if (!similarLeft && similarRight)  horizontalPosition = 'left'
    else horizontalPosition =
      topLeftContrastRatio > topRightContrastRatio ? 'left' : 'right'
  }

  const luminanceVariance = Math.max(
    Math.abs(topLuminance    - centerLuminance),
    Math.abs(centerLuminance - bottomLuminance),
    Math.abs(topLuminance    - bottomLuminance)
  )

  // SHORT‐CIRCUIT FOR UNIFORM BACKDROPS
  if (luminanceVariance < 0.05) {
    return {
      verticalPosition:   'bottom',
      horizontalPosition: 'center',
      startSide:          hasTransparency ? 'right' : 'left',
      animationPath:      'linear',
      contrastRatios: {
        top:      parseFloat(topContrastRatio.toFixed(2)),
        center:   parseFloat(centerContrastRatio.toFixed(2)),
        bottom:   parseFloat(bottomContrastRatio.toFixed(2)),
        topLeft:  parseFloat(topLeftContrastRatio.toFixed(2)),
        topRight: parseFloat(topRightContrastRatio.toFixed(2)),
      },
      regionLuminances: {
        top:      parseFloat(topLuminance.toFixed(2)),
        topLeft:  parseFloat(topLeftLuminance.toFixed(2)),
        topRight: parseFloat(topRightLuminance.toFixed(2)),
        logo:     parseFloat(logoLuminance.toFixed(2)),
      },
      horizontalContrast: false,
      luminanceVariance:  parseFloat(luminanceVariance.toFixed(2)),
      reason: `Uniform backdrop (variance ${luminanceVariance.toFixed(2)}) — bottom-center with linear animation.`
    }
  }

  // default animation & entry
  let startSide     = 'left'
  let animationPath = 'linear'

  if (luminanceVariance > 0.3) {
    // deep gradient logic
    if (Math.abs(topLuminance - bottomLuminance) > 0.25) {
      const isLogoDark   = logoLuminance < 0.5
      const isTopLighter = topLuminance > bottomLuminance

      if (hasTransparency) {
        startSide     = isLogoDark ? 'right' : 'left'
        animationPath = 'linear'
      } else {
        startSide     = (isLogoDark === isTopLighter) ? 'top' : 'bottom'
        animationPath = 'diagonal'
      }
    } else {
      startSide     = hasTransparency ? 'right' : 'left'
      animationPath = 'linear'
    }
  } else {
    // moderate variance: linear
    startSide     = hasTransparency ? 'right' : 'left'
    animationPath = 'linear'
  }

  const reasonParts = [
    `Positioned at ${verticalPosition} ${horizontalPosition} for optimal contrast.`,
    luminanceVariance > 0.3
      ? `High luminance variance (${luminanceVariance.toFixed(2)}) suggests a complex backdrop.`
      : `Moderate variance (${luminanceVariance.toFixed(2)}) — using linear animation.`,
    hasTransparency
      ? `Transparent logo with ${animationPath} entry.`
      : `Solid logo with ${animationPath} entry.`
  ]

  return {
    verticalPosition,
    horizontalPosition,
    startSide,
    animationPath,
    contrastRatios: {
      top:      parseFloat(topContrastRatio.toFixed(2)),
      center:   parseFloat(centerContrastRatio.toFixed(2)),
      bottom:   parseFloat(bottomContrastRatio.toFixed(2)),
      topLeft:  parseFloat(topLeftContrastRatio.toFixed(2)),
      topRight: parseFloat(topRightContrastRatio.toFixed(2)),
    },
    regionLuminances: {
      top:      parseFloat(topLuminance.toFixed(2)),
      topLeft:  parseFloat(topLeftLuminance.toFixed(2)),
      topRight: parseFloat(topRightLuminance.toFixed(2)),
      logo:     parseFloat(logoLuminance.toFixed(2)),
    },
    horizontalContrast,
    luminanceVariance: parseFloat(luminanceVariance.toFixed(2)),
    reason: reasonParts.join(' ')
  }
}

export const GET = async (req) => {
  try {
    // Parse URL to check for parameters
    const url = new URL(req.url)
    const analyzeContrast = url.searchParams.get('analyzeContrast') === 'true'
    const animationPlacement = url.searchParams.get('animationPlacement') === 'true'
    const preferPosition = url.searchParams.get('preferPosition') // Optional preferred position (top, center, bottom)
    
    // Check authentication first
    const authResult = await isAuthenticatedEither(req)
    if (authResult instanceof Response) {
      // Authentication failed, return the error response
      return authResult
    }

    // User is authenticated, proceed with fetching random banner media info
    const mediaResult = await fetchFlatRandomBannerMedia()
    if (mediaResult.error) {
      return new Response(JSON.stringify({ error: mediaResult.error }), {
        status: mediaResult.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Extract required data
    const responseData = {
      _id: mediaResult._id?.toString() || null,
      title: mediaResult.title || mediaResult.metadata?.title,
      logo: mediaResult.logo || null,
      backdrop: mediaResult.backdrop || null,
      type: mediaResult.type,
    }

    // Add blurhash if available
    if (mediaResult.backdropBlurhash) {
      responseData.backdropBlurhash = mediaResult.backdropBlurhash
    }

    // Extract network information if available
    if (mediaResult.metadata?.networks && mediaResult.metadata.networks.length > 0) {
      const firstNetwork = mediaResult.metadata.networks[0]
      responseData.network = {
        id: firstNetwork.id,
        name: firstNetwork.name,
        origin_country: firstNetwork.origin_country,
        logo_url: firstNetwork.logo_path ? getFullImageUrl(firstNetwork.logo_path) : null
      }
    }
    
    // Add contrast analysis if requested and we have both logo and backdrop
    if ((analyzeContrast || animationPlacement) && responseData.logo && responseData.backdrop) {
      const contrastAnalysis = await analyzeImageContrast(responseData.logo, responseData.backdrop)
      responseData.contrastAnalysis = contrastAnalysis
      
      // Add animation placement recommendations if requested
      if (animationPlacement) {
        responseData.animationPlacement = analyzeOptimalLogoPlacement(
          contrastAnalysis.logoLuminance,
          contrastAnalysis.regionLuminances,
          contrastAnalysis.logoHasTransparency,
          preferPosition
        )
      }
    }

    // Return JSON response
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Error fetching screensaver data:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch screensaver data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
