export async function detectDeviceCapabilities() {
  const capabilities = {
    hasCamera: false,
    hasDepth: false,
    platform: 'unknown',
    recommendedMode: '2D', // default fallback
  };

  // Check for camera access
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (stream) {
      capabilities.hasCamera = true;
      // stop all tracks immediately
      stream.getTracks().forEach(track => track.stop());
    }
  } catch (err) {
    console.warn("Camera not accessible:", err);
    capabilities.hasCamera = false;
  }

  // Check for WebXR depth support (experimental, mainly for ARCore / LiDAR)
  if (navigator.xr && navigator.xr.isSessionSupported) {
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (supported) {
        capabilities.hasDepth = true;
        capabilities.recommendedMode = '3D';
      }
    } catch (err) {
      console.warn("WebXR depth not available:", err);
    }
  }

  // Detect platform
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) capabilities.platform = 'iOS';
  else if (/Android/i.test(ua)) capabilities.platform = 'Android';
  else capabilities.platform = 'Desktop';

  return capabilities;
}
