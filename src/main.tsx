import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// The WebGPU renderer owns native GPU resources. Rendering once avoids
// development-only StrictMode mount/dispose races while preserving production behavior.
createRoot(document.getElementById('root')!).render(<App />);
