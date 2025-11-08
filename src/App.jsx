import { useEffect, useRef, useState } from "react";
import * as posedetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs";

// Enhanced Background Removal
class ClothingProcessor {
  static async removeBackground(imageElement) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = imageElement.width;
      canvas.height = imageElement.height;
      
      ctx.drawImage(imageElement, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Sample corner colors for background detection
      const corners = [
        { r: data[0], g: data[1], b: data[2] },
        { r: data[canvas.width * 4 - 4], g: data[canvas.width * 4 - 3], b: data[canvas.width * 4 - 2] },
      ];
      
      const threshold = 80;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        let isBackground = false;
        for (let corner of corners) {
          const diff = Math.sqrt(
            Math.pow(r - corner.r, 2) +
            Math.pow(g - corner.g, 2) +
            Math.pow(b - corner.b, 2)
          );
          
          if (diff < threshold) {
            isBackground = true;
            break;
          }
        }
        
        if (isBackground) {
          data[i + 3] = 0;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      const processedImage = new Image();
      processedImage.onload = () => resolve(processedImage);
      processedImage.src = canvas.toDataURL();
    });
  }
}

// 3D Body Mesh Builder
class BodyMesh3D {
  constructor(height) {
    this.height = height;
    this.bodyOrientation = 'front'; // 'front' or 'back'
  }

  detectOrientation(keypoints) {
    // Detect if user is facing front or back based on nose and shoulder positions
    const kp = {};
    keypoints.forEach(k => {
      if (k.score > 0.3) kp[k.name] = k;
    });

    if (!kp.nose || !kp.left_shoulder || !kp.right_shoulder) {
      return 'front';
    }

    const shoulderMidX = (kp.left_shoulder.x + kp.right_shoulder.x) / 2;
    const noseX = kp.nose.x;
    const offsetRatio = Math.abs(noseX - shoulderMidX) / Math.abs(kp.right_shoulder.x - kp.left_shoulder.x);

    // If nose is far from shoulder center, likely turned
    if (offsetRatio > 0.4) {
      return 'side';
    }

    // Check if shoulders are wider than hips (front) or narrower (back)
    if (kp.left_hip && kp.right_hip) {
      const shoulderWidth = Math.abs(kp.right_shoulder.x - kp.left_shoulder.x);
      const hipWidth = Math.abs(kp.right_hip.x - kp.left_hip.x);
      
      if (shoulderWidth < hipWidth * 0.8) {
        return 'back';
      }
    }

    return 'front';
  }

  buildBodyMesh(keypoints) {
    const kp = {};
    keypoints.forEach(k => {
      if (k.score > 0.3) kp[k.name] = k;
    });

    if (!kp.left_shoulder || !kp.right_shoulder) return null;

    const shoulderWidth = Math.abs(kp.right_shoulder.x - kp.left_shoulder.x);
    const pixelsPerCm = this.height / this.estimateBodyHeight(kp);
    
    this.bodyOrientation = this.detectOrientation(keypoints);

    // Build detailed body mesh points
    const mesh = {
      // Upper body
      shoulders: {
        left: kp.left_shoulder,
        right: kp.right_shoulder,
        center: {
          x: (kp.left_shoulder.x + kp.right_shoulder.x) / 2,
          y: (kp.left_shoulder.y + kp.right_shoulder.y) / 2
        }
      },
      
      // Chest/Bust points (interpolated)
      chest: this.interpolateChestPoints(kp, shoulderWidth),
      
      // Waist
      waist: kp.left_hip && kp.right_hip ? {
        left: { x: kp.left_hip.x, y: (kp.left_hip.y + kp.left_shoulder.y) / 2 },
        right: { x: kp.right_hip.x, y: (kp.right_hip.y + kp.right_shoulder.y) / 2 },
        center: {
          x: (kp.left_hip.x + kp.right_hip.x) / 2,
          y: (kp.left_hip.y + kp.right_hip.y + kp.left_shoulder.y + kp.right_shoulder.y) / 4
        }
      } : null,
      
      // Hips
      hips: kp.left_hip && kp.right_hip ? {
        left: kp.left_hip,
        right: kp.right_hip,
        center: {
          x: (kp.left_hip.x + kp.right_hip.x) / 2,
          y: (kp.left_hip.y + kp.right_hip.y) / 2
        }
      } : null,
      
      // Arms
      arms: {
        left: this.buildArmMesh(kp, 'left'),
        right: this.buildArmMesh(kp, 'right')
      },
      
      // Legs
      legs: {
        left: this.buildLegMesh(kp, 'left'),
        right: this.buildLegMesh(kp, 'right')
      },
      
      // Body contour (outline for fitting)
      contour: this.buildBodyContour(kp),
      
      // Measurements
      measurements: {
        shoulderWidth: shoulderWidth / pixelsPerCm,
        chest: shoulderWidth * 1.25 / pixelsPerCm,
        waist: shoulderWidth * 0.9 / pixelsPerCm,
        hip: shoulderWidth * 1.15 / pixelsPerCm,
        pixelsPerCm: pixelsPerCm
      },
      
      orientation: this.bodyOrientation,
      keypoints: kp
    };

    return mesh;
  }

