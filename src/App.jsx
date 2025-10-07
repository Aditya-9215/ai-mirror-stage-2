import { useState, useRef } from "react";
import PoseDetector from "./components/PoseDetector";
import { extractPixelMeasurements } from "./utils/measurements";
import { pxToCm } from "./utils/pixelToCm";

function App() {
  const [showPrivacy, setShowPrivacy] = useState(true);
  const [mode, setMode] = useState(null);
  const [heightInput, setHeightInput] = useState("");
  const [userHeight, setUserHeight] = useState(null);
  const [referenceInput, setReferenceInput] = useState("");
  const [referenceHeightCm, setReferenceHeightCm] = useState(null);
  const [measurements, setMeasurements] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const isCapturingRef = useRef(false); // Add ref to avoid closure issues
  const [showInstructions, setShowInstructions] = useState(true);
  const [poseQuality, setPoseQuality] = useState(null); // "good", "too-close", "too-far", "partial"

  const measurementHistory = useRef([]);
  const maxHistory = 10; // Reduced from 20
  const stabilityThreshold = 5; // Increased from 2 (allows more variance)

  const handleHeightSubmit = () => {
    const height = Number(heightInput);
    if (height > 0 && height < 300) {
      setUserHeight(height);
    } else {
      alert("Please enter a valid height between 1-300 cm");
    }
  };

  const handleReferenceSubmit = () => {
    const refHeight = Number(referenceInput);
    if (refHeight > 0 && refHeight < 100) {
      setReferenceHeightCm(refHeight);
    } else {
      alert("Please enter a valid reference height");
    }
  };

  const startCountdown = () => {
    setShowInstructions(false);
    setCountdown(3);
    let counter = 3;
    const interval = setInterval(() => {
      counter -= 1;
      if (counter === 0) {
        clearInterval(interval);
        setCountdown(null);
        setIsCapturing(true);
        console.log("🎯 CAPTURING STARTED!");
      } else {
        setCountdown(counter);
      }
    }, 1000);
  };

  const resetMeasurement = () => {
    setMeasurements(null);
    setIsCapturing(false);
    setCountdown(null);
    setShowInstructions(true);
    measurementHistory.current = [];
    setPoseQuality(null);
  };

  const checkPoseQuality = (pose) => {
    const keypoints = pose.keypoints || pose;
    
    if (!keypoints || keypoints.length === 0) {
      console.log("No keypoints for quality check");
      return "no-pose";
    }

    const requiredKeypoints = [
      "nose", "left_shoulder", "right_shoulder", 
      "left_hip", "right_hip", "left_ankle", "right_ankle"
    ];
    
    const visibleKeypoints = requiredKeypoints.filter(name => {
      const kp = keypoints.find(k => k.name === name);
      return kp && kp.score > 0.3;
    });

    console.log("Visible keypoints:", visibleKeypoints.length, "/", requiredKeypoints.length);

    // Check if all body parts are visible
    if (visibleKeypoints.length < requiredKeypoints.length - 1) {
      return "partial";
    }

    // Check distance based on shoulder width
    const leftShoulder = keypoints.find(k => k.name === "left_shoulder");
    const rightShoulder = keypoints.find(k => k.name === "right_shoulder");
    
    if (leftShoulder && rightShoulder) {
      const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
      console.log("Shoulder width (pixels):", shoulderWidth);
      
      // Ideal shoulder width should be between 60-220 pixels for 640px width
      if (shoulderWidth < 60) return "too-far";
      if (shoulderWidth > 220) return "too-close";
    }

    return "good";
  };

  const handlePose = (poseData) => {
    // Handle data structure from PoseDetector
    const keypoints = poseData.keypoints || poseData.pose?.keypoints;
    
    console.log("isCapturing state:", isCapturing); // DEBUG LOG
    
    if (!keypoints || keypoints.length === 0) {
      console.log("No keypoints detected");
      return;
    }

    // Always check pose quality for visual feedback
    const quality = checkPoseQuality({ keypoints });
    setPoseQuality(quality);
    
    console.log("Current pose quality:", quality);

    // Only capture measurements if capturing is active and pose is good
    if (!isCapturing) {
      console.log("Not capturing yet (waiting for countdown)");
      return;
    }
    
    if (quality !== "good") {
      console.log("Pose not good enough, quality:", quality);
      return;
    }
    
    if (mode === "manual" && !userHeight) return;
    if (mode === "reference" && !referenceHeightCm) return;

    const pixels = extractPixelMeasurements(keypoints);
    if (!pixels) {
      console.log("Could not extract measurements");
      return;
    }
    
    console.log("Pixel measurements:", pixels);

    measurementHistory.current.push(pixels);
    if (measurementHistory.current.length > maxHistory)
      measurementHistory.current.shift();

    if (!checkStability(measurementHistory.current)) return;

    const scaleHeightCm = mode === "manual" ? userHeight : referenceHeightCm;
    const shoulderCm = pxToCm(pixels.shoulderWidthPx, 480, scaleHeightCm);
    const torsoCm = pxToCm(pixels.torsoHeightPx, 480, scaleHeightCm);
    const fullHeightCm = pxToCm(pixels.fullHeightPx, 480, scaleHeightCm);
    const chestCm = pxToCm(pixels.chestPx, 480, scaleHeightCm);

    console.log("✅ MEASUREMENTS CALCULATED:", {
      shoulderCm: shoulderCm.toFixed(1),
      torsoCm: torsoCm.toFixed(1),
      fullHeightCm: fullHeightCm.toFixed(1),
      chestCm: chestCm.toFixed(1),
    });

    setMeasurements({
      shoulderCm: shoulderCm.toFixed(1),
      torsoCm: torsoCm.toFixed(1),
      fullHeightCm: fullHeightCm.toFixed(1),
      chestCm: chestCm.toFixed(1),
    });
    
    setIsCapturing(false); // Stop capturing after successful measurement
  };

  const checkStability = (history) => {
    if (history.length < maxHistory) {
      console.log(`Collecting measurements: ${history.length}/${maxHistory}`);
      return false;
    }

    const avg = { shoulder: 0, torso: 0, full: 0, chest: 0 };
    history.forEach((m) => {
      avg.shoulder += m.shoulderWidthPx;
      avg.torso += m.torsoHeightPx;
      avg.full += m.fullHeightPx;
      avg.chest += m.chestPx;
    });
    avg.shoulder /= history.length;
    avg.torso /= history.length;
    avg.full /= history.length;
    avg.chest /= history.length;

    const variance = { shoulder: 0, torso: 0, full: 0, chest: 0 };
    history.forEach((m) => {
      variance.shoulder += Math.pow(m.shoulderWidthPx - avg.shoulder, 2);
      variance.torso += Math.pow(m.torsoHeightPx - avg.torso, 2);
      variance.full += Math.pow(m.fullHeightPx - avg.full, 2);
      variance.chest += Math.pow(m.chestPx - avg.chest, 2);
    });
    variance.shoulder /= history.length;
    variance.torso /= history.length;
    variance.full /= history.length;
    variance.chest /= history.length;

    console.log("Variance:", variance);

    const isStable = (
      variance.shoulder < stabilityThreshold &&
      variance.torso < stabilityThreshold &&
      variance.full < stabilityThreshold &&
      variance.chest < stabilityThreshold
    );

    if (isStable) {
      console.log("✅ STABLE MEASUREMENTS ACHIEVED!");
    }

    return isStable;
  };

  // Privacy Screen
  if (showPrivacy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
        <div className="max-w-2xl w-full bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/50 transform transition-all duration-500 hover:scale-105">
          <div className="text-center mb-6">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Privacy Policy
            </h2>
          </div>
          <div className="space-y-4 text-lg text-gray-700 mb-8">
            <div className="flex items-start gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
              <span className="text-2xl">🔒</span>
              <p>All processing happens locally in your browser. No video or personal data is uploaded.</p>
            </div>
            <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-200">
              <span className="text-2xl">💾</span>
              <p>Measurements are only stored temporarily and are not shared with anyone.</p>
            </div>
            <div className="flex items-start gap-3 p-4 bg-purple-50 rounded-xl border border-purple-200">
              <span className="text-2xl">📥</span>
              <p>You can download your measurements for personal use anytime.</p>
            </div>
          </div>
          <button 
            onClick={() => setShowPrivacy(false)}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-300"
          >
            I Understand & Continue →
          </button>
        </div>
      </div>
    );
  }

  // Mode Selection Screen
  if (!mode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
        <div className="max-w-4xl w-full bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl p-10 border border-white/50">
          <div className="text-center mb-8">
            <h2 className="text-5xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mb-4">
              Welcome to Body Measurement System
            </h2>
            <p className="text-xl text-gray-600">Choose your preferred calibration method</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <button 
              onClick={() => setMode("manual")}
              className="group p-8 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200 hover:border-blue-400 hover:shadow-2xl transform hover:scale-105 transition-all duration-300"
            >
              <div className="text-5xl mb-4">📏</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-3">Manual Height Input</h3>
              <p className="text-gray-600">Quick and simple - just enter your height</p>
            </button>
            <button 
              onClick={() => setMode("reference")}
              className="group p-8 bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl border-2 border-purple-200 hover:border-purple-400 hover:shadow-2xl transform hover:scale-105 transition-all duration-300"
            >
              <div className="text-5xl mb-4">📐</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-3">Reference Object</h3>
              <p className="text-gray-600">Use a credit card or A4 paper for calibration</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main Measurement Screen
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-5xl font-bold text-gray-900 mb-2">
            Body Measurements
          </h1>
          <p className="text-xl text-gray-600">Perfect fit for online shopping</p>
        </div>

        {/* Input Section */}
        {!measurements && (
          <div className="bg-white/90 backdrop-blur-md rounded-3xl shadow-xl p-8 mb-6 border border-white/50">
            {mode === "manual" && !userHeight && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <label className="text-lg font-semibold text-gray-700">
                  Enter your height (cm):
                </label>
                <input
                  type="number"
                  value={heightInput}
                  onChange={(e) => setHeightInput(e.target.value)}
                  placeholder="e.g., 175"
                  className="px-6 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all text-lg"
                />
                <button 
                  onClick={handleHeightSubmit}
                  className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300"
                >
                  Submit Height
                </button>
              </div>
            )}

            {mode === "reference" && !referenceHeightCm && (
              <div className="space-y-4">
                <p className="text-lg text-gray-700 text-center">
                  Place a reference object (credit card or A4 paper) vertically in front of you
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <input
                    type="number"
                    value={referenceInput}
                    onChange={(e) => setReferenceInput(e.target.value)}
                    placeholder="e.g., 8.5 (card) or 29.7 (A4)"
                    className="px-6 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all text-lg"
                  />
                  <button 
                    onClick={handleReferenceSubmit}
                    className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300"
                  >
                    Submit Reference
                  </button>
                </div>
              </div>
            )}

            {userHeight && mode === "manual" && (
              <div className="flex items-center justify-center gap-3 py-3 px-6 bg-green-50 rounded-xl border-2 border-green-300">
                <span className="text-2xl">✓</span>
                <p className="text-lg font-semibold text-green-700">
                  Height confirmed: {userHeight} cm
                </p>
              </div>
            )}

            {referenceHeightCm && mode === "reference" && (
              <div className="flex items-center justify-center gap-3 py-3 px-6 bg-green-50 rounded-xl border-2 border-green-300">
                <span className="text-2xl">✓</span>
                <p className="text-lg font-semibold text-green-700">
                  Reference confirmed: {referenceHeightCm} cm
                </p>
              </div>
            )}

            {(userHeight || referenceHeightCm) && !isCapturing && !countdown && (
              <div className="text-center mt-6">
                <button 
                  onClick={startCountdown}
                  className="px-12 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xl font-bold rounded-xl shadow-lg hover:shadow-2xl hover:scale-110 transform transition-all duration-300"
                >
                  🎯 Start Measurement
                </button>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {showInstructions && (userHeight || referenceHeightCm) && !measurements && (
          <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-3xl shadow-xl p-8 mb-6 border-2 border-yellow-300">
            <h3 className="text-2xl font-bold text-orange-700 mb-4 flex items-center gap-2">
              <span>📋</span> How to Stand for Accurate Measurements
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-xl">
                <div className="text-3xl mb-2">📏</div>
                <h4 className="font-bold text-gray-800 mb-2">Distance</h4>
                <p className="text-gray-600">Stand 6-8 feet (2-2.5 meters) away from camera</p>
              </div>
              <div className="bg-white p-4 rounded-xl">
                <div className="text-3xl mb-2">🧍</div>
                <h4 className="font-bold text-gray-800 mb-2">Position</h4>
                <p className="text-gray-600">Face camera directly. Your full body should be visible from head to feet</p>
              </div>
              <div className="bg-white p-4 rounded-xl">
                <div className="text-3xl mb-2">⏱️</div>
                <h4 className="font-bold text-gray-800 mb-2">Stay Still</h4>
                <p className="text-gray-600">Stand still with arms slightly away from body during measurement</p>
              </div>
            </div>
          </div>
        )}

        {/* Countdown */}
        {countdown && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="text-center">
              <div className="text-9xl font-black bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent animate-pulse">
                {countdown}
              </div>
              <p className="text-white text-2xl mt-4">Get Ready!</p>
            </div>
          </div>
        )}

        {/* Camera with Live Feedback */}
        <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white/50 bg-gray-900 mb-6">
          <PoseDetector onPoseDetected={handlePose} />
          
          {/* Live Pose Quality Feedback */}
          {(userHeight || referenceHeightCm) && !measurements && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
              {poseQuality === "good" && isCapturing && (
                <div className="bg-green-500 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                  <span>✓</span> Perfect! Hold Still...
                </div>
              )}
              {poseQuality === "too-close" && (
                <div className="bg-red-500 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                  <span>⚠️</span> Too Close! Step Back
                </div>
              )}
              {poseQuality === "too-far" && (
                <div className="bg-orange-500 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                  <span>⚠️</span> Too Far! Step Closer
                </div>
              )}
              {poseQuality === "partial" && (
                <div className="bg-yellow-500 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                  <span>⚠️</span> Show Full Body
                </div>
              )}
            </div>
          )}
        </div>

        {/* Measurements Display */}
        {measurements && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-3xl shadow-2xl p-8 border-2 border-green-300 animate-fadeIn">
            <div className="flex items-center justify-center gap-3 mb-6">
              <span className="text-4xl">✓</span>
              <h3 className="text-3xl font-bold text-green-700">Your Measurements</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-white p-6 rounded-xl border-l-4 border-green-500 hover:shadow-lg transition-all">
                <p className="text-gray-600 mb-1">Shoulder Width</p>
                <p className="text-2xl font-bold text-gray-800">
                  {measurements.shoulderCm} cm 
                  <span className="text-lg text-gray-500 ml-2">
                    ({(measurements.shoulderCm / 2.54).toFixed(1)} in)
                  </span>
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl border-l-4 border-blue-500 hover:shadow-lg transition-all">
                <p className="text-gray-600 mb-1">Torso Height</p>
                <p className="text-2xl font-bold text-gray-800">
                  {measurements.torsoCm} cm 
                  <span className="text-lg text-gray-500 ml-2">
                    ({(measurements.torsoCm / 2.54).toFixed(1)} in)
                  </span>
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl border-l-4 border-purple-500 hover:shadow-lg transition-all">
                <p className="text-gray-600 mb-1">Full Height</p>
                <p className="text-2xl font-bold text-gray-800">
                  {measurements.fullHeightCm} cm 
                  <span className="text-lg text-gray-500 ml-2">
                    ({(measurements.fullHeightCm / 2.54).toFixed(1)} in)
                  </span>
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl border-l-4 border-orange-500 hover:shadow-lg transition-all">
                <p className="text-gray-600 mb-1">Chest Circumference</p>
                <p className="text-2xl font-bold text-gray-800">
                  {measurements.chestCm} cm 
                  <span className="text-lg text-gray-500 ml-2">
                    ({(measurements.chestCm / 2.54).toFixed(1)} in)
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  const dataStr =
                    "data:text/json;charset=utf-8," +
                    encodeURIComponent(JSON.stringify(measurements));
                  const dlAnchorElem = document.createElement("a");
                  dlAnchorElem.setAttribute("href", dataStr);
                  dlAnchorElem.setAttribute("download", "measurements.json");
                  dlAnchorElem.click();
                }}
                className="flex-1 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2"
              >
                <span>📥</span> Download Measurements
              </button>
              <button
                onClick={resetMeasurement}
                className="flex-1 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2"
              >
                <span>🔄</span> Measure Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;