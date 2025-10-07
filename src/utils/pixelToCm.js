/**
 * Convert pixel measurement to centimeters using FOV approximation
 * 
 * @param {number} pixels - distance in pixels
 * @param {number} videoHeightPx - height of the video in pixels
 * @param {number} realUserHeightCm - actual user height in cm (measured or estimated)
 * @returns {number} distance in centimeters
 */
export function pxToCm(pixels, videoHeightPx, realUserHeightCm) {
  // Calculate scaling factor
  // scale = real height / pixel height
  const scale = realUserHeightCm / videoHeightPx;
  return pixels * scale;
}