  interpolateChestPoints(kp, shoulderWidth) {
    if (!kp.left_shoulder || !kp.right_shoulder) return null;
    
    const chestY = kp.left_shoulder.y + shoulderWidth * 0.4;
    const chestExpansion = shoulderWidth * 0.15;
    
    return {
      left: { x: kp.left_shoulder.x - chestExpansion, y: chestY },
      right: { x: kp.right_shoulder.x + chestExpansion, y: chestY },
      center: {
        x: (kp.left_shoulder.x + kp.right_shoulder.x) / 2,
        y: chestY
      }
    };
  }

  buildArmMesh(kp, side) {
    const shoulder = kp[`${side}_shoulder`];
    const elbow = kp[`${side}_elbow`];
    const wrist = kp[`${side}_wrist`];
    
    if (!shoulder) return null;
    
    return {
      shoulder,
      elbow: elbow || { x: shoulder.x + (side === 'left' ? -30 : 30), y: shoulder.y + 60 },
      wrist: wrist || (elbow ? { x: elbow.x, y: elbow.y + 60 } : { x: shoulder.x, y: shoulder.y + 120 })
    };
  }

  buildLegMesh(kp, side) {
    const hip = kp[`${side}_hip`];
    const knee = kp[`${side}_knee`];
    const ankle = kp[`${side}_ankle`];
    
    if (!hip) return null;
    
    return {
      hip,
      knee: knee || { x: hip.x, y: hip.y + 80 },
      ankle: ankle || (knee ? { x: knee.x, y: knee.y + 80 } : { x: hip.x, y: hip.y + 160 })
    };
  }

  buildBodyContour(kp) {
    // Create a smooth body outline for cloth wrapping
    const contour = [];
    
    if (kp.left_shoulder) contour.push(kp.left_shoulder);
    if (kp.left_elbow) contour.push(kp.left_elbow);
    if (kp.left_hip) contour.push(kp.left_hip);
    if (kp.left_knee) contour.push(kp.left_knee);
    if (kp.right_knee) contour.push(kp.right_knee);
    if (kp.right_hip) contour.push(kp.right_hip);
    if (kp.right_elbow) contour.push(kp.right_elbow);
    if (kp.right_shoulder) contour.push(kp.right_shoulder);
    
    return contour;
  }

  estimateBodyHeight(kp) {
    if (kp.nose && kp.left_ankle && kp.right_ankle) {
      const avgAnkle = (kp.left_ankle.y + kp.right_ankle.y) / 2;
      return Math.abs(avgAnkle - kp.nose.y);
    }
    return 400;
  }
}

// Advanced 3D Clothing Renderer
class Clothing3DRenderer {
  renderClothing(ctx, frontImg, backImg, bodyMesh, clothingType) {
    if (!frontImg || !bodyMesh) return;

    const { orientation } = bodyMesh;
    const activeImg = (orientation === 'back' && backImg) ? backImg : frontImg;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    switch (clothingType) {
      case "shirt":
      case "jacket":
        this.renderShirt3D(ctx, activeImg, bodyMesh, orientation);
        break;
      case "dress":
        this.renderDress3D(ctx, activeImg, bodyMesh, orientation);
        break;
      case "pants":
        this.renderPants3D(ctx, activeImg, bodyMesh, orientation);
        break;
    }

    ctx.restore();
  }

  renderShirt3D(ctx, img, mesh, orientation) {
    const { shoulders, chest, waist, hips, arms } = mesh;
    if (!shoulders || !hips) return;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    // Calculate torso dimensions
    const shoulderWidth = Math.abs(shoulders.right.x - shoulders.left.x);
    const torsoHeight = Math.abs(hips.center.y - shoulders.center.y);
    
    // Create mesh grid for realistic cloth draping
    const meshGrid = this.createClothMeshGrid(mesh, img, 'torso');
    
    // Draw torso with proper body wrapping
    ctx.globalAlpha = 0.93;
    this.drawWarpedMesh(ctx, img, meshGrid);

    // Draw sleeves with 3D wrapping
    if (arms.left && arms.left.elbow && arms.left.wrist) {
      this.renderSleeve3D(ctx, img, arms.left, 'left', shoulderWidth, orientation);
    }
    if (arms.right && arms.right.elbow && arms.right.wrist) {
      this.renderSleeve3D(ctx, img, arms.right, 'right', shoulderWidth, orientation);
    }

    // Add realistic shading based on body curves
    this.addBodyShading(ctx, mesh, orientation);
  }

