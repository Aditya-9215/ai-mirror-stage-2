// utils/measurements.js
export function extractPixelMeasurements(keypoints) {
  if (!keypoints || keypoints.length === 0) return null;

  const getKeypoint = (name) => keypoints.find((k) => k.name === name || k.part === name);

  const leftShoulder = getKeypoint("left_shoulder");
  const rightShoulder = getKeypoint("right_shoulder");
  const leftHip = getKeypoint("left_hip");
  const rightHip = getKeypoint("right_hip");
  const nose = getKeypoint("nose");

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip || !nose) return null;

  // Shoulder width in pixels
  const shoulderWidthPx = Math.hypot(
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y
  );

  // Torso height in pixels (approx from shoulders to hips)
  const torsoHeightPx = (leftHip.y + rightHip.y) / 2 - (leftShoulder.y + rightShoulder.y) / 2;

  // Full height in pixels (approx from nose to average of feet or hips)
  const fullHeightPx = keypoints.reduce((maxY, k) => Math.max(maxY, k.y), nose.y) - nose.y;

  // Chest circumference (approx as 1.3 × shoulder width)
  const chestPx = shoulderWidthPx * 1.3;

  return { shoulderWidthPx, torsoHeightPx, fullHeightPx, chestPx };
}
