import { useEffect, useRef, useState } from "react";
import * as posedetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs";

function PoseDetector({ onPoseDetected }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [detector, setDetector] = useState(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize TensorFlow FIRST
  const initTensorFlow = async () => {
    try {
      // Wait for TensorFlow to be ready
      await tf.ready();
      
      // Set backend explicitly (use 'webgl' for better compatibility)
      await tf.setBackend('webgl');
      
      console.log('TensorFlow backend:', tf.getBackend());
      setIsReady(true);
    } catch (error) {
      console.error('TensorFlow initialization error:', error);
    }
  };

  // Initialize camera
  const setupCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera not available");
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Wait for video to load metadata before playing
        videoRef.current.onloadedmetadata = async () => {
          try {
            await videoRef.current.play();
            console.log('Camera started successfully');
          } catch (error) {
            console.error('Video play error:', error);
          }
        };
      }
    } catch (error) {
      console.error('Camera setup error:', error);
      alert('Could not access camera: ' + error.message);
    }
  };

  // Initialize Pose Detector (only after TensorFlow is ready)
  const initDetector = async () => {
    if (!isReady) return;
    
    try {
      const detectorConfig = {
        modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      };
      const d = await posedetection.createDetector(
        posedetection.SupportedModels.MoveNet,
        detectorConfig
      );
      setDetector(d);
      console.log('Pose detector initialized');
    } catch (error) {
      console.error('Detector initialization error:', error);
    }
  };

  // Draw keypoints on canvas
  const drawResults = (pose) => {
    if (!canvasRef.current || !videoRef.current) return;
    
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.drawImage(videoRef.current, 0, 0, 640, 480);

    if (pose && pose.keypoints) {
      pose.keypoints.forEach((kp) => {
        const { x, y, score, name } = kp;
        if (score > 0.3) {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, 2 * Math.PI);
          ctx.fillStyle = "red";
          ctx.fill();
          ctx.font = "10px Arial";
          ctx.fillStyle = "white";
          ctx.fillText(name, x + 6, y + 6);
        }
      });
    }
  };

  // Run pose detection loop
  const detectPose = async () => {
    if (!detector || !videoRef.current || videoRef.current.readyState !== 4) {
      requestAnimationFrame(detectPose);
      return;
    }

    try {
      const poses = await detector.estimatePoses(videoRef.current);
      
      if (poses && poses[0]) {
        drawResults(poses[0]);

        if (onPoseDetected) {
          onPoseDetected({
            pose: poses[0],
            keypoints: poses[0].keypoints
          });
        }
      }
    } catch (error) {
      console.error('Pose detection error:', error);
    }

    requestAnimationFrame(detectPose);
  };

  // Initialize in correct order
  useEffect(() => {
    initTensorFlow();
  }, []);

  useEffect(() => {
    if (isReady) {
      setupCamera();
      initDetector();
    }
  }, [isReady]);

  useEffect(() => {
    if (detector && videoRef.current) {
      detectPose();
    }
  }, [detector]);

  return (
    <div style={{ position: "relative", width: "640px", height: "480px" }}>
      <video
        ref={videoRef}
        width="640"
        height="480"
        style={{ position: "absolute", top: 0, left: 0 }}
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        width="640"
        height="480"
        style={{ position: "absolute", top: 0, left: 0 }}
      />
    </div>
  );
}

export default PoseDetector;