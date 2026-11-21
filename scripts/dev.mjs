// Starts the API server and the app together: npm run dev
import { spawn } from 'node:child_process';

const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const server = run('node', ['server/index.ts']);
const vite = run('npx', ['vite', '--host', '--port', '5173', '--strictPort']);
const stop = () => { server.kill(); vite.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', code => { if (code) stop(); });
vite.on('exit', stop);
