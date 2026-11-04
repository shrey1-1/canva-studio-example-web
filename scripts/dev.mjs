// Starts the API server and the web dev server together. If either stops (or on Ctrl+C), both
// stop, including their child processes, so no server is left running in the background.
import { spawn, spawnSync } from 'node:child_process';

const children = [];

const stopAll = (code) => {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // On Windows, npm runs through cmd.exe; kill the whole process tree.
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
};

const run = (name, script) => {
  // One fixed command string (no user input), so running it through the shell is safe.
  const child = spawn(`npm run ${script}`, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    stopAll(code ?? 0);
  });
  children.push(child);
};

run('server', 'dev:server');
run('web', 'dev:web');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stopAll(0));
