import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// No <StrictMode>: its double-mounting registers a second Sandpack client and
// the preview's loading overlay then never receives its "done" message.
createRoot(document.getElementById('root')!).render(<App />);
