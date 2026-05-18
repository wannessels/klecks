import { execFileSync } from 'node:child_process';

export function dockerComposeRestart() {
    execFileSync('docker', ['compose', 'restart'], { stdio: 'inherit' });
}