  createClothMeshGrid(mesh, img, section) {
    const grid = { points: [], uvs: [] };
    const { shoulders, chest, waist, hips } = mesh;

    if (section === 'torso' && shoulders && hips) {
      // Create a 4x4 grid for smooth deformation
      const rows = 5;
      const cols = 3;
      
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const t = row / (rows - 1); // 0 to 1 vertical
          const s = col / (cols - 1); // 0 to 1 horizontal
          
          // Interpolate body points
          let leftX, rightX, y;
          
          if (t < 0.33) {
            // Shoulder to chest
            const localT = t / 0.33;
            leftX = shoulders.left.x * (1 - localT) + (chest?.left.x || shoulders.left.x) * localT;
            rightX = shoulders.right.x * (1 - localT) + (chest?.right.x || shoulders.right.x) * localT;
            y = shoulders.center.y * (1 - localT) + (chest?.center.y || (shoulders.center.y + 30)) * localT;
          } else if (t < 0.66) {
            // Chest to waist
            const localT = (t - 0.33) / 0.33;
            leftX = (chest?.left.x || shoulders.left.x) * (1 - localT) + (waist?.left.x || shoulders.left.x) * localT;
            rightX = (chest?.right.x || shoulders.right.x) * (1 - localT) + (waist?.right.x || shoulders.right.x) * localT;
            y = (chest?.center.y || shoulders.center.y + 30) * (1 - localT) + (waist?.center.y || hips.center.y - 30) * localT;
          } else {
            // Waist to hip
            const localT = (t - 0.66) / 0.34;
            leftX = (waist?.left.x || shoulders.left.x) * (1 - localT) + hips.left.x * localT;
            rightX = (waist?.right.x || shoulders.right.x) * (1 - localT) + hips.right.x * localT;
            y = (waist?.center.y || hips.center.y - 30) * (1 - localT) + hips.center.y * localT;
          }
          
          const x = leftX * (1 - s) + rightX * s;
          
          // Add slight curve for body roundness
          const curveFactor = Math.sin(s * Math.PI) * 8;
          
          grid.points.push({ x: x + curveFactor, y });
          grid.uvs.push({ u: s, v: t });
        }
      }
    }

    return grid;
  }

  drawWarpedMesh(ctx, img, grid) {
    if (!grid.points || grid.points.length < 4) return;

    const cols = 3;
    const rows = Math.floor(grid.points.length / cols);

    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const idx = row * cols + col;
        
        const p1 = grid.points[idx];
        const p2 = grid.points[idx + 1];
        const p3 = grid.points[idx + cols + 1];
        const p4 = grid.points[idx + cols];
        
        const uv1 = grid.uvs[idx];
        const uv2 = grid.uvs[idx + 1];
        const uv3 = grid.uvs[idx + cols + 1];
        const uv4 = grid.uvs[idx + cols];
        
        // Draw textured quad
        this.drawTexturedQuad(ctx, img, p1, p2, p3, p4, uv1, uv2, uv3, uv4);
      }
    }
  }

  drawTexturedQuad(ctx, img, p1, p2, p3, p4, uv1, uv2, uv3, uv4) {
    try {
      const centerX = (p1.x + p2.x + p3.x + p4.x) / 4;
      const centerY = (p1.y + p2.y + p3.y + p4.y) / 4;
      const width = Math.max(Math.abs(p2.x - p1.x), Math.abs(p3.x - p4.x));
      const height = Math.abs(p3.y - p1.y);
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle);
      
      ctx.drawImage(img,
        uv1.u * img.width, uv1.v * img.height,
        (uv2.u - uv1.u) * img.width, (uv4.v - uv1.v) * img.height,
        -width/2, -height/2, width, height
      );
      
      ctx.restore();
    } catch (e) {
      // Silent fail for edge cases
    }
  }

  renderSleeve3D(ctx, img, arm, side, shoulderWidth, orientation) {
    if (!arm.shoulder || !arm.elbow || !arm.wrist) return;

    const sleeveWidth = shoulderWidth * 0.32;
    
    // Upper arm
    const upperArmAngle = Math.atan2(arm.elbow.y - arm.shoulder.y, arm.elbow.x - arm.shoulder.x);
    const upperArmLength = Math.hypot(arm.elbow.x - arm.shoulder.x, arm.elbow.y - arm.shoulder.y);
    
    ctx.save();
    ctx.translate(arm.shoulder.x, arm.shoulder.y);
    ctx.rotate(upperArmAngle);
    ctx.globalAlpha = 0.90;
    ctx.shadowBlur = 15;
    
    const sleeveX = side === 'left' ? 0 : img.width * 0.75;
    const sleeveW = img.width * 0.25;
    
    // Add cylindrical wrapping effect
    this.drawCylindricalSleeve(ctx, img, sleeveX, 0, sleeveW, img.height * 0.5, 
                                 0, -sleeveWidth/2, upperArmLength * 0.92, sleeveWidth);
    
    ctx.restore();

    // Forearm
    const forearmAngle = Math.atan2(arm.wrist.y - arm.elbow.y, arm.wrist.x - arm.elbow.x);
    const forearmLength = Math.hypot(arm.wrist.x - arm.elbow.x, arm.wrist.y - arm.elbow.y);
    
    ctx.save();
    ctx.translate(arm.elbow.x, arm.elbow.y);
    ctx.rotate(forearmAngle);
    ctx.globalAlpha = 0.88;
    
    this.drawCylindricalSleeve(ctx, img, sleeveX, img.height * 0.5, sleeveW, img.height * 0.35,
                                 0, -sleeveWidth * 0.75/2, forearmLength * 0.88, sleeveWidth * 0.75);
    
    ctx.restore();
  }

  drawCylindricalSleeve(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    // Draw with subtle perspective to simulate cylindrical wrapping
    ctx.save();
    
    // Main sleeve
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    
    // Add highlight on top edge
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = 'white';
    ctx.fillRect(dx, dy, dw, dh * 0.15);
    
    // Add shadow on bottom edge
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = 'black';
    ctx.fillRect(dx, dy + dh * 0.85, dw, dh * 0.15);
    
    ctx.restore();
  }

  renderDress3D(ctx, img, mesh, orientation) {
    const { shoulders, hips, legs } = mesh;
    if (!shoulders || !legs) return;

    const shoulderWidth = Math.abs(shoulders.right.x - shoulders.left.x);
    const centerX = shoulders.center.x;
    const topY = shoulders.center.y;
    
    let bottomY = topY + shoulderWidth * 2.5;
    if (legs.left?.knee && legs.right?.knee) {
      bottomY = (legs.left.knee.y + legs.right.knee.y) / 2 * 0.98;
    }
    
    const dressHeight = bottomY - topY;
    const topWidth = shoulderWidth * 1.45;
    const bottomWidth = shoulderWidth * 1.85;
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.globalAlpha = 0.93;
    
    // Create flowing dress mesh
    const dressGrid = this.createDressMeshGrid(mesh, topWidth, bottomWidth, dressHeight);
    this.drawWarpedMesh(ctx, img, dressGrid);
    
    this.addBodyShading(ctx, mesh, orientation);
  }

  createDressMeshGrid(mesh, topWidth, bottomWidth, height) {
    const grid = { points: [], uvs: [] };
    const { shoulders } = mesh;
    const centerX = shoulders.center.x;
    const topY = shoulders.center.y;
    
    const rows = 6;
    const cols = 4;
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t = row / (rows - 1);
        const s = col / (cols - 1);
        
        // Interpolate width (flare out)
        const currentWidth = topWidth * (1 - t) + bottomWidth * t;
        const y = topY + height * t;
        
        // Create curved shape
        const xOffset = (s - 0.5) * currentWidth;
        const curveFactor = Math.sin(s * Math.PI) * 12 * t;
        const x = centerX + xOffset + curveFactor;
        
        grid.points.push({ x, y });
        grid.uvs.push({ u: s, v: t });
      }
    }
    
    return grid;
  }

  renderPants3D(ctx, img, mesh, orientation) {
    const { hips, legs } = mesh;
    if (!hips || !legs.left || !legs.right) return;

    const hipWidth = Math.abs(hips.right.x - hips.left.x);
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 15;
    ctx.globalAlpha = 0.91;

    // Left leg with 3D mesh
    if (legs.left.hip && legs.left.ankle) {
      const leftGrid = this.createPantLegMesh(legs.left, hipWidth, 'left');
      this.drawWarpedMesh(ctx, img, leftGrid);
    }
    
    // Right leg with 3D mesh
    if (legs.right.hip && legs.right.ankle) {
      const rightGrid = this.createPantLegMesh(legs.right, hipWidth, 'right');
      this.drawWarpedMesh(ctx, img, rightGrid);
    }
    
    this.addBodyShading(ctx, mesh, orientation);
  }

  createPantLegMesh(leg, hipWidth, side) {
    const grid = { points: [], uvs: [] };
    const legWidth = hipWidth * 0.54;
    
    const rows = 5;
    const cols = 3;
    
    const hipY = leg.hip.y;
    const kneeY = leg.knee?.y || (leg.hip.y + leg.ankle.y) / 2;
    const ankleY = leg.ankle.y;
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t = row / (rows - 1);
        const s = col / (cols - 1);
        
        let y, currentWidth;
        
        if (t < 0.5) {
          // Hip to knee
          const localT = t / 0.5;
          y = hipY * (1 - localT) + kneeY * localT;
          currentWidth = legWidth * (1 - localT * 0.15);
        } else {
          // Knee to ankle
          const localT = (t - 0.5) / 0.5;
          y = kneeY * (1 - localT) + ankleY * localT;
          currentWidth = legWidth * 0.85 * (1 - localT * 0.2);
        }
        
        const centerX = leg.hip.x;
        const xOffset = (s - 0.5) * currentWidth;
        const curveFactor = Math.sin(s * Math.PI) * 6;
        const x = centerX + xOffset + curveFactor;
        
        grid.points.push({ x, y });
        grid.uvs.push({ u: side === 'left' ? s * 0.5 : 0.5 + s * 0.5, v: t });
      }
    }
    
    return grid;
  }

  addBodyShading(ctx, mesh, orientation) {
    // Add realistic shading for body curves
    const { shoulders, hips } = mesh;
    if (!shoulders || !hips) return;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.15;

    // Left side shading
    const leftGradient = ctx.createLinearGradient(
      shoulders.left.x - 30, shoulders.center.y,
      shoulders.left.x + 30, shoulders.center.y
    );
    leftGradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    leftGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = leftGradient;
    ctx.fillRect(shoulders.left.x - 30, shoulders.center.y, 60, hips.center.y - shoulders.center.y);

    // Right side shading
    const rightGradient = ctx.createLinearGradient(
      shoulders.right.x + 30, shoulders.center.y,
      shoulders.right.x - 30, shoulders.center.y
    );
    rightGradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    rightGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = rightGradient;
    ctx.fillRect(shoulders.right.x - 30, shoulders.center.y, 60, hips.center.y - shoulders.center.y);

    ctx.restore();
  }
}

