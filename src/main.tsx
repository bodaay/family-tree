import { render } from 'preact';
import { App } from './app';
import './install';
import './fonts.css';
import './styles.css';

render(<App />, document.getElementById('app')!);

// the app's own files kept on the phone, so it opens with no connection (public/sw.js); not while developing
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
