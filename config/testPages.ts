export interface TestPage {
  id: string;
  title: string;
  description: string;
  icon: string;
  path: string;
  category?: string;
}

export const testPages: TestPage[] = [
  {
    id: "videosdk-compare",
    title: "VideoSDK Compare",
    description: "Compare Agora, Twilio, and Zoom in one UI",
    icon: "Video",
    path: "/test/videosdkcompare",
    category: "Media"
  },
  {
    id: "video-playback",
    title: "Video Playback",
    description: "Test video playback functionality",
    icon: "Video",
    path: "/test/video-playback",
    category: "Media"
  },
  {
    id: "audio-test",
    title: "Audio Test",
    description: "Test audio input/output devices",
    icon: "Mic",
    path: "/test/audio-test",
    category: "Media"
  },
  {
    id: "network-check",
    title: "Network Check",
    description: "Check network connectivity and speed",
    icon: "Wifi",
    path: "/test/network-check",
    category: "Network"
  },
  {
    id: "device-info",
    title: "Device Info",
    description: "Display device information",
    icon: "Info",
    path: "/test/device-info",
    category: "System"
  },
  {
    id: "screen-share",
    title: "Screen Share",
    description: "Test screen sharing capability",
    icon: "Monitor",
    path: "/test/screen-share",
    category: "Media"
  },
  {
    id: "camera-test",
    title: "Camera Test",
    description: "Test camera functionality",
    icon: "Camera",
    path: "/test/camera-test",
    category: "Media"
  },
  {
    id: "camera-debug",
    title: "Camera Debug",
    description: "Camera test with detailed logs",
    icon: "Bug",
    path: "/test/camera-debug",
    category: "Debug"
  },
  {
    id: "tfjs-gpu",
    title: "TF.js GPU",
    description: "TensorFlow.js GPU acceleration test",
    icon: "Cpu",
    path: "/test/tfjs-gpu",
    category: "ML/AI"
  },
  {
    id: "webnn-test",
    title: "WebNN Test",
    description: "WebNN with ONNX Runtime WebGPU",
    icon: "Zap",
    path: "/test/webnn-test",
    category: "ML/AI"
  },
  {
    id: "vb-test",
    title: "VB Test",
    description: "Virtual background test (SAB / no SAB modes)",
    icon: "Video",
    path: "/test/vb-test",
    category: "Media"
  },
  {
    id: "webrtc-meeting",
    title: "WebRTC Meeting",
    description: "Two-person P2P meeting with signaling, media, chat, and stats",
    icon: "Users",
    path: "/test/webrtc-meeting",
    category: "Media"
  },
  {
    id: "browser-capability",
    title: "Browser Capability Test",
    description: "Zoom Web Media capability check (UA, WebCodecs, predicates)",
    icon: "TestTube",
    path: "/test/browser-capability",
    category: "Debug"
  },
  {
    id: "sei-rtc-test",
    title: "SEI RTC Test",
    description: "Two-tab RTCRtpScriptTransform diagnostic (open in two windows)",
    icon: "Users",
    path: "/sei-rtc-test.html",
    category: "Debug"
  },
  {
    id: "sei-rtc-minimal",
    title: "SEI RTC Minimal",
    description: "Stripped-down RTCRtpScriptTransform reproducer (canonical pc.addTrack pattern)",
    icon: "Bug",
    path: "/sei-rtc-minimal.html",
    category: "Debug"
  },
  {
    id: "sei-rtc-h1",
    title: "SEI RTC H1",
    description: "VideoFrame.timestamp vs encoded meta.timestamp alignment (side-by-side)",
    icon: "Zap",
    path: "/sei-rtc-h1.html",
    category: "Debug"
  }
];

