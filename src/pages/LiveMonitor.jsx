import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl'; // Ensure WebGL backend is used
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as faceapi from 'face-api.js';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { Camera, CameraOff, AlertTriangle, Activity } from 'lucide-react';

function LiveMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [model, setModel] = useState(null);
  const [poseDetector, setPoseDetector] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [isEmergency, setIsEmergency] = useState(false);
  
  // Custom Physics Tracker for Loitering & Speed
  const trackedObjectsRef = useRef({});
  const frameCountRef = useRef(0);
  const lastStateUpdateRef = useRef(0);
  
  // Audio context for siren
  const audioCtxRef = useRef(null);
  const oscillatorRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    // Initialize TFJS, COCO-SSD, Face-API, and Pose Detection
    const loadModels = async () => {
      try {
        await tf.ready();
        await tf.setBackend('webgl'); // Force WebGL so we don't crash the server with fs imports
        
        // Initialize TensorFlow MoveNet Pose Detection
        const detectorConfig = { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING };
        const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
        
        // Load Object Detection and Facial Expression models
        const [loadedCoco] = await Promise.all([
          cocoSsd.load({ base: 'lite_mobilenet_v2' }),
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceExpressionNet.loadFromUri('/models')
        ]);
        
        setModel(loadedCoco);
        setPoseDetector(detector);
        console.log("AI Models loaded successfully: COCO-SSD, FaceAPI, MoveNet");
        setIsLoading(false);
      } catch (err) {
        console.error("CRITICAL: Failed to load AI models:", err);
        alert("CRITICAL ERROR: Failed to load AI models. See console.");
      }
    };
    loadModels();

    return () => {
      stopSiren();
    };
  }, []);

  const playSiren = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    if (!oscillatorRef.current) {
      const oscillator = audioCtxRef.current.createOscillator();
      const gainNode = audioCtxRef.current.createGain();
      
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(400, audioCtxRef.current.currentTime);
      oscillator.frequency.linearRampToValueAtTime(800, audioCtxRef.current.currentTime + 0.5);
      oscillator.frequency.linearRampToValueAtTime(400, audioCtxRef.current.currentTime + 1.0);
      
      // loop siren
      intervalRef.current = setInterval(() => {
        if(oscillatorRef.current && audioCtxRef.current) {
          oscillator.frequency.setValueAtTime(400, audioCtxRef.current.currentTime);
          oscillator.frequency.linearRampToValueAtTime(800, audioCtxRef.current.currentTime + 0.5);
          oscillator.frequency.linearRampToValueAtTime(400, audioCtxRef.current.currentTime + 1.0);
        }
      }, 1000);

      gainNode.gain.value = 0.1; // Volume
      oscillator.connect(gainNode);
      gainNode.connect(audioCtxRef.current.destination);
      oscillator.start();
      oscillatorRef.current = oscillator;
    }
  }, []);

  const stopSiren = useCallback(() => {
    if (oscillatorRef.current) {
      oscillatorRef.current.stop();
      oscillatorRef.current.disconnect();
      oscillatorRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const triggerEmergency = useCallback((message) => {
    setIsEmergency(true);
    setAlerts(prev => {
      // Prevent spamming exact same alert in the same second
      if (prev.length > 0 && prev[0].message === message && (Date.now() - prev[0].id < 2000)) {
        return prev;
      }
      return [{ id: Date.now(), time: new Date().toLocaleTimeString(), message }, ...prev].slice(0, 15);
    });
    playSiren();
    
    // Auto-reset emergency state quickly if not continuously triggered
    setTimeout(() => {
      setIsEmergency(false);
      stopSiren();
    }, 4000);
  }, [playSiren, stopSiren]);

  // Motion detection variables
  const prevFrameRef = useRef(null);
  const requestRef = useRef(null);
  const isDetectingRef = useRef(false);
  
  const detectAnomalies = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !model || !videoRef.current.srcObject) return;
    if (isDetectingRef.current) return;
    
    isDetectingRef.current = true;
    try {
      const video = videoRef.current;
      if (video.readyState !== 4) {
        return;
      }

    // 1. Object Detection (Knife, etc.)
    let predictions = [];
    try {
      predictions = await model.detect(video);
    } catch (e) {
      console.error('Detection error:', e);
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let threatDetected = false;
    let threatMessage = '';
    
    // Physics Tracking Variables
    let currentTimestamp = Date.now();
    // MediaPipe requires strictly monotonically increasing timestamps. 
    // If Date.now() fires twice in the same millisecond, WebAssembly crashes.
    if (window.lastMediaPipeTimestamp && currentTimestamp <= window.lastMediaPipeTimestamp) {
        currentTimestamp = window.lastMediaPipeTimestamp + 1;
    }
    window.lastMediaPipeTimestamp = currentTimestamp;

    frameCountRef.current += 1;
    const activeIds = new Set();
    const vw = canvas.width;
    const vh = canvas.height;

    predictions.forEach(prediction => {
      // Draw bounding box
      const [x, y, width, height] = prediction.bbox;
      ctx.strokeStyle = '#00FFFF';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = '#00FFFF';
      ctx.fillText(`${prediction.class} (${Math.round(prediction.score * 100)}%)`, x, y > 10 ? y - 5 : 10);

      // Check for threat (lower threshold to detect items further away)
      const threatClasses = ['knife', 'scissors', 'gun', 'baseball bat'];
      if (threatClasses.includes(prediction.class) && prediction.score > 0.15) {
        threatDetected = true;
        threatMessage = `Weapon detected: ${prediction.class}`;
        
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = '#FF0000';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`THREAT: ${prediction.class.toUpperCase()}`, x, y > 20 ? y - 10 : 20);
      }

      // Vehicle tracking (for "Vehicle Accident" heuristic)
      const vehicleClasses = ['car', 'truck', 'bus', 'motorcycle'];
      if (vehicleClasses.includes(prediction.class)) {
         const cx = x + width/2;
         const cy = y + height/2;
         const id = `veh_${Math.floor(cx/50)}_${Math.floor(cy/50)}`; // Simple spatial-temporal ID
         activeIds.add(id);
         
         if (!trackedObjectsRef.current[id]) {
            trackedObjectsRef.current[id] = { type: 'vehicle', history: [{cx, cy, time: currentTimestamp}] };
         } else {
            trackedObjectsRef.current[id].history.push({cx, cy, time: currentTimestamp});
            if (trackedObjectsRef.current[id].history.length > 10) trackedObjectsRef.current[id].history.shift();
         }
      }
    });

    // 2. Facial Expression Detection (Serious/Angry/Fearful/Crying)
    let isPersonCryingOrSad = false;
    try {
      const faceDetections = await faceapi.detectAllFaces(
        video, 
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.1 })
      ).withFaceExpressions();

      if (faceDetections && faceDetections.length > 0) {
        // Find if any face has a dominant negative emotion
        faceDetections.forEach(detection => {
          const expressions = detection.expressions;
          
          const negativeEmotionScore = 
            (expressions.angry || 0) + 
            (expressions.fearful || 0) + 
            (expressions.disgusted || 0) +
            (expressions.sad || 0);

          if (negativeEmotionScore > 0.6) {
             threatDetected = true;
             threatMessage = 'Abnormal activity: Hostile or distressed facial expression detected';
          }
          if ((expressions.sad || 0) > 0.4 || (expressions.fearful || 0) > 0.4) {
             isPersonCryingOrSad = true;
          }
          
          // Draw expression debug boxes (optional, for visibility)
          const { x, y, width, height } = detection.detection.box;
          ctx.strokeStyle = threatDetected ? '#FF0000' : '#A020F0';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, width, height);
          
          // Find dominant emotion for label
          let dominantExp = '';
          let maxVal = 0;
          for (const [k, v] of Object.entries(expressions)) {
            if (v > maxVal) { maxVal = v; dominantExp = k; }
          }
          ctx.fillStyle = threatDetected ? '#FF0000' : '#A020F0';
          ctx.fillText(`Face: ${dominantExp} (${Math.round(maxVal * 100)}%)`, x, y > 10 ? y - 5 : 10);
        });
      }
    } catch (e) {
      console.error('Face detection error:', e);
    }

    // 3. Advanced Pose Detection (TensorFlow MoveNet)
    try {
      if (poseDetector) {
        const poses = await poseDetector.estimatePoses(video);
        
        if (poses && poses.length > 0) {
            poses.forEach((pose, index) => {
               // MoveNet Keypoints: { x, y, score, name }
               const findKp = (name) => pose.keypoints.find(k => k.name === name);
               const nose = findKp('nose');
               const lWrist = findKp('left_wrist');
               const rWrist = findKp('right_wrist');
               const lHip = findKp('left_hip');
               const rHip = findKp('right_hip');
               const lShoulder = findKp('left_shoulder');
               const rShoulder = findKp('right_shoulder');
               const lKnee = findKp('left_knee');
               const rKnee = findKp('right_knee');
               
               // Draw skeleton wireframe
               ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
               ctx.lineWidth = 2;
               
               const drawBone = (kp1, kp2) => {
                 if (kp1 && kp2 && kp1.score > 0.3 && kp2.score > 0.3) {
                   ctx.beginPath();
                   ctx.moveTo(kp1.x, kp1.y);
                   ctx.lineTo(kp2.x, kp2.y);
                   ctx.stroke();
                 }
               };
               
               drawBone(lShoulder, rShoulder);
               drawBone(lShoulder, lHip);
               drawBone(rShoulder, rHip);
               drawBone(lHip, rHip);
               drawBone(lShoulder, lWrist); // Simplified arm
               drawBone(rShoulder, rWrist); // Simplified arm
               drawBone(lHip, lKnee);
               drawBone(rHip, rKnee);

               // Tracking ID for this person
               let cx = 0, cy = 0, validPoints = 0;
               pose.keypoints.forEach(k => { if (k.score > 0.3) { cx += k.x; cy += k.y; validPoints++; } });
               
               if (validPoints >= 5) {
                   cx /= validPoints; cy /= validPoints;
                   
                   const pId = `person_${Math.floor(cx/150)}_${Math.floor(cy/150)}`; 
                   activeIds.add(pId);
                   
                   if (!trackedObjectsRef.current[pId]) {
                      trackedObjectsRef.current[pId] = { 
                        type: 'person', 
                        history: [{cx, cy, time: currentTimestamp, nose_y: nose?.y}],
                        firstSeen: currentTimestamp
                      };
                   } else {
                      const tracker = trackedObjectsRef.current[pId];
                      tracker.history.push({cx, cy, time: currentTimestamp, nose_y: nose?.y});
                      if (tracker.history.length > 20) tracker.history.shift();
                      
                      // HEURISTIC: "Running" / "Abnormal Speed"
                      if (tracker.history.length > 10) {
                         const oldFrame = tracker.history[tracker.history.length - 10];
                         const dist = Math.sqrt(Math.pow(cx - oldFrame.cx, 2) + Math.pow(cy - oldFrame.cy, 2));
                         const timeDiff = currentTimestamp - oldFrame.time;
                         const velocity = (dist / timeDiff) * 1000; // pixels per second
                         
                         if (velocity > 400) {
                            threatDetected = true;
                            threatMessage = "Abnormal activity: Running / Abnormal Speed detected";
                         }
                      }

                      // HEURISTIC: "Loitering" or "Suspicious Walk"
                      const durationVisible = currentTimestamp - tracker.firstSeen;
                      // Increased strictly to 45 seconds to avoid triggering when just sitting at the computer
                      if (durationVisible > 45000) {
                         const firstFrame = tracker.history[0];
                         const totalDisplacement = Math.sqrt(Math.pow(cx - firstFrame.cx, 2) + Math.pow(cy - firstFrame.cy, 2));
                         if (totalDisplacement < 150) { 
                            threatDetected = true;
                            threatMessage = "Abnormal activity: Suspicious Loitering detected";
                         }
                      }
                   }
               }
               
               // HEURISTIC: "Potential Aggression / Fight Stance"
               if (nose && lWrist && rWrist && nose.score > 0.3 && lWrist.score > 0.3 && rWrist.score > 0.3) {
                  const handsAboveMouth = lWrist.y < nose.y + 20 || rWrist.y < nose.y + 20;
                  if (handsAboveMouth) {
                     threatDetected = true;
                     threatMessage = "Abnormal activity: Potential Fight / Aggressive stance detected";
                  }
               }

               // HEURISTIC: "Fall Down"
               if (nose && lHip && rHip && nose.score > 0.3 && lHip.score > 0.3 && rHip.score > 0.3) {
                  const avgHipY = (lHip.y + rHip.y) / 2;
                  if (nose.y > avgHipY + 50) { 
                     threatDetected = true;
                     threatMessage = "Abnormal activity: Person Fall Down detected";
                  }
               }

               // HEURISTIC: "Crying"
               if (isPersonCryingOrSad && nose) {
                  const leftDist = lWrist ? Math.sqrt(Math.pow(lWrist.x - nose.x, 2) + Math.pow(lWrist.y - nose.y, 2)) : 999;
                  const rightDist = rWrist ? Math.sqrt(Math.pow(rWrist.x - nose.x, 2) + Math.pow(rWrist.y - nose.y, 2)) : 999;
                  if (leftDist < 80 || rightDist < 80) {
                     threatDetected = true;
                     threatMessage = "Abnormal activity: Person crying / in severe distress";
                  }
               }

               // HEURISTIC: "Catching Neck" (Choking self or others)
               if (nose && nose.score > 0.3) {
                   const neckY = nose.y + 40; // Approx neck position
                   poses.forEach(otherPose => {
                       const oLWrist = otherPose.keypoints.find(k => k.name === 'left_wrist');
                       const oRWrist = otherPose.keypoints.find(k => k.name === 'right_wrist');
                       
                       if (oLWrist && oLWrist.score > 0.3) {
                           const dist = Math.sqrt(Math.pow(oLWrist.x - nose.x, 2) + Math.pow(oLWrist.y - neckY, 2));
                           if (dist < 50) { threatDetected = true; threatMessage = "Abnormal activity: Catching neck / Choking detected"; }
                       }
                       if (oRWrist && oRWrist.score > 0.3) {
                           const dist = Math.sqrt(Math.pow(oRWrist.x - nose.x, 2) + Math.pow(oRWrist.y - neckY, 2));
                           if (dist < 50) { threatDetected = true; threatMessage = "Abnormal activity: Catching neck / Choking detected"; }
                       }
                   });
               }
            });
            
            // HEURISTIC: "Human Fights"
            if (poses.length >= 2) {
               let intersectingPoses = false;
               for(let i=0; i<poses.length; i++) {
                   for(let j=i+1; j<poses.length; j++) {
                       const noseI = poses[i].keypoints.find(k=>k.name==='nose');
                       const noseJ = poses[j].keypoints.find(k=>k.name==='nose');
                       if (noseI && noseJ && noseI.score > 0.3 && noseJ.score > 0.3 && Math.sqrt(Math.pow(noseI.x - noseJ.x, 2) + Math.pow(noseI.y - noseJ.y, 2)) < 150) {
                          intersectingPoses = true;
                       }
                   }
               }
               if (intersectingPoses) {
                   window.potentialConflict = true; 
               } else {
                   window.potentialConflict = false;
               }
            }
        }
      }
    } catch (e) {
      console.error("Pose detection error:", e);
    }
    
    // Cleanup old tracked objects
    const frameCurrentTimestamp = Date.now();
    if (frameCountRef.current % 30 === 0) {
       for (const id in trackedObjectsRef.current) {
          if (!activeIds.has(id)) {
              const lastSeen = trackedObjectsRef.current[id].history[trackedObjectsRef.current[id].history.length-1].time;
              if (frameCurrentTimestamp - lastSeen > 2000) { delete trackedObjectsRef.current[id]; }
          }
       }
    }

    // 4. Motion Detection (Hurrying / Violence / Accidents)
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 64; 
      tempCanvas.height = 64;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(video, 0, 0, 64, 64);
      const currentFrame = tempCtx.getImageData(0, 0, 64, 64).data;
      
      if (prevFrameRef.current) {
        let diff = 0;
        for (let i = 0; i < currentFrame.length; i += 4) {
          diff += Math.abs(currentFrame[i] - prevFrameRef.current[i]);
          diff += Math.abs(currentFrame[i+1] - prevFrameRef.current[i+1]);
          diff += Math.abs(currentFrame[i+2] - prevFrameRef.current[i+2]);
        }
        const score = diff / (64 * 64 * 3); // Average pixel diff
        // Tuned threshold for erratic, massive screen movement (lowered to catch sudden hand lifts or fighting): 15
        if (score > 15) { 
           if (window.potentialConflict) {
               threatDetected = true;
               threatMessage = 'Abnormal activity: Human Fights / Violence detected';
           } else {
               threatDetected = true;
               threatMessage = 'Abnormal activity: Sudden rapid movement or violence detected';
           }
        }
        
        // Vehicle accident logic
        if (score > 30 && Object.values(trackedObjectsRef.current).some(o => o.type === 'vehicle')) {
            threatDetected = true;
            threatMessage = 'Abnormal activity: Potential Vehicle Accident detected';
        }
      }
      prevFrameRef.current = currentFrame;
    } catch (e) {
      // Handle cross-origin or temp canvas issues gracefully
    }

    if (threatDetected) {
      triggerEmergency(threatMessage);
    }
    } catch (err) {
      console.error("General detection anomaly:", err);
    } finally {
      isDetectingRef.current = false;
      if (videoRef.current && videoRef.current.srcObject) {
         requestRef.current = requestAnimationFrame(detectAnomalies);
      }
    }
  }, [model, poseDetector, triggerEmergency]);

  const toggleCamera = async () => {
    if (isCameraOn) {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      const stream = videoRef.current.srcObject;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      videoRef.current.srcObject = null;
      setIsCameraOn(false);
      stopSiren();
      setIsEmergency(false);
      prevFrameRef.current = null;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 480 } 
        });
        videoRef.current.srcObject = stream;
        setIsCameraOn(true);
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          detectAnomalies();
        };
      } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Cannot access camera. Please allow permissions.");
      }
    }
  };

  return (
    <div className={`live-monitor-container ${isEmergency ? 'emergency-mode' : ''}`}>
      <div className="monitor-header">
        <h2>Live Camera Monitor</h2>
        <button 
          className={`toggle-btn ${isCameraOn ? 'btn-danger' : 'btn-primary'}`} 
          onClick={toggleCamera}
          disabled={isLoading}
        >
          {isLoading ? 'Loading AI Model...' : isCameraOn ? <><CameraOff size={20} /> Turn Off Camera</> : <><Camera size={20} /> Turn On Camera</>}
        </button>
      </div>

      {isEmergency && (
        <div className="emergency-banner">
          <AlertTriangle size={36} />
          <h2>EMERGENCY DETECTED</h2>
          <AlertTriangle size={36} />
        </div>
      )}

      <div className="monitor-content">
        <div className="surveillance-container">
          <div className="video-wrapper">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className={!isCameraOn ? 'hidden' : ''}
            />
            <canvas ref={canvasRef} className={!isCameraOn ? 'hidden' : 'overlay-canvas'} />
            {!isCameraOn && (
              <div className="camera-placeholder">
                <CameraOff size={48} opacity={0.5} />
                <p>System Standby - Camera Offline</p>
              </div>
            )}
            
            {isCameraOn && (
               <div className="recording-indicator">
                 <div className="red-dot"></div>
                 <span>REC</span>
               </div>
            )}
          </div>
        </div>

        <aside className="alerts-panel">
          <h3>
            <AlertTriangle size={20} color={isEmergency ? "#ef4444" : "#e2e8f0"} /> 
            Live Security Log
          </h3>
          <div className="alerts-list">
            {alerts.length === 0 ? (
              <p className="no-activity">Monitoring systems active. No anomalies detected.</p>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} className="alert-item">
                  <span className="alert-time">{alert.time}</span>
                  <span className="alert-message">{alert.message}</span>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default LiveMonitor;