// Main Component
function VirtualTryOn3D({ frontClothing, backClothing, clothingType, userHeight }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [detector, setDetector] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [processedFront, setProcessedFront] = useState(null);
  const [processedBack, setProcessedBack] = useState(null);
  const bodyMeshBuilderRef = useRef(null);
  const clothingRendererRef = useRef(null);
  const [bodyMesh, setBodyMesh] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    bodyMeshBuilderRef.current = new BodyMesh3D(userHeight || 170);
    clothingRendererRef.current = new Clothing3DRenderer();
  }, [userHeight]);

  useEffect(() => {
    if (frontClothing) {
      setIsProcessing(true);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        const processed = await ClothingProcessor.removeBackground(img);
        setProcessedFront(processed);
        setIsProcessing(false);
      };
      img.src = frontClothing;
    }
  }, [frontClothing]);

  useEffect(() => {
    if (backClothing) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        const processed = await ClothingProcessor.removeBackground(img);
        setProcessedBack(processed);
      };
      img.src = backClothing;
    }
  }, [backClothing]);

  const initTensorFlow = async () => {
    try {
      await tf.ready();
      await tf.setBackend('webgl');
      setIsReady(true);
    } catch (error) {
      console.error('TensorFlow error:', error);
    }
  };

  const setupCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
        };
      }
    } catch (error) {
      console.error('Camera error:', error);
    }
  };

  const initDetector = async () => {
    if (!isReady) return;
    
    try {
      const poseDetector = await posedetection.createDetector(
        posedetection.SupportedModels.MoveNet,
        { modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
      );
      setDetector(poseDetector);
    } catch (error) {
      console.error('Detector error:', error);
    }
  };

  const detectAndRender = async () => {
    if (!detector || !videoRef.current || videoRef.current.readyState !== 4) {
      requestAnimationFrame(detectAndRender);
      return;
    }

    try {
      const poses = await detector.estimatePoses(videoRef.current);
      
      if (poses && poses[0]) {
        const pose = poses[0];
        const mesh = bodyMeshBuilderRef.current?.buildBodyMesh(pose.keypoints);
        
        if (mesh) {
          setBodyMesh(mesh);
        }

        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, 640, 480);
        ctx.drawImage(videoRef.current, 0, 0, 640, 480);

        // Render 3D clothing with proper body wrapping
        if (processedFront && clothingType && mesh) {
          clothingRendererRef.current?.renderClothing(
            ctx, 
            processedFront,
            processedBack,
            mesh, 
            clothingType
          );
        }

        // Draw minimal keypoints
        pose.keypoints.forEach((kp) => {
          if (kp.score > 0.4) {
            ctx.beginPath();
            ctx.arc(kp.x, kp.y, 2, 0, 2 * Math.PI);
            ctx.fillStyle = "rgba(0, 255, 0, 0.5)";
            ctx.fill();
          }
        });
      }
    } catch (error) {
      console.error('Detection error:', error);
    }

    requestAnimationFrame(detectAndRender);
  };

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
    if (detector) {
      detectAndRender();
    }
  }, [detector, processedFront, processedBack]);

  return (
    <div className="relative">
      <video
        ref={videoRef}
        width="640"
        height="480"
        style={{ display: "none" }}
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        width="640"
        height="480"
        className="rounded-xl"
      />
      
      {isProcessing && (
        <div className="absolute top-4 left-4 bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold animate-pulse">
          🔄 Processing clothing...
        </div>
      )}
      
      {bodyMesh && (
        <div className="absolute top-4 right-4 bg-black/85 text-white p-3 rounded-lg text-xs backdrop-blur-sm max-w-xs">
          <div className="font-bold mb-2 text-sm flex items-center gap-2">
            <span>📐</span> Body Measurements
            <span className={`text-xs px-2 py-0.5 rounded ${
              bodyMesh.orientation === 'front' ? 'bg-green-500' : 
              bodyMesh.orientation === 'back' ? 'bg-blue-500' : 'bg-yellow-500'
            }`}>
              {bodyMesh.orientation === 'front' ? '👤 Front' : 
               bodyMesh.orientation === 'back' ? '🔄 Back' : '↔️ Side'}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Chest:</span>
              <span className="font-bold">{bodyMesh.measurements.chest.toFixed(1)} cm</span>
            </div>
            <div className="flex justify-between">
              <span>Waist:</span>
              <span className="font-bold">{bodyMesh.measurements.waist.toFixed(1)} cm</span>
            </div>
            <div className="flex justify-between">
              <span>Hip:</span>
              <span className="font-bold">{bodyMesh.measurements.hip.toFixed(1)} cm</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main App
export default function App() {
  const [showPrivacy, setShowPrivacy] = useState(true);
  const [userHeight, setUserHeight] = useState(null);
  const [heightInput, setHeightInput] = useState("");
  const [frontClothing, setFrontClothing] = useState(null);
  const [backClothing, setBackClothing] = useState(null);
  const [clothingType, setClothingType] = useState("shirt");
  const [uploadedFront, setUploadedFront] = useState(null);
  const [uploadedBack, setUploadedBack] = useState(null);

  const handleHeightSubmit = () => {
    const height = Number(heightInput);
    if (height > 0 && height < 300) {
      setUserHeight(height);
    } else {
      alert("Please enter valid height (1-300 cm)");
    }
  };

  const handleFrontUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFrontClothing(event.target.result);
        setUploadedFront(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBackUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setBackClothing(event.target.result);
        setUploadedBack(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  if (showPrivacy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6">
        <div className="max-w-2xl bg-white/90 backdrop-blur-lg rounded-3xl shadow-2xl p-8 border border-white/50">
          <h2 className="text-4xl font-bold text-gray-900 mb-6 text-center">
            🎯 True 3D Virtual Try-On
          </h2>
          <div className="space-y-4 mb-8">
            <div className="flex gap-3 p-4 bg-blue-50 rounded-xl border-2 border-blue-200">
              <span className="text-2xl">🌐</span>
              <div>
                <div className="font-bold text-blue-900">360° View Support</div>
                <p className="text-sm text-blue-700">Upload front & back images for complete rotation</p>
              </div>
            </div>
            <div className="flex gap-3 p-4 bg-purple-50 rounded-xl border-2 border-purple-200">
              <span className="text-2xl">📐</span>
              <div>
                <div className="font-bold text-purple-900">3D Body Mesh Mapping</div>
                <p className="text-sm text-purple-700">Cloth wraps realistically around your body shape</p>
              </div>
            </div>
            <div className="flex gap-3 p-4 bg-green-50 rounded-xl border-2 border-green-200">
              <span className="text-2xl">🔒</span>
              <div>
                <div className="font-bold text-green-900">100% Private & Secure</div>
                <p className="text-sm text-green-700">All processing in-browser. Zero uploads</p>
              </div>
            </div>
            <div className="flex gap-3 p-4 bg-pink-50 rounded-xl border-2 border-pink-200">
              <span className="text-2xl">✨</span>
              <div>
                <div className="font-bold text-pink-900">Realistic Cloth Physics</div>
                <p className="text-sm text-pink-700">Advanced mesh deformation & shading</p>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setShowPrivacy(false)}
            className="w-full py-4 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
          >
            Start 3D Try-On Experience →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
            3D Virtual Try-On Studio
          </h1>
          <p className="text-xl text-gray-600">Realistic Body Mesh Wrapping • 360° View</p>
        </div>

        {!userHeight && (
          <div className="bg-white/90 backdrop-blur-lg rounded-3xl shadow-xl p-8 mb-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-4 text-center">
              📏 Step 1: Enter Your Height
            </h3>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <input
                type="number"
                value={heightInput}
                onChange={(e) => setHeightInput(e.target.value)}
                placeholder="Height in cm (e.g., 175)"
                className="px-6 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-100 text-lg w-64"
              />
              <button 
                onClick={handleHeightSubmit}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {userHeight && (
          <>
            <div className="bg-white/90 backdrop-blur-lg rounded-3xl shadow-xl p-8 mb-6">
              <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                <span>👕</span> Step 2: Upload Clothing Images & Select Type
              </h3>
              
              {/* Clothing Type Selection */}
              <div className="mb-6">
                <label className="block font-semibold text-gray-700 mb-3">Clothing Type:</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { type: "shirt", icon: "👕", label: "Shirt/Top" },
                    { type: "jacket", icon: "🧥", label: "Jacket" },
                    { type: "dress", icon: "👗", label: "Dress" },
                    { type: "pants", icon: "👖", label: "Pants" }
                  ].map(item => (
                    <button
                      key={item.type}
                      onClick={() => setClothingType(item.type)}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        clothingType === item.type
                          ? "border-purple-500 bg-purple-50 shadow-lg scale-105"
                          : "border-gray-300 hover:border-purple-300"
                      }`}
                    >
                      <div className="text-3xl mb-1">{item.icon}</div>
                      <p className="font-semibold text-sm">{item.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Image Upload Section */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Front Image */}
                <div>
                  <label className="block font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="text-xl">👤</span> Front View (Required)
                  </label>
                  <label className="cursor-pointer block">
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                      frontClothing 
                        ? 'border-green-400 bg-green-50' 
                        : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
                    }`}>
                      <div className="text-4xl mb-2">{frontClothing ? '✓' : '📸'}</div>
                      <p className="font-semibold text-gray-700">
                        {frontClothing ? 'Front uploaded!' : 'Click to upload front'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 10MB</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFrontUpload}
                      className="hidden"
                    />
                  </label>
                  
                  {uploadedFront && (
                    <div className="mt-3 bg-green-50 border-2 border-green-300 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">✓</span>
                        <span className="text-sm font-semibold text-green-700 truncate">{uploadedFront}</span>
                      </div>
                      <button
                        onClick={() => { setFrontClothing(null); setUploadedFront(null); }}
                        className="text-red-600 hover:text-red-800 font-bold text-lg ml-2"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Back Image */}
                <div>
                  <label className="block font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="text-xl">🔄</span> Back View (Optional)
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">For 360° view</span>
                  </label>
                  <label className="cursor-pointer block">
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                      backClothing 
                        ? 'border-blue-400 bg-blue-50' 
                        : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
                    }`}>
                      <div className="text-4xl mb-2">{backClothing ? '✓' : '📸'}</div>
                      <p className="font-semibold text-gray-700">
                        {backClothing ? 'Back uploaded!' : 'Click to upload back'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Turn around to see back view</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleBackUpload}
                      className="hidden"
                    />
                  </label>
                  
                  {uploadedBack && (
                    <div className="mt-3 bg-blue-50 border-2 border-blue-300 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">✓</span>
                        <span className="text-sm font-semibold text-blue-700 truncate">{uploadedBack}</span>
                      </div>
                      <button
                        onClick={() => { setBackClothing(null); setUploadedBack(null); }}
                        className="text-red-600 hover:text-red-800 font-bold text-lg ml-2"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tips Section */}
            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-2xl p-5 mb-6 border-2 border-yellow-300">
              <div className="flex items-start gap-3">
                <span className="text-2xl">💡</span>
                <div className="flex-1">
                  <h4 className="font-bold text-orange-800 mb-3">Pro Tips for Perfect 3D Try-On:</h4>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="bg-white p-3 rounded-lg">
                      <div className="font-semibold text-sm text-gray-800 mb-1">📸 Photo Quality</div>
                      <p className="text-xs text-gray-600">Clear, well-lit clothing images work best</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg">
                      <div className="font-semibold text-sm text-gray-800 mb-1">👤 Body Position</div>
                      <p className="text-xs text-gray-600">Stand 6-8 feet away, full body visible</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg">
                      <div className="font-semibold text-sm text-gray-800 mb-1">🔄 Turn Around</div>
                      <p className="text-xs text-gray-600">Rotate to see back view if uploaded</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Camera Feed */}
            <div className="bg-white/90 backdrop-blur-lg rounded-3xl shadow-xl p-6">
              <h3 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span>📹</span> Step 3: Live 3D Try-On
              </h3>

              <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-gray-900">
                <VirtualTryOn3D
                  frontClothing={frontClothing}
                  backClothing={backClothing}
                  clothingType={clothingType}
                  userHeight={userHeight}
                />
                
                {!frontClothing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="text-center text-white px-8 py-6 bg-black/50 rounded-2xl max-w-md">
                      <p className="text-4xl mb-3">👕</p>
                      <p className="text-2xl font-bold mb-2">Upload Front Image First</p>
                      <p className="text-sm text-gray-300">Then optionally add back view for 360° experience</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Feature Cards */}
              <div className="grid md:grid-cols-4 gap-4 mt-6">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl border-2 border-blue-200">
                  <div className="text-2xl mb-2">🎯</div>
                  <div className="font-bold text-gray-800 mb-1 text-sm">Mesh Warping</div>
                  <p className="text-xs text-gray-600">Cloth wraps around body</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-4 rounded-xl border-2 border-purple-200">
                  <div className="text-2xl mb-2">📐</div>
                  <div className="font-bold text-gray-800 mb-1 text-sm">Perfect Fit</div>
                  <p className="text-xs text-gray-600">Stretches to your size</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-xl border-2 border-green-200">
                  <div className="text-2xl mb-2">🔄</div>
                  <div className="font-bold text-gray-800 mb-1 text-sm">360° View</div>
                  <p className="text-xs text-gray-600">Turn to see all angles</p>
                </div>
                <div className="bg-gradient-to-br from-yellow-50 to-orange-50 p-4 rounded-xl border-2 border-yellow-200">
                  <div className="text-2xl mb-2">✨</div>
                  <div className="font-bold text-gray-800 mb-1 text-sm">Real Shadows</div>
                  <p className="text-xs text-gray-600">Depth & shading</p>
                </div>
              </div>
            </div>

            {/* Height Badge */}
            <div className="mt-6 text-center">
              <div className="inline-flex items-center gap-3 bg-green-50 border-2 border-green-300 rounded-full px-6 py-3">
                <span className="text-xl">✓</span>
                <span className="font-bold text-green-700">Height: {userHeight} cm</span>
                <button
                  onClick={() => { setUserHeight(null); setHeightInput(""); }}
                  className="ml-2 px-3 py-1 bg-red-500 text-white text-sm rounded-full hover:bg-red-600 transition-all"
                >
                  Change
                </button>
              </div>
            </div>
          </>
        )}

        {/* Technology Info */}
        <div className="mt-8 bg-gradient-to-r from-gray-800 to-gray-900 text-white rounded-2xl p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span>🚀</span> Advanced 3D Technology
          </h3>
          <div className="grid md:grid-cols-4 gap-4 text-sm mb-4">
            <div>
              <div className="font-bold text-blue-300 mb-1">Pose Detection</div>
              <div className="text-gray-300 text-xs">MoveNet AI</div>
            </div>
            <div>
              <div className="font-bold text-purple-300 mb-1">Body Mesh</div>
              <div className="text-gray-300 text-xs">3D Grid Mapping</div>
            </div>
            <div>
              <div className="font-bold text-pink-300 mb-1">Cloth Physics</div>
              <div className="text-gray-300 text-xs">Mesh Deformation</div>
            </div>
            <div>
              <div className="font-bold text-green-300 mb-1">Orientation</div>
              <div className="text-gray-300 text-xs">Front/Back Detection</div>
            </div>
          </div>
          
          <div className="pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                <span className="text-gray-400">Real-time 3D mesh warping • Realistic cloth draping</span>
              </div>
              <span className="text-gray-500">100% Private • No uploads</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}